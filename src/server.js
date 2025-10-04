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
const statusRoutes = require('./routes/status');
const troubleshootRoutes = require('./routes/troubleshoot');
const chatRoutes = require('./routes/chat');
const aiTestRoutes = require('./routes/ai-test');
const chatDebugRoutes = require('./routes/chat-debug');

// Environment configuration
const BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL || "https://wa.woosh.ai";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";
const BRIDGE_TEMPLATE_NAME = process.env.BRIDGE_TEMPLATE_NAME || "growthpoint_lift_emergency";
const BRIDGE_TEMPLATE_LANG = (process.env.BRIDGE_TEMPLATE_LANG || "en").trim();
const REGISTRY_PATH = process.env.REGISTRY_PATH || "./data/registry.csv";
const HMAC_SECRET = process.env.SMSPORTAL_HMAC_SECRET || "";

// ============================================================================
// APPLICATION LOG CAPTURE SYSTEM
// ============================================================================
// Captures console.log/error/warn output for AI troubleshooting access
const LOG_BUFFER = [];
const MAX_LOG_BUFFER_SIZE = 1000;

function captureLog(level, ...args) {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  
  LOG_BUFFER.push({
    timestamp: new Date().toISOString(),
    level: level,
    message: message
  });
  
  // Keep buffer size manageable
  if (LOG_BUFFER.length > MAX_LOG_BUFFER_SIZE) {
    LOG_BUFFER.shift();
  }
}

// Store original console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Wrap console methods to capture logs
console.log = function(...args) {
  captureLog('info', ...args);
  originalLog.apply(console, args);
};

console.error = function(...args) {
  captureLog('error', ...args);
  originalError.apply(console, args);
};

console.warn = function(...args) {
  captureLog('warn', ...args);
  originalWarn.apply(console, args);
};

// Make LOG_BUFFER accessible globally for troubleshoot routes
global.LOG_BUFFER = LOG_BUFFER;

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

// Admin status endpoint (public - no auth required)
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

// Mount routes
app.use('/sms', smsRoutes);
app.use('/send', sendRoutes);
app.use('/admin', adminRoutes);
app.use('/api/status', statusRoutes);

// Mount AI troubleshooting routes (read-only with authentication)
app.use('/api/troubleshoot', troubleshootRoutes);

// Mount call centre chat routes
app.use('/api/chat', chatRoutes);
app.use('/api/ai-test', aiTestRoutes);
app.use('/api/chat-debug', chatDebugRoutes);

