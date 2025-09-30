'use strict';

const express = require("express");
const morgan = require("morgan");
const crypto = require("crypto");
const fs = require("fs");
const fetch = require("node-fetch");
const { sendTemplateViaBridge, sendTextViaBridge } = require("./lib/bridge");
const { query, withTxn } = require("./db");
const { requireString, optionalString, requireEnum, patterns, createValidationError } = require("./validate");
const { requestLogger } = require("./mw/log");
const { errorHandler } = require("./mw/error");
const { getPagination, paginateQuery } = require("./pagination");
const smsRoutes = require('./routes/sms');
const sendRoutes = require("./routes/send");
const adminRoutes = require('./routes/admin');

// Environment configuration
const BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL || "https://wa.woosh.ai";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";
const BRIDGE_TEMPLATE_NAME = process.env.BRIDGE_TEMPLATE_NAME || "growthpoint_testv1";
const BRIDGE_TEMPLATE_LANG = ((process.env.BRIDGE_TEMPLATE_LANG || "en").trim().split(/[_-]/)[0] || "en");
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./data/registry.csv";
const HMAC_SECRET = process.env.SMSPORTAL_HMAC_SECRET || "";

// Log template config on startup
console.log('[startup] Template config:', {
  BRIDGE_TEMPLATE_NAME,
  BRIDGE_TEMPLATE_LANG,
  BRIDGE_API_KEY: BRIDGE_API_KEY ? `${BRIDGE_API_KEY.substring(0, 8)}...` : 'MISSING',
  fromEnv: {
    templateName: process.env.BRIDGE_TEMPLATE_NAME || 'NOT SET',
    templateLang: process.env.BRIDGE_TEMPLATE_LANG || 'NOT SET',
    apiKey: process.env.BRIDGE_API_KEY ? 'SET' : 'NOT SET'
  }
});

const app = express();

// Middleware
const jsonParser = express.json({ limit: '128kb' });
app.use(morgan("tiny"));
app.use(requestLogger);

// Serve static files from public directory
app.use(express.static('public'));

// CORS for admin routes
app.use('/admin/*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization, X-Admin-Token, Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }
  
  next();
});

// Global inbound message buffer
global.LAST_INBOUND = (typeof global.LAST_INBOUND !== "undefined") ? global.LAST_INBOUND : null;

// Registry management
let REGISTRY = new Map();
function loadRegistry() {
  REGISTRY = new Map();
  if (!fs.existsSync(REGISTRY_PATH)) return;
  const rows = fs.readFileSync(REGISTRY_PATH, "utf8").split(/\r?\n/).filter(Boolean);
  rows.shift(); // header
  for (const line of rows) {
    const cells = line.split(",");
    if (cells.length < 6) continue;
    const [building, building_code, lift_id, msisdn, ...recips] = cells.map(s => s.trim());
    const recipients = recips.filter(Boolean);
    REGISTRY.set((msisdn || "").replace(/\D/g, ""), { building, building_code, lift_id, recipients });
  }
  console.log(`[registry] loaded ${REGISTRY.size} entries from ${REGISTRY_PATH}`);
}
loadRegistry();

// Routes
app.get("/", (_req, res) => res.status(200).send("woosh-lifts: ok"));

// Mount SMS routes
app.use('/sms', smsRoutes);
app.use('/send', sendRoutes);
app.use('/admin', adminRoutes);

// Admin status endpoint
app.get('/admin/status', async (req, res) => {
  try {
    const templateEnabled = Boolean(process.env.BRIDGE_TEMPLATE_NAME && process.env.BRIDGE_TEMPLATE_LANG);
    
    // Check database connectivity and get counts
    let dbStatus = { db: false, lifts_count: 0, contacts_count: 0, last_event_ts: null };
    try {
      const [liftsResult, contactsResult, lastEventResult] = await Promise.all([
        query('SELECT COUNT(*) as count FROM lifts'),
        query('SELECT COUNT(*) as count FROM contacts'),
        query('SELECT MAX(ts) as last_ts FROM events')
      ]);
      
      dbStatus = {
        db: true,
        lifts_count: parseInt(liftsResult.rows[0].count),
        contacts_count: parseInt(contactsResult.rows[0].count),
        last_event_ts: lastEventResult.rows[0].last_ts
      };
    } catch (dbError) {
      console.warn('[admin/status] database check failed:', dbError.message);
    }
    
    // Build info
    const build = {
      node: process.version,
      commit: process.env.COMMIT_SHA || process.env.APP_BUILD || process.env.GIT_SHA || 'unknown',
      platform: 'replit'
    };
    
    res.json({
      ok: true,
      bridge: true,
      secrets: true,
      env: process.env.ENV || 'dev',
      templateEnabled,
      templateName: process.env.BRIDGE_TEMPLATE_NAME || null,
      templateLang: process.env.BRIDGE_TEMPLATE_LANG || null,
      ...dbStatus,
      build,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[admin/status] error:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
});

// Health check endpoint
app.get('/healthz', (_, res) => res.send('ok'));

// Debug endpoint
app.get('/__debug', (req, res) => {
  const routes = [];
  (app._router?.stack || []).forEach(layer => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
      routes.push({ path: layer.route.path, methods });
    }
  });
  res.json({
    build: process.env.APP_BUILD || null,
    entry: (require.main && require.main.filename) || null,
    cwd: process.cwd(),
    routes,
    platform: 'replit'
  });
});

// Helper functions
const logEvent = (event, extra = {}) =>
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...extra }));

