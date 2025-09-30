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

// Environment configuration
const BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL || "https://wa.woosh.ai";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";
const BRIDGE_TEMPLATE_NAME = process.env.BRIDGE_TEMPLATE_NAME || "growthpoint_testv1";
const BRIDGE_TEMPLATE_LANG = ((process.env.BRIDGE_TEMPLATE_LANG || "en").trim().split(/[_-]/)[0] || "en");
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./data/registry.csv";
const HMAC_SECRET = process.env.SMSPORTAL_HMAC_SECRET || "";

const app = express();

// Middleware
const jsonParser = express.json({ limit: '128kb' });
app.use(morgan("tiny"));
app.use(requestLogger);

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
    const { smsId, toDigits, incoming } = normalize(req.body || {});
    if (!toDigits || !incoming) {
      return res.status(400).json({ ok: false, error: 'bad_request', detail: 'missing phone/text' });
    }
    logEvent('sms_received', { sms_id: smsId, to: plus(toDigits), text_len: incoming.length, direct: true });

    const tplName = process.env.BRIDGE_TEMPLATE_NAME;
    const tplLang = BRIDGE_TEMPLATE_LANG;
    const to = toDigits;

    if (tplName) {
      try {
        const r = await sendTemplateRaw({
          to,
          name: tplName,
          langCode: tplLang,
          paramText: "Emergency Button"
        });
        logEvent('wa_template_ok', { sms_id: smsId, to: plus(to), provider_id: r?.id || null, templateName: tplName, lang: tplLang, variant: 'bridge_raw' });
        return res.status(202).json({ ok: true, template: true, id: smsId });
      } catch (e) {
        const status = e?.status || null;
        const errBody = e?.body || e?.message || String(e);
        logEvent('wa_template_fail', { sms_id: smsId, to: plus(to), status, body: errBody, variant: 'bridge_raw' });
      }
    }
    
    // Fallback to plain text
    try {
      const r2 = await sendTextViaBridge({ 
        baseUrl: BRIDGE_BASE_URL,
        apiKey: BRIDGE_API_KEY,
        to, 
        text: `SMS received: "${incoming}"` 
      });
      logEvent('wa_send_ok', { sms_id: smsId, to: plus(to), provider_id: r2?.id || null, fallback: true });
      return res.status(202).json({ ok: true, template: false, id: smsId });
    } catch (e2) {
      logEvent('wa_send_fail', { sms_id: smsId, to: plus(toDigits), status: e2?.status || null, body: e2?.body || e2?.message || String(e2) });
      return res.status(502).json({ ok: false, error: 'bridge_send_failed', id: smsId });
    }
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

// SMS inbound route (simplified - no Pub/Sub)
app.post("/sms/inbound", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const raw = toStr(req.body) || "";
    if (!verifySignature(req, raw)) {
      console.warn("[inbound] invalid signature");
      return res.status(401).json({ error: "invalid signature" });
    }
    const evt = JSON.parse(raw);
    console.log("[inbound] event", evt);

    const b = evt || {};
    const s = v => (v === null || v === undefined) ? "" : String(v).trim();

    const smsId = s(b.id) || s(b.Id) || `sms-${Date.now()}`;
    const rawPhone = s(b.phone) || s(b.phoneNumber) || s(b.to) || s(b.msisdn) || s(b.from);
    const toDigits = rawPhone.replace(/[^\d]/g, "");
    let incoming = s(b.text) || s(b.incomingData) || s(b.IncomingData) || s(b.message) || s(b.body);

    if (incoming.length > 1024) incoming = incoming.slice(0, 1024);

    if (!toDigits || !incoming) {
      return res.status(400).json({ ok: false, error: "missing phone/text" });
    }

    console.log(JSON.stringify({
      event: "sms_received_inbound",
      sms_id: smsId,
      to: toDigits,
      text_len: incoming.length
    }));

    // Template-first processing (simplified)
    let templateAttempted = false;
    if (BRIDGE_API_KEY && BRIDGE_TEMPLATE_NAME && toDigits && incoming) {
      templateAttempted = true;
      try {
        const components = [{ type: "body", parameters: [{ type: "text", text: incoming }]}];
        const graph = await sendTemplateViaBridge({
          baseUrl: BRIDGE_BASE_URL,
          apiKey: BRIDGE_API_KEY,
          to: toDigits,
          name: BRIDGE_TEMPLATE_NAME,
          languageCode: (BRIDGE_TEMPLATE_LANG === "en" ? "en_US" : BRIDGE_TEMPLATE_LANG),
          components
        });
        const wa_id = graph?.messages?.[0]?.id || null;
        console.log(JSON.stringify({ event: "wa_template_ok_inbound", sms_id: smsId, to: toDigits, templateName: BRIDGE_TEMPLATE_NAME, lang: BRIDGE_TEMPLATE_LANG, wa_id, text_len: incoming.length }));
      } catch (e) {
        console.log(JSON.stringify({
          event: "wa_template_fail_inbound",
          sms_id: smsId,
          to: toDigits,
          templateName: BRIDGE_TEMPLATE_NAME,
          lang: BRIDGE_TEMPLATE_LANG,
          status: e?.status || 0,
          body: e?.body || String(e)
        }));
      }
    }

    // Store in global buffer instead of Pub/Sub
    global.LAST_INBOUND = {
      id: smsId,
      from: toDigits,
      message: incoming,
      received_at: new Date().toISOString(),
      raw: (raw && raw.length <= 4096) ? evt : "[raw-too-large]"
    };

    console.log(JSON.stringify({ event: "wa_send_ok_inbound", sms_id: smsId, to: toDigits, text_len: incoming.length, fallback: true }));
    return res.status(200).json({ status: "ok", processed: true, message_id: smsId });
  } catch (e) {
    console.error("[inbound] error", e);
    return res.status(500).json({ error: "server_error" });
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
const PORT = parseInt(process.env.PORT || '8080', 10);
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