// Fix sequence endpoint
app.post('/admin/fix-sequence', async (req, res) => {
  try {
    const token = req.header('X-Admin-Token') || req.header('Authorization')?.replace('Bearer ', '');
    const adminToken = process.env.ADMIN_TOKEN;
    
    if (!adminToken || !token || token !== adminToken) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    // Fix tickets sequence
    await query("SELECT setval('tickets_id_seq', (SELECT COALESCE(MAX(id), 1) FROM tickets))");
    
    res.json({ ok: true, message: 'Sequence fixed' });
  } catch (error) {
    console.error('[admin/fix-sequence] error:', error);
    res.status(500).json({ ok: false, error: error.message });
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
const logEvent = async (event_type, data = {}) => {
  const logData = { event: event_type, ts: new Date().toISOString(), ...data };
  console.log(JSON.stringify(logData));
  
  // Store in database for queryable logs
  try {
    await query(
      `INSERT INTO event_log (event_type, ticket_id, lift_id, contact_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        event_type,
        data.ticket_id || null,
        data.lift_id || null,
        data.contact_id || null,
        JSON.stringify(data)
      ]
    );
  } catch (err) {
    // Don't fail the request if logging fails
    console.error('[logEvent] Failed to store event:', err.message);
  }
};

const plus = d => (d ? `+${d}` : '');
const digits = v => (v ?? '').toString().replace(/\D+/g, '');

// Generate human-readable ticket reference
function generateTicketReference(lift, ticketId) {
  // Clean building name: remove special chars, take first 3 words max
  const buildingClean = (lift.building || 'LIFT')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .substring(0, 20);
  
  // Format: BUILDING-TKT123
  return `${buildingClean}-TKT${ticketId}`;
}

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
  // Direct Meta Graph API integration
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID || "861610750363214";
  const accessToken = process.env.META_ACCESS_TOKEN;
  
  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: name,
      language: { code: langCode }
    }
  };
  
  // Add parameters if provided
  if (paramText) {
    payload.template.components = [
      {
        type: "body",
        parameters: [{ type: "text", text: paramText }]
      }
    ];
  }
  
  const resp = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload),
    timeout: 10_000
  });
  const text = await resp.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!resp.ok) {
    const err = new Error("meta_template_error");
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  
  // Transform Meta response to match expected format
  // Meta returns: { messages: [{ id: "wamid..." }] }
  // We need: { wa_id: "wamid..." } for compatibility
  const waId = body?.messages?.[0]?.id;
  return {
    ok: true,
    wa_id: waId,
    id: waId,
    graph: body
  };
}

// Direct SMS route
app.post('/sms/direct', jsonParser, async (req, res) => {
  try {
    console.log('[sms/direct] ===== INCOMING SMS WEBHOOK =====');
    console.log('[sms/direct] Full payload:', JSON.stringify(req.body, null, 2));
    console.log('[sms/direct] Content-Type:', req.get('content-type'));
    console.log('[sms/direct] Headers:', JSON.stringify(req.headers));
    
    const { smsId, toDigits, incoming } = normalize(req.body || {});
    console.log(`[sms/direct] Normalized - SMS ID: ${smsId}, Phone: ${toDigits}, Message: ${incoming}`);
    
    if (!toDigits || !incoming) {
      console.log('[sms/direct] ERROR: Bad request - missing phone or text');
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

    // Log inbound SMS message to messages table
    await query(
      `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, meta)
       VALUES ($1, $2, 'in', 'sms', 'received', $3, $4)`,
      [lift.id, toDigits, incoming, JSON.stringify({ sms_id: smsId })]
    );
    console.log('[sms/direct] ✅ Logged inbound SMS to messages table');

    // Create ticket for this emergency with timer started
    const ticketResult = await query(
      `INSERT INTO tickets (lift_id, sms_id, status, notes, reminder_count, last_reminder_at)
       VALUES ($1, $2, 'open', $3, 0, now())
       RETURNING *`,
      [lift.id, smsId, incoming]
    );
    const ticket = ticketResult.rows[0];
    
    // Generate and update ticket reference
    const ticketRef = generateTicketReference(lift, ticket.id);
    await query(
      `UPDATE tickets SET ticket_reference = $1 WHERE id = $2`,
      [ticketRef, ticket.id]
    );
    ticket.ticket_reference = ticketRef;
    
    logEvent('ticket_created', { ticket_id: ticket.id, sms_id: smsId, lift_id: lift.id, ticket_ref: ticketRef });

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
    let firstMessageId = null;

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
          const locationText = `[${ticketRef}] ${lift.site_name || 'Site'} - ${lift.building || 'Lift'}`;
          const r = await sendTemplateRaw({
            to,
            name: tplName,
            langCode: tplLang,
            paramText: locationText
          });
          console.log(`[sms/direct] Template sent successfully to ${displayName}:`, r);
          
          // Capture first message ID for backward compatibility
          if (!firstMessageId && (r?.wa_id || r?.id)) {
            firstMessageId = r.wa_id || r.id;
            console.log(`[sms/direct] Captured message ID for ticket tracking: ${firstMessageId}`);
          }
          
          // Save to ticket_messages for precise button click matching
          const messageId = r?.wa_id || r?.id;
          if (messageId) {
            try {
              await query(
                `INSERT INTO ticket_messages (ticket_id, contact_id, message_id, message_kind)
                 VALUES ($1, $2, $3, 'initial')`,
                [ticket.id, contact.id, messageId]
              );
              console.log(`[sms/direct] Saved message ID ${messageId} to ticket_messages`);
            } catch (msgErr) {
              console.error(`[sms/direct] Failed to save message to ticket_messages:`, msgErr);
            }
            
            // Also log to messages table for observability
            try {
              const messageBody = `Emergency alert: ${lift.site_name || 'Site'} - ${lift.building || 'Lift'}. Please respond: Test, Maintenance, or Entrapment?`;
              await query(
                `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, wa_id, meta)
                 VALUES ($1, $2, 'out', 'whatsapp_template', 'sent', $3, $4, $5)`,
                [lift.id, to, messageBody, messageId, JSON.stringify({ template: tplName, ticket_id: ticket.id })]
              );
              console.log(`[sms/direct] ✅ Logged outbound WhatsApp template to messages table`);
            } catch (logErr) {
              console.error(`[sms/direct] Failed to log message to messages table:`, logErr);
            }
          }
          
          logEvent('wa_template_ok', { 
            sms_id: smsId, 
            contact_id: contact.id,
            contact_name: displayName,
            to: plus(to), 
            provider_id: r?.id || null,
            wa_id: r?.wa_id || null,
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
    
    // Update ticket with message ID for button click tracking
    if (firstMessageId) {
      await query(
        `UPDATE tickets SET message_id = $1 WHERE id = $2`,
        [firstMessageId, ticket.id]
      );
      console.log(`[sms/direct] Ticket ${ticket.id} updated with message_id: ${firstMessageId}`);
    }

    const successCount = results.filter(r => r.status === 'sent').length;
    logEvent('wa_batch_complete', { 
      sms_id: smsId, 
      lift_id: lift.id, 
      total: results.length, 
      success: successCount, 
      failed: results.length - successCount 
    });

    console.log(`[sms/direct] SUCCESS: Ticket ${ticket.id} created, ${successCount}/${results.length} contacts notified`);
    console.log('[sms/direct] ===== END SMS WEBHOOK =====');

    return res.status(202).json({ 
      ok: true, 
      id: smsId, 
      lift_id: lift.id,
      contacts_notified: successCount,
      total_contacts: results.length,
      results 
    });
  } catch (err) {
    console.error('[sms/direct] EXCEPTION:', err);
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

    // Log inbound SMS message to messages table
    await query(
      `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, meta)
       VALUES ($1, $2, 'in', 'sms', 'received', $3, $4)`,
      [lift.id, toDigits, incoming, JSON.stringify({ sms_id: smsId })]
    );
    console.log('[sms/inbound] ✅ Logged inbound SMS to messages table');

    // Create ticket for this emergency with timer started
    const ticketResult = await query(
      `INSERT INTO tickets (lift_id, sms_id, status, notes, reminder_count, last_reminder_at)
       VALUES ($1, $2, 'open', $3, 0, now())
       RETURNING *`,
      [lift.id, smsId, incoming]
    );
    const ticket = ticketResult.rows[0];
    
    // Generate and update ticket reference
    const ticketRef = generateTicketReference(lift, ticket.id);
    await query(
      `UPDATE tickets SET ticket_reference = $1 WHERE id = $2`,
      [ticketRef, ticket.id]
    );
    ticket.ticket_reference = ticketRef;
    
    logEvent('ticket_created', { ticket_id: ticket.id, sms_id: smsId, lift_id: lift.id, ticket_ref: ticketRef });

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
    let firstMessageId = null;

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
          const locationText = `[${ticketRef}] ${lift.site_name || 'Site'} - ${lift.building || 'Lift'}`;
          const r = await sendTemplateRaw({
            to,
            name: tplName,
            langCode: tplLang,
            paramText: locationText
          });
          console.log(`[inbound] Template sent successfully to ${displayName}:`, r);
          
          // Capture first message ID for backward compatibility
          if (!firstMessageId && (r?.wa_id || r?.id)) {
            firstMessageId = r.wa_id || r.id;
            console.log(`[inbound] Captured message ID for ticket tracking: ${firstMessageId}`);
          }
          
          // Save to ticket_messages for precise button click matching
          const messageId = r?.wa_id || r?.id;
          if (messageId) {
            try {
              await query(
                `INSERT INTO ticket_messages (ticket_id, contact_id, message_id, message_kind)
                 VALUES ($1, $2, $3, 'initial')`,
                [ticket.id, contact.id, messageId]
              );
              console.log(`[inbound] Saved message ID ${messageId} to ticket_messages`);
            } catch (msgErr) {
              console.error(`[inbound] Failed to save message to ticket_messages:`, msgErr);
            }
            
            // Also log to messages table for observability
            try {
              const messageBody = `Emergency alert: ${lift.site_name || 'Site'} - ${lift.building || 'Lift'}. Please respond: Test, Maintenance, or Entrapment?`;
              await query(
                `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, wa_id, meta)
                 VALUES ($1, $2, 'out', 'whatsapp_template', 'sent', $3, $4, $5)`,
                [lift.id, to, messageBody, messageId, JSON.stringify({ template: tplName, ticket_id: ticket.id })]
              );
              console.log(`[inbound] ✅ Logged outbound WhatsApp template to messages table`);
            } catch (logErr) {
              console.error(`[inbound] Failed to log message to messages table:`, logErr);
            }
          }
          
          logEvent('wa_template_ok', { 
            sms_id: smsId, 
            contact_id: contact.id,
            contact_name: displayName,
            to: plus(to), 
            provider_id: r?.id || null,
            wa_id: r?.wa_id || null,
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
    
    // Update ticket with message ID for button click tracking
    if (firstMessageId) {
      await query(
        `UPDATE tickets SET message_id = $1 WHERE id = $2`,
        [firstMessageId, ticket.id]
      );
      console.log(`[inbound] Ticket ${ticket.id} updated with message_id: ${firstMessageId}`);
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

// Helper function to send message to all contacts for a lift
async function notifyAllContactsForLift(liftId, message, ticketId = null) {
  try {
    const contactsResult = await query(
      `SELECT c.primary_msisdn, c.display_name 
       FROM contacts c
       JOIN lift_contacts lc ON c.id = lc.contact_id
       WHERE lc.lift_id = $1`,
      [liftId]
    );
    
    const results = [];
    for (const contact of contactsResult.rows) {
      try {
        const response = await sendTextViaBridge({
          baseUrl: BRIDGE_BASE_URL,
          apiKey: BRIDGE_API_KEY,
          to: contact.primary_msisdn,
          text: message
        });
        
        // Log to messages table for observability
        const waId = response?.wa_id || response?.id;
        if (waId) {
          try {
            await query(
              `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, wa_id, meta)
               VALUES ($1, $2, 'out', 'whatsapp_text', 'sent', $3, $4, $5)`,
              [liftId, contact.primary_msisdn, message, waId, JSON.stringify({ notification: true, ticket_id: ticketId })]
            );
            console.log(`[notify] ✅ Logged notification to messages table`);
          } catch (logErr) {
            console.error(`[notify] Failed to log message to messages table:`, logErr);
          }
        }
        
        results.push({ name: contact.display_name, status: 'sent' });
        console.log(`[notify] Sent to ${contact.display_name} (${contact.primary_msisdn})`);
      } catch (err) {
        console.error(`[notify] Failed to send to ${contact.display_name}:`, err);
        results.push({ name: contact.display_name, status: 'failed', error: err.message });
      }
    }
    return results;
  } catch (err) {
    console.error('[notify] Error getting contacts:', err);
    throw err;
  }
}

// WhatsApp webhook verification (GET request)
// Note: Since Woosh Bridge sits between Meta and our app, this may not be called.
// However, we implement it for completeness and potential direct Meta integration.
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  const expectedToken = process.env.WEBHOOK_VERIFY_TOKEN;
  
  console.log('[webhook/whatsapp] Verification request:', { 
    mode, 
    tokenProvided: !!token,
    tokenConfigured: !!expectedToken
  });
  
  // If no token is configured, skip validation (Woosh Bridge handles Meta verification)
  if (!expectedToken) {
    console.log('[webhook/whatsapp] No WEBHOOK_VERIFY_TOKEN configured, accepting verification');
    if (mode === 'subscribe' && challenge) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  
  // If token is configured, validate it
  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[webhook/whatsapp] Verification successful');
    return res.status(200).send(challenge);
  }
  
  console.log('[webhook/whatsapp] Verification failed - token mismatch or invalid mode');
  return res.status(403).send('Forbidden');
});

// WhatsApp webhook for button clicks (POST request)
app.post('/webhooks/whatsapp', jsonParser, async (req, res) => {
  try {
    // Check if webhook is from Meta (direct integration)
    const userAgent = req.get('user-agent') || '';
    const isMetaWebhook = userAgent.includes('facebookexternalua');
    
    // For Meta webhooks, skip auth check (Meta doesn't send Authorization header)
    if (!isMetaWebhook) {
      // Validate Authorization header for non-Meta webhooks
      const expectedToken = process.env.WEBHOOK_AUTH_TOKEN;
      const authHeader = req.headers.authorization;
      
      if (expectedToken) {
        const providedToken = authHeader?.replace(/^Bearer\s+/i, '');
        
        if (!providedToken || providedToken !== expectedToken) {
          console.error('[webhook/whatsapp] ⚠️ SECURITY: Authentication failed - rejecting webhook');
          await logEvent('webhook_auth_failed', { 
            headerProvided: !!authHeader,
            from: req.ip,
            userAgent: userAgent
          });
          return res.status(401).json({ status: 'error', error: 'Unauthorized' });
        }
        console.log('[webhook/whatsapp] ✅ Authentication successful (Bearer token)');
      } else {
        console.log('[webhook/whatsapp] ⚠️ No WEBHOOK_AUTH_TOKEN configured - accepting non-Meta webhook');
      }
    } else {
      console.log('[webhook/whatsapp] ✅ Meta webhook detected - skipping auth check');
    }
    
    console.log('[webhook/whatsapp] Received:', JSON.stringify(req.body, null, 2));
    
    // Log webhook received to database
    await query(
      `INSERT INTO event_log (event_type, metadata, request_payload, created_at)
       VALUES ($1, $2, $3, NOW())`,
      ['webhook_whatsapp_received', JSON.stringify({ source: 'woosh_bridge' }), JSON.stringify(req.body)]
    );
    
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    
    // Check for button click - support both Woosh and Meta formats
    let buttonPayload, buttonText, fromNumber;
    
    if (message?.type === 'button' && message.button) {
      // Woosh Bridge actual format
      buttonPayload = message.button.payload;
      buttonText = message.button.text;
      fromNumber = message.from;
      console.log('[webhook/whatsapp] Button click (Woosh format):', { 
        from: fromNumber, 
        payload: buttonPayload, 
        text: buttonText
      });
    } else if (message?.type === 'interactive' && message.interactive?.type === 'button_reply') {
      // Meta Graph API standard format
      buttonPayload = message.interactive.button_reply.id;
      buttonText = message.interactive.button_reply.title;
      fromNumber = message.from;
      console.log('[webhook/whatsapp] Button click (Meta format):', { 
        from: fromNumber, 
        payload: buttonPayload, 
        text: buttonText
      });
    } else if (message?.type === 'text' && message.text?.body) {
      // Handle text message for chat system
      const textMessage = message.text.body;
      const fromNumber = message.from;
      
      console.log('[webhook/whatsapp] Text message received:', { from: fromNumber, text: textMessage });
      
      // Find contact by WhatsApp number
      const contactResult = await query(
        'SELECT * FROM contacts WHERE primary_msisdn = $1',
        [fromNumber]
      );
      
      if (contactResult.rows.length === 0) {
        console.log('[webhook/whatsapp] Contact not found for text message:', fromNumber);
        return res.status(200).json({ status: 'ok', processed: false, reason: 'contact_not_found' });
      }
      
      const contact = contactResult.rows[0];
      
      // Find most recent open ticket for this contact
      const ticketResult = await query(
        `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
         FROM tickets t
         JOIN lifts l ON t.lift_id = l.id
         JOIN lift_contacts lc ON t.lift_id = lc.lift_id
         WHERE lc.contact_id = $1 
           AND t.status = 'open'
           AND t.created_at > NOW() - INTERVAL '6 hours'
         ORDER BY t.created_at DESC
         LIMIT 1`,
        [contact.id]
      );
      
      if (ticketResult.rows.length === 0) {
        console.log('[webhook/whatsapp] No recent open ticket for contact:', contact.id);
        return res.status(200).json({ status: 'ok', processed: false, reason: 'no_open_ticket' });
      }
      
      const ticket = ticketResult.rows[0];
      
      // Save text message to chat_messages
      await query(
        `INSERT INTO chat_messages (ticket_id, from_number, to_number, message, direction, created_at)
         VALUES ($1, $2, $3, $4, 'inbound', NOW())`,
        [ticket.id, fromNumber, 'system', textMessage]
      );
      
      console.log(`[webhook/whatsapp] Saved text message to ticket ${ticket.id}`);
      
      // Check if message contains "agent" keyword (case-insensitive)
      if (textMessage.toLowerCase().includes('agent')) {
        await query(
          `UPDATE tickets SET agent_requested = true WHERE id = $1`,
          [ticket.id]
        );
        console.log(`[webhook/whatsapp] Agent requested for ticket ${ticket.id}`);
        
        await query(
          `INSERT INTO event_log (event_type, ticket_id, contact_id, metadata, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          ['agent_requested', ticket.id, contact.id, JSON.stringify({ message: textMessage, from: contact.display_name })]
        );
      }
      
      return res.status(200).json({ 
        status: 'ok', 
        processed: true,
        ticket_id: ticket.id,
        message_saved: true
      });
    } else {
      const reason = !message ? 'no_message' : 'not_button';
      console.log('[webhook/whatsapp] Not a button click, ignoring:', {
        hasMessage: !!message,
        messageType: message?.type,
        reason
      });
      
      // Log non-button webhooks too for debugging
      await query(
        `INSERT INTO event_log (event_type, metadata, created_at)
         VALUES ($1, $2, NOW())`,
        ['webhook_not_button_click', JSON.stringify({ reason, messageType: message?.type, hasStatuses: !!value?.statuses })]
      );
      
      return res.status(200).json({ status: 'ok', processed: false });
    }
    
    // Extract context.id (original message ID) for precise ticket matching
    const contextId = message?.context?.id;
    
    // Log button click
    await query(
      `INSERT INTO event_log (event_type, metadata, created_at)
       VALUES ($1, $2, NOW())`,
      ['button_click_received', JSON.stringify({ from: fromNumber, payload: buttonPayload, text: buttonText, contextId })]
    );
    
    // Find contact by WhatsApp number
    const contactResult = await query(
      'SELECT * FROM contacts WHERE primary_msisdn = $1',
      [fromNumber]
    );
    
    if (contactResult.rows.length === 0) {
      console.log('[webhook/whatsapp] Contact not found:', fromNumber);
      await logEvent('button_click_contact_not_found', { from: fromNumber, payload: buttonPayload, contextId });
      return res.status(200).json({ status: 'ok', processed: false, reason: 'contact_not_found' });
    }
    
    const contact = contactResult.rows[0];
    
    // Match button click to specific ticket using context.id via ticket_messages table
    let ticketResult;
    if (contextId) {
      // Precise matching: Look up ticket via ticket_messages using context.id
      console.log('[webhook/whatsapp] Using context.id for precise ticket matching via ticket_messages:', contextId);
      ticketResult = await query(
        `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
         FROM ticket_messages tm
         JOIN tickets t ON tm.ticket_id = t.id
         JOIN lifts l ON t.lift_id = l.id
         WHERE tm.message_id = $1 AND t.status = 'open'
         LIMIT 1`,
        [contextId]
      );
      
      if (ticketResult.rows.length === 0) {
        console.log('[webhook/whatsapp] No ticket found in ticket_messages for context.id:', contextId);
        console.log('[webhook/whatsapp] Falling back to recent ticket lookup for contact within last 6 hours');
        // Narrow fallback: recent ticket for this contact within last 6 hours
        ticketResult = await query(
          `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
           FROM tickets t
           JOIN lifts l ON t.lift_id = l.id
           JOIN lift_contacts lc ON t.lift_id = lc.lift_id
           WHERE lc.contact_id = $1 
             AND t.status = 'open'
             AND t.created_at > NOW() - INTERVAL '6 hours'
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [contact.id]
        );
      } else {
        console.log('[webhook/whatsapp] ✅ Matched button click to ticket via ticket_messages');
      }
    } else {
      // Fallback: No context.id (shouldn't happen with Meta webhooks, but handle it)
      console.log('[webhook/whatsapp] WARNING: No context.id in webhook - using narrow fallback matching');
      ticketResult = await query(
        `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
         FROM tickets t
         JOIN lifts l ON t.lift_id = l.id
         JOIN lift_contacts lc ON t.lift_id = lc.lift_id
         WHERE lc.contact_id = $1 
           AND t.status = 'open'
           AND t.created_at > NOW() - INTERVAL '6 hours'
         ORDER BY t.created_at DESC
         LIMIT 1`,
        [contact.id]
      );
    }
    
    if (ticketResult.rows.length === 0) {
      console.log('[webhook/whatsapp] No open tickets found for contact:', contact.id);
      
      // Check if there are any recent closed tickets to provide helpful feedback
      const closedTicketResult = await query(
        `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
         FROM tickets t
         JOIN lifts l ON t.lift_id = l.id
         JOIN lift_contacts lc ON t.lift_id = lc.lift_id
         WHERE lc.contact_id = $1 
           AND t.status = 'closed'
           AND t.created_at > NOW() - INTERVAL '1 hour'
         ORDER BY t.created_at DESC
         LIMIT 1`,
        [contact.id]
      );
      
      if (closedTicketResult.rows.length > 0) {
        const closedTicket = closedTicketResult.rows[0];
        const ticketRef = closedTicket.ticket_reference || `TKT${closedTicket.id}`;
        
        console.log('[webhook/whatsapp] Found recent closed ticket, sending helpful message');
        
        // Send helpful message about closed ticket
        try {
          await sendTextViaBridge({
            baseUrl: BRIDGE_BASE_URL,
            apiKey: BRIDGE_API_KEY,
            to: fromNumber,
            text: `[${ticketRef}] This ticket has already been closed. If this is a new emergency, please contact us directly.`
          });
          console.log('[webhook/whatsapp] Closed ticket message sent successfully');
        } catch (err) {
          console.error('[webhook/whatsapp] Failed to send closed ticket message:', err);
        }
        
        return res.status(200).json({ 
          status: 'ok', 
          processed: true, 
          reason: 'ticket_already_closed',
          ticket_id: closedTicket.id
        });
      }
      
      return res.status(200).json({ status: 'ok', processed: false, reason: 'no_open_tickets' });
    }
    
    const ticket = ticketResult.rows[0];
    console.log('[webhook/whatsapp] Found ticket:', ticket.id, 'Ref:', ticket.ticket_reference || 'N/A');
    
    // Handle button click based on payload (preferred) or text (fallback)
    const buttonIdentifier = (buttonPayload || buttonText || '').toLowerCase();
    let shouldClose = false;
    let confirmationMessage = '';
    let buttonType = '';
    let sendFollowUpTemplate = false;
    
    // Check specific button types first (order matters!)
    let notifyAllContacts = false;
    
    const ticketRef = ticket.ticket_reference || `TKT${ticket.id}`;
    
    if (buttonIdentifier.includes('yes')) {
      // Yes response to entrapment follow-up (check BEFORE entrapment)
      shouldClose = true;
      buttonType = 'entrapment_yes';
      notifyAllContacts = true;
      confirmationMessage = `[${ticketRef}] We have received a "Yes" response. The service provider has been notified and this ticket has been closed.`;
    } else if (buttonIdentifier.includes('no')) {
      // NO button - this is from the old template, just acknowledge it
      console.log('[webhook/whatsapp] NO button clicked - old template, ignoring');
      return res.status(200).json({ status: 'ok', processed: false, reason: 'no_button_deprecated' });
    } else if (buttonIdentifier.includes('test')) {
      shouldClose = true;
      buttonType = 'test';
      notifyAllContacts = true;
      confirmationMessage = `[${ticketRef}] Test alert resolved. Ticket closed for ${ticket.lift_name || 'Lift'}.`;
    } else if (buttonIdentifier.includes('maintenance') || buttonIdentifier.includes('service')) {
      shouldClose = true;
      buttonType = 'maintenance';
      notifyAllContacts = true;
      confirmationMessage = `[${ticketRef}] Maintenance/Service request resolved. Ticket closed for ${ticket.lift_name || 'Lift'}.`;
    } else if (buttonIdentifier.includes('entrapment')) {
      // Entrapment requires follow-up question (check AFTER yes/no)
      sendFollowUpTemplate = true;
      buttonType = 'entrapment';
      console.log('[webhook/whatsapp] Entrapment clicked, sending follow-up template');
    } else {
      console.log('[webhook/whatsapp] Unknown button type:', buttonIdentifier);
      return res.status(200).json({ status: 'ok', processed: false, reason: 'unknown_button' });
    }
    
    // Handle follow-up message for entrapment
    if (sendFollowUpTemplate) {
      try {
        const { sendInteractiveViaBridge } = require('./lib/bridge');
        
        // Send interactive message asking if service provider was notified (session is open, no template needed)
        console.log(`[webhook/whatsapp] Sending interactive YES button to ${fromNumber} for ticket ${ticket.id}`);
        const ticketRef = ticket.ticket_reference || `TKT${ticket.id}`;
        const bridgeResponse = await sendInteractiveViaBridge({
          baseUrl: BRIDGE_BASE_URL,
          apiKey: BRIDGE_API_KEY,
          to: fromNumber,
          bodyText: `[${ticketRef}] Has the service provider been notified of the entrapment at ${ticket.lift_name}?`,
          buttons: [{ id: "entrapment_yes", title: "YES" }]
        });
        
        console.log('[webhook/whatsapp] Follow-up interactive message sent successfully');
        console.log('[webhook/whatsapp] Bridge API response:', JSON.stringify(bridgeResponse, null, 2));
        
        // Save entrapment follow-up message ID to ticket_messages
        const followupMessageId = bridgeResponse?.wa_id || bridgeResponse?.id;
        if (followupMessageId) {
          try {
            await query(
              `INSERT INTO ticket_messages (ticket_id, contact_id, message_id, message_kind)
               VALUES ($1, $2, $3, 'entrapment_followup')`,
              [ticket.id, contact.id, followupMessageId]
            );
            console.log(`[webhook/whatsapp] Saved entrapment follow-up message ID ${followupMessageId} to ticket_messages`);
          } catch (msgErr) {
            console.error(`[webhook/whatsapp] Failed to save follow-up message to ticket_messages:`, msgErr);
          }
          
          // Also log to messages table for observability
          try {
            const messageBody = `Has the service provider been notified of the entrapment at ${ticket.lift_name}?`;
            await query(
              `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, wa_id, meta)
               VALUES ($1, $2, 'out', 'whatsapp_interactive', 'sent', $3, $4, $5)`,
              [ticket.lift_id, fromNumber, messageBody, followupMessageId, JSON.stringify({ session: true, ticket_id: ticket.id })]
            );
            console.log(`[webhook/whatsapp] ✅ Logged entrapment follow-up to messages table`);
          } catch (logErr) {
            console.error(`[webhook/whatsapp] Failed to log message to messages table:`, logErr);
          }
        }
        
        // Update ticket to track that entrapment was clicked and start reminder timer
        console.log(`[webhook/whatsapp] Updating ticket ${ticket.id} to entrapment_awaiting_confirmation state`);
        const updateResult = await query(
          `UPDATE tickets 
           SET button_clicked = 'entrapment_awaiting_confirmation', 
               responded_by = $1, 
               reminder_count = 0,
               last_reminder_at = now(),
               updated_at = now()
           WHERE id = $2
           RETURNING id, button_clicked, reminder_count, last_reminder_at`,
          [contact.id, ticket.id]
        );
        
        if (updateResult.rows.length === 0) {
          console.error(`[webhook/whatsapp] CRITICAL: Failed to update ticket ${ticket.id} - no rows affected!`);
        } else {
          console.log(`[webhook/whatsapp] Ticket ${ticket.id} updated successfully:`, updateResult.rows[0]);
        }
        
        logEvent('entrapment_followup_sent', { 
          ticket_id: ticket.id, 
          contact_id: contact.id,
          contact_name: contact.display_name 
        });
        
      } catch (err) {
        console.error('[webhook/whatsapp] CRITICAL ERROR in entrapment handler:', {
          error: err.message,
          stack: err.stack,
          ticket_id: ticket.id,
          contact_id: contact.id
        });
        
        // Still return success to Woosh Bridge (don't retry webhook)
        return res.status(200).json({ 
          status: 'error', 
          processed: false, 
          error: 'Failed to process entrapment',
          ticket_id: ticket.id
        });
      }
      
      // After sending follow-up template, return early (reminders will be handled by background job)
      return res.status(200).json({ 
        status: 'ok', 
        processed: true, 
        ticket_id: ticket.id,
        followup_sent: true
      });
    }
    
    // Close ticket and send confirmation
    if (shouldClose) {
      await query(
        `UPDATE tickets 
         SET status = 'closed', 
             button_clicked = $1, 
             responded_by = $2, 
             resolved_at = now(),
             updated_at = now()
         WHERE id = $3`,
        [buttonType, contact.id, ticket.id]
      );
      
      logEvent('ticket_closed', { 
        ticket_id: ticket.id, 
        button: buttonType, 
        contact_id: contact.id,
        contact_name: contact.display_name 
      });
      
      // Send confirmation message to all contacts if required
      if (notifyAllContacts) {
        try {
          const results = await notifyAllContactsForLift(ticket.lift_id, confirmationMessage, ticket.id);
          console.log('[webhook/whatsapp] Notified all contacts:', results);
        } catch (err) {
          console.error('[webhook/whatsapp] Failed to notify all contacts:', err);
        }
      } else {
        // Send confirmation to single contact
        try {
          await sendTextViaBridge({
            baseUrl: BRIDGE_BASE_URL,
            apiKey: BRIDGE_API_KEY,
            to: fromNumber,
            text: confirmationMessage
          });
          console.log('[webhook/whatsapp] Confirmation sent');
        } catch (err) {
          console.error('[webhook/whatsapp] Failed to send confirmation:', err);
        }
      }
    }
    
    return res.status(200).json({ 
      status: 'ok', 
      processed: true, 
      ticket_id: ticket.id,
      closed: shouldClose 
    });
  } catch (err) {
    console.error('[webhook/whatsapp] Error:', err);
    return res.status(500).json({ status: 'error', error: String(err.message) });
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
    
    const response = await fetch(`${BRIDGE_BASE_URL}/v1/send`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "X-API-Key": BRIDGE_API_KEY 
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

// Latest inbound reader (secured with AI auth)
app.get("/api/inbound/latest", (req, res) => {
  // Require authentication
  const token = req.header('X-AI-Token') || 
                req.header('X-Admin-Token') ||
                req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  
  const aiToken = process.env.AI_ASSISTANT_TOKEN;
  const adminToken = process.env.ADMIN_TOKEN;
  
  if (!token || (token !== aiToken && token !== adminToken)) {
    return res.status(401).json({ 
      ok: false, 
      error: 'Authentication required. Provide X-AI-Token or X-Admin-Token header.' 
    });
  }
  
  if (!global.LAST_INBOUND) {
    return res.status(404).json({ 
      ok: false, 
      error: "no_inbound_yet",
      message: "No inbound SMS has been received yet" 
    });
  }
  
  res.json({
    ok: true,
    data: global.LAST_INBOUND
  });
});

// Ensure global buffer exists
if (typeof global.LAST_INBOUND === "undefined") global.LAST_INBOUND = null;

// Error handling middleware
app.use(errorHandler);

// Helper function to process initial alert reminders
async function processInitialAlertReminder(ticket) {
  const newCount = (ticket.reminder_count || 0) + 1;
  console.log(`[reminder] Processing initial alert for ticket ${ticket.id}, reminder ${newCount}/3`);
  
  if (newCount > 3) {
    // All 3 reminders sent with no response - escalate
    await query(
      `UPDATE tickets 
       SET status = 'closed',
           reminder_count = 3,
           resolved_at = now(),
           closure_note = 'Auto-closed: No response to emergency alert after 3 reminders',
           updated_at = now()
       WHERE id = $1`,
      [ticket.id]
    );
    
    const ticketRef = ticket.ticket_reference || `TKT${ticket.id}`;
    const escalationMessage = `⚠️ CRITICAL ALERT: [${ticketRef}] Emergency ticket auto-closed for ${ticket.lift_name}. NO RESPONSE received after 3 reminders. IMMEDIATE ACTION REQUIRED.`;
    try {
      await notifyAllContactsForLift(ticket.lift_id, escalationMessage, ticket.id);
      console.log(`[reminder] Initial alert ticket ${ticket.id} auto-closed, escalation sent`);
      
      logEvent('ticket_auto_closed_no_response', {
        ticket_id: ticket.id,
        lift_id: ticket.lift_id,
        reminder_count: 3
      });
    } catch (err) {
      console.error(`[reminder] Failed to send escalation for ticket ${ticket.id}:`, err);
    }
  } else {
    // Send reminder template to all contacts
    try {
      const { sendTemplateViaBridge } = require('./lib/bridge');
      
      // Get all contacts for this lift
      const contactsResult = await query(
        `SELECT c.* FROM contacts c
         JOIN lift_contacts lc ON c.id = lc.contact_id
         WHERE lc.lift_id = $1`,
        [ticket.lift_id]
      );
      
      const ticketRef = ticket.ticket_reference || `TKT${ticket.id}`;
      const liftLocation = `[${ticketRef}] REMINDER ${newCount}/3: ${ticket.site_name || 'Site'} - ${ticket.building || 'Lift'}`;
      
      for (const contact of contactsResult.rows) {
        if (!contact.primary_msisdn) continue;
        
        try {
          const reminderResponse = await sendTemplateViaBridge({
            baseUrl: BRIDGE_BASE_URL,
            apiKey: BRIDGE_API_KEY,
            to: contact.primary_msisdn,
            name: BRIDGE_TEMPLATE_NAME,
            languageCode: BRIDGE_TEMPLATE_LANG,
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: liftLocation }]
              }
            ]
          });
          
          // Save reminder message ID to ticket_messages
          const reminderMessageId = reminderResponse?.wa_id || reminderResponse?.id;
          if (reminderMessageId) {
            try {
              await query(
                `INSERT INTO ticket_messages (ticket_id, contact_id, message_id, message_kind)
                 VALUES ($1, $2, $3, 'reminder')`,
                [ticket.id, contact.id, reminderMessageId]
              );
            } catch (msgErr) {
              console.error(`[reminder] Failed to save reminder message to ticket_messages:`, msgErr);
            }
            
            // Also log to messages table for observability
            try {
              const messageBody = `REMINDER ${newCount}/3: Emergency alert pending. Please respond: Test, Maintenance, or Entrapment?`;
              await query(
                `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, wa_id, meta)
                 VALUES ($1, $2, 'out', 'whatsapp_template', 'sent', $3, $4, $5)`,
                [ticket.lift_id, contact.primary_msisdn, messageBody, reminderMessageId, JSON.stringify({ reminder: newCount, template: BRIDGE_TEMPLATE_NAME, ticket_id: ticket.id })]
              );
              console.log(`[reminder] ✅ Logged reminder to messages table`);
            } catch (logErr) {
              console.error(`[reminder] Failed to log message to messages table:`, logErr);
            }
          }
          
          console.log(`[reminder] Sent initial alert reminder ${newCount}/3 to ${contact.display_name}`);
        } catch (err) {
          console.error(`[reminder] Failed to send reminder to ${contact.display_name}:`, err);
        }
      }
      
      // Update ticket
      await query(
        `UPDATE tickets 
         SET reminder_count = $1,
             last_reminder_at = now(),
             updated_at = now()
         WHERE id = $2`,
        [newCount, ticket.id]
      );
      
      logEvent('initial_alert_reminder_sent', {
        ticket_id: ticket.id,
        reminder_count: newCount,
        lift_name: ticket.lift_name
      });
    } catch (err) {
      console.error(`[reminder] Failed to process initial alert reminder for ticket ${ticket.id}:`, err);
    }
  }
}

// Background job to check for pending reminders
async function checkPendingReminders() {
  try {
    // Find tickets that need reminders - TWO types:
    // Type 1: Initial alert awaiting any response (button_clicked IS NULL)
    // Type 2: Entrapment awaiting confirmation (button_clicked = 'entrapment_awaiting_confirmation')
    // Both: Status is open, reminder_count <= 3, last_reminder_at > 1 minute ago
    
    // Type 1: Initial alerts with no response
    const initialAlertsResult = await query(
      `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name,
              l.site_name, l.building
       FROM tickets t
       JOIN lifts l ON t.lift_id = l.id
       WHERE t.status = 'open'
         AND t.button_clicked IS NULL
         AND t.reminder_count <= 3
         AND t.last_reminder_at < NOW() - INTERVAL '1 minute'`
    );
    
    // Type 2: Entrapment confirmations
    const entrapmentResult = await query(
      `SELECT t.*, COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name,
              c.primary_msisdn, c.display_name
       FROM tickets t
       JOIN lifts l ON t.lift_id = l.id
       JOIN contacts c ON t.responded_by = c.id
       WHERE t.status = 'open'
         AND t.button_clicked = 'entrapment_awaiting_confirmation'
         AND t.reminder_count <= 3
         AND t.last_reminder_at < NOW() - INTERVAL '1 minute'`
    );
    
    // Process initial alert reminders
    for (const ticket of initialAlertsResult.rows) {
      await processInitialAlertReminder(ticket);
    }
    
    // Process entrapment confirmation reminders
    const result = entrapmentResult;
    
    for (const ticket of result.rows) {
      const newCount = (ticket.reminder_count || 0) + 1;
      console.log(`[reminder] Processing ticket ${ticket.id}, reminder ${newCount}/3`);
      console.log(`[reminder] Ticket data:`, { 
        id: ticket.id, 
        responded_by: ticket.responded_by, 
        primary_msisdn: ticket.primary_msisdn,
        display_name: ticket.display_name
      });
      
      if (!ticket.primary_msisdn) {
        console.error(`[reminder] Ticket ${ticket.id} has no primary_msisdn, skipping`);
        continue;
      }
      
      if (newCount > 3) {
        // All 3 reminders sent with no response - close ticket with note
        await query(
          `UPDATE tickets 
           SET status = 'closed',
               reminder_count = 3,
               resolved_at = now(),
               closure_note = 'Auto-closed: Service provider notification not confirmed after 3 reminders',
               updated_at = now()
           WHERE id = $1`,
          [ticket.id]
        );
        
        const finalMessage = `⚠️ ALERT: Ticket auto-closed for ${ticket.lift_name}. Service provider notification was NOT confirmed after 3 reminders. Please follow up immediately.`;
        try {
          await notifyAllContactsForLift(ticket.lift_id, finalMessage, ticket.id);
          console.log(`[reminder] Ticket ${ticket.id} auto-closed, all contacts notified`);
          
          logEvent('ticket_auto_closed', {
            ticket_id: ticket.id,
            lift_id: ticket.lift_id,
            reminder_count: 3
          });
        } catch (err) {
          console.error(`[reminder] Failed to notify contacts for ticket ${ticket.id}:`, err);
        }
      } else {
        // Send reminder with interactive YES button
        const ticketRef = ticket.ticket_reference || `TKT${ticket.id}`;
        const reminderMessage = `⚠️ REMINDER ${newCount}/3: [${ticketRef}] Please confirm that the service provider has been notified of the entrapment at ${ticket.lift_name}.`;
        try {
          const { sendInteractiveViaBridge } = require('./lib/bridge');
          const entrapmentReminderResponse = await sendInteractiveViaBridge({
            baseUrl: BRIDGE_BASE_URL,
            apiKey: BRIDGE_API_KEY,
            to: ticket.primary_msisdn,
            bodyText: reminderMessage,
            buttons: [{ id: "entrapment_yes", title: "YES" }]
          });
          
          // Save entrapment reminder message ID to ticket_messages
          const entrapmentReminderMsgId = entrapmentReminderResponse?.wa_id || entrapmentReminderResponse?.id;
          if (entrapmentReminderMsgId) {
            try {
              await query(
                `INSERT INTO ticket_messages (ticket_id, contact_id, message_id, message_kind)
                 VALUES ($1, $2, $3, 'entrapment_reminder')`,
                [ticket.id, ticket.responded_by, entrapmentReminderMsgId]
              );
            } catch (msgErr) {
              console.error(`[reminder] Failed to save entrapment reminder to ticket_messages:`, msgErr);
            }
            
            // Also log to messages table for observability
            try {
              await query(
                `INSERT INTO messages (lift_id, msisdn, direction, type, status, body, wa_id, meta)
                 VALUES ($1, $2, 'out', 'whatsapp_interactive', 'sent', $3, $4, $5)`,
                [ticket.lift_id, ticket.primary_msisdn, reminderMessage, entrapmentReminderMsgId, JSON.stringify({ session: true, reminder: newCount, ticket_id: ticket.id })]
              );
              console.log(`[reminder] ✅ Logged entrapment reminder to messages table`);
            } catch (logErr) {
              console.error(`[reminder] Failed to log message to messages table:`, logErr);
            }
          }
          
          await query(
            `UPDATE tickets 
             SET reminder_count = $1,
                 last_reminder_at = now(),
                 updated_at = now()
             WHERE id = $2`,
            [newCount, ticket.id]
          );
          
          console.log(`[reminder] Sent reminder ${newCount}/3 for ticket ${ticket.id}`);
          
          logEvent('entrapment_reminder_sent', {
            ticket_id: ticket.id,
            reminder_count: newCount,
            contact: ticket.display_name
          });
        } catch (err) {
          console.error(`[reminder] Failed to send reminder for ticket ${ticket.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[reminder] Error checking pending reminders:', err);
  }
}

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

    // Start reminder check interval (every 1 minute)
    setInterval(checkPendingReminders, 60 * 1000);
    console.log('[startup] Reminder checker started (runs every 60 seconds)');

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