const plus = d => (d ? `+${d}` : '');
const digits = v => (v ?? '').toString().replace(/\D+/g, '');

function normalize(body = {}) {
  const id = body.id ?? body.Id ?? body.messageId ?? body.reqId ?? `gen-${Date.now()}`;
  const phoneRaw = body.phone ?? body.phoneNumber ?? body.msisdn ?? body.to ?? body.from ?? '';
  const textRaw = body.text ?? body.incomingData ?? body.IncomingData ?? body.message ?? body.body ?? '';
  return {
    smsId: String(id).slice(0, 128),
    toDigits: digits(phoneRaw).slice(0, 20),
    incoming: String(textRaw || '').trim().slice(0, 1024)
  };
}

// Template sender
async function sendTemplateRaw({ to, name, langCode, paramText }) {
  const payload = {
    to,
    type: "template",
    template: {
      name,
      language: { code: langCode },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: paramText }]
        }
      ]
    }
  };
  const resp = await fetch(`${BRIDGE_BASE_URL.replace(/\/+$/,'')}/v1/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${BRIDGE_API_KEY}`,
      "X-Api-Key": `${BRIDGE_API_KEY}`
    },
    body: JSON.stringify(payload),
    timeout: 10_000
  });
  const text = await resp.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!resp.ok) {
    const err = new Error("bridge_template_error");
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Direct SMS route
app.post('/sms/direct', jsonParser, async (req, res) => {
  try {
    console.log('[sms/direct] Incoming SMS:', JSON.stringify(req.body));
    const { smsId, toDigits, incoming } = normalize(req.body || {});
    if (!toDigits || !incoming) {
      console.log('[sms/direct] Bad request - missing phone or text');
      return res.status(400).json({ ok: false, error: 'bad_request', detail: 'missing phone/text' });
    }
    logEvent('sms_received', { sms_id: smsId, lift_msisdn: plus(toDigits), text_len: incoming.length, direct: true });

    // Store in global buffer
    global.LAST_INBOUND = {
      id: smsId,
      from: toDigits,
      message: incoming,
      received_at: new Date().toISOString(),
      raw: req.body
    };

    // Look up lift by MSISDN
    const liftResult = await query('SELECT * FROM lifts WHERE msisdn = $1', [toDigits]);
    if (liftResult.rows.length === 0) {
      logEvent('lift_not_found', { sms_id: smsId, lift_msisdn: plus(toDigits) });
      return res.status(404).json({ ok: false, error: 'lift_not_found', id: smsId });
    }

    const lift = liftResult.rows[0];
    logEvent('lift_found', { sms_id: smsId, lift_id: lift.id, lift_msisdn: plus(toDigits), site: lift.site_name, building: lift.building });

    // Get all linked contacts
    const contactsResult = await query(
      `SELECT c.*, lc.relation
       FROM contacts c
       JOIN lift_contacts lc ON c.id = lc.contact_id
       WHERE lc.lift_id = $1`,
      [lift.id]
    );

    if (contactsResult.rows.length === 0) {
      logEvent('no_contacts', { sms_id: smsId, lift_id: lift.id });
      return res.status(404).json({ ok: false, error: 'no_contacts_linked', id: smsId });
    }

    const contacts = contactsResult.rows;
    logEvent('contacts_found', { sms_id: smsId, lift_id: lift.id, contact_count: contacts.length });

    // Send WhatsApp template to all contacts
    const tplName = BRIDGE_TEMPLATE_NAME;
    const tplLang = BRIDGE_TEMPLATE_LANG;
    const results = [];

    for (const contact of contacts) {
      const to = contact.primary_msisdn;
      const displayName = contact.display_name || 'Contact';
      
      if (!to) {
        logEvent('contact_no_phone', { sms_id: smsId, contact_id: contact.id, display_name: displayName });
        continue;
      }

      if (tplName) {
        console.log(`[sms/direct] Sending template to ${displayName} (${to}):`, { name: tplName, lang: tplLang });
        try {
          const r = await sendTemplateRaw({
            to,
            name: tplName,
            langCode: tplLang,
            paramText: `${lift.site_name || 'Site'} - ${lift.building || 'Lift'}`
          });
          console.log(`[sms/direct] Template sent successfully to ${displayName}:`, r);
          logEvent('wa_template_ok', { 
            sms_id: smsId, 
            contact_id: contact.id,
            contact_name: displayName,
            to: plus(to), 
            provider_id: r?.id || null, 
            templateName: tplName, 
            lang: tplLang 
          });
          results.push({ contact_id: contact.id, to, status: 'sent', template: true });
        } catch (e) {
          const status = e?.status || null;
          const errBody = e?.body || e?.message || String(e);
          console.error(`[sms/direct] Template failed for ${displayName}:`, { status, body: errBody });
          logEvent('wa_template_fail', { 
            sms_id: smsId, 
            contact_id: contact.id,
            contact_name: displayName,
            to: plus(to), 
            status, 
            body: errBody 
          });
          results.push({ contact_id: contact.id, to, status: 'failed', error: errBody });
        }
      } else {
        console.log('[sms/direct] No template name configured, skipping template');
      }
    }

    const successCount = results.filter(r => r.status === 'sent').length;
    logEvent('wa_batch_complete', { 
      sms_id: smsId, 
      lift_id: lift.id, 
      total: results.length, 
      success: successCount, 
      failed: results.length - successCount 
    });

    return res.status(202).json({ 
      ok: true, 
      id: smsId, 
      lift_id: lift.id,
      contacts_notified: successCount,
      total_contacts: results.length,
      results 
    });
  } catch (err) {
    logEvent('handler_error', { error: String(err && err.stack || err) });
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// HMAC helpers
function toStr(body) {
  return Buffer.isBuffer(body) ? body.toString("utf8")
       : typeof body === "string" ? body
       : (body && typeof body === "object") ? JSON.stringify(body)
       : "";
}

function verifySignature(req, raw) {
  const sig = req.header("x-signature") || "";
  const calc = crypto.createHmac("sha256", HMAC_SECRET).update(raw).digest("hex");
  if (!sig || sig.length !== calc.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(calc));
}

// SMS inbound route (with HMAC verification)
app.post("/sms/inbound", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const raw = toStr(req.body) || "";
    if (!verifySignature(req, raw)) {
      console.warn("[inbound] invalid signature");
      return res.status(401).json({ error: "invalid signature" });
    }
    const evt = JSON.parse(raw);
    console.log("[inbound] Incoming SMS:", evt);

    const { smsId, toDigits, incoming } = normalize(evt || {});
    if (!toDigits || !incoming) {
      console.log('[inbound] Bad request - missing phone or text');
      return res.status(400).json({ ok: false, error: 'bad_request', detail: 'missing phone/text' });
    }
    logEvent('sms_received', { sms_id: smsId, lift_msisdn: plus(toDigits), text_len: incoming.length, direct: false });

    // Store in global buffer
    global.LAST_INBOUND = {
      id: smsId,
      from: toDigits,
      message: incoming,
      received_at: new Date().toISOString(),
      raw: (raw && raw.length <= 4096) ? evt : "[raw-too-large]"
    };

    // Look up lift by MSISDN
    const liftResult = await query('SELECT * FROM lifts WHERE msisdn = $1', [toDigits]);
    if (liftResult.rows.length === 0) {
      logEvent('lift_not_found', { sms_id: smsId, lift_msisdn: plus(toDigits) });
      return res.status(404).json({ ok: false, error: 'lift_not_found', id: smsId });
    }

    const lift = liftResult.rows[0];
    logEvent('lift_found', { sms_id: smsId, lift_id: lift.id, lift_msisdn: plus(toDigits), site: lift.site_name, building: lift.building });

    // Get all linked contacts
    const contactsResult = await query(
      `SELECT c.*, lc.relation
       FROM contacts c
       JOIN lift_contacts lc ON c.id = lc.contact_id
       WHERE lc.lift_id = $1`,
      [lift.id]
    );

    if (contactsResult.rows.length === 0) {
      logEvent('no_contacts', { sms_id: smsId, lift_id: lift.id });
      return res.status(404).json({ ok: false, error: 'no_contacts_linked', id: smsId });
    }

    const contacts = contactsResult.rows;
    logEvent('contacts_found', { sms_id: smsId, lift_id: lift.id, contact_count: contacts.length });

    // Send WhatsApp template to all contacts
    const tplName = BRIDGE_TEMPLATE_NAME;
    const tplLang = BRIDGE_TEMPLATE_LANG;
    const results = [];

    for (const contact of contacts) {
      const to = contact.primary_msisdn;
      const displayName = contact.display_name || 'Contact';
      
      if (!to) {
        logEvent('contact_no_phone', { sms_id: smsId, contact_id: contact.id, display_name: displayName });
        continue;
      }

      if (tplName) {
        console.log(`[inbound] Sending template to ${displayName} (${to}):`, { name: tplName, lang: tplLang });
        try {
          const r = await sendTemplateRaw({
            to,
            name: tplName,
            langCode: tplLang,
            paramText: `${lift.site_name || 'Site'} - ${lift.building || 'Lift'}`
          });
          console.log(`[inbound] Template sent successfully to ${displayName}:`, r);
          logEvent('wa_template_ok', { 
            sms_id: smsId, 
            contact_id: contact.id,
            contact_name: displayName,
            to: plus(to), 
            provider_id: r?.id || null, 
            templateName: tplName, 
            lang: tplLang 
          });
          results.push({ contact_id: contact.id, to, status: 'sent', template: true });
        } catch (e) {
          const status = e?.status || null;
          const errBody = e?.body || e?.message || String(e);
          console.error(`[inbound] Template failed for ${displayName}:`, { status, body: errBody });
          logEvent('wa_template_fail', { 
            sms_id: smsId, 
            contact_id: contact.id,
            contact_name: displayName,
            to: plus(to), 
            status, 
            body: errBody 
          });
          results.push({ contact_id: contact.id, to, status: 'failed', error: errBody });
        }
      } else {
        console.log('[inbound] No template name configured, skipping template');
      }
    }

    const successCount = results.filter(r => r.status === 'sent').length;
    logEvent('wa_batch_complete', { 
      sms_id: smsId, 
      lift_id: lift.id, 
      total: results.length, 
      success: successCount, 
      failed: results.length - successCount 
    });

    return res.status(202).json({ 
      ok: true, 
      id: smsId, 
      lift_id: lift.id,
      contacts_notified: successCount,
      total_contacts: results.length,
      results 
    });
  } catch (err) {
    logEvent('handler_error', { error: String(err && err.stack || err) });
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// Admin endpoints
app.post("/admin/registry/reload", (_req, res) => {
  loadRegistry();
  res.json({ status: "ok", size: REGISTRY.size });
});

app.post("/admin/ping-bridge", express.json(), async (req, res) => {
  try {
    const { to, text } = req.body;
    if (!to || !text) {
      return res.status(400).json({ error: "missing to or text parameter" });
    }
    
    const response = await fetch(`${BRIDGE_BASE_URL}/api/messages/send`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "X-Api-Key": BRIDGE_API_KEY 
      },
      body: JSON.stringify({ to, text })
    });
    
    const result = await response.json();
    if (!response.ok) {
      console.error("[admin] bridge error", response.status, result);
      return res.status(500).json({ error: "bridge_error", detail: result });
    }
    
    res.json({ status: "ok", bridge_response: result });
  } catch (e) {
    console.error("[admin] ping error", e);
    res.status(500).json({ error: "server_error", message: e.message });
  }
});

// Latest inbound reader
app.get("/api/inbound/latest", (_req, res) => {
  if (!global.LAST_INBOUND) return res.status(404).json({ error: "no_inbound_yet" });
  res.json(global.LAST_INBOUND);
});

// Ensure global buffer exists
if (typeof global.LAST_INBOUND === "undefined") global.LAST_INBOUND = null;

// Error handling middleware
app.use(errorHandler);

// Server startup
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = '0.0.0.0';

async function start() {
  try {
    // Test database connection
    try {
      await query('SELECT 1');
      console.log('[startup] Database connection successful');
    } catch (dbError) {
      console.warn('[startup] Database connection failed:', dbError.message);
      console.log('[startup] Continuing without database...');
    }

    const server = app.listen(PORT, HOST, () => {
      console.log(JSON.stringify({ level: 'info', msg: 'server_listening', port: PORT, host: HOST, platform: 'replit' }));
    });
    return server;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'boot_error', error: err?.message, stack: err?.stack }));
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  start();
}

module.exports = { app, start };
