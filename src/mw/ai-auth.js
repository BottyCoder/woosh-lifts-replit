// AI Assistant Authentication Middleware
const { query } = require('../db');

// Log event helper (same as in server.js)
const logEvent = async (event_type, data = {}) => {
  const logData = { event: event_type, ts: new Date().toISOString(), ...data };
  console.log(JSON.stringify(logData));
  
  try {
    await query(
      `INSERT INTO event_log (event_type, metadata, created_at)
       VALUES ($1, $2, NOW())`,
      [event_type, JSON.stringify(data)]
    );
  } catch (err) {
    console.error('[logEvent] Failed to store event:', err.message);
  }
};

/**
 * Middleware for AI Assistant read-only authentication
 * Accepts either AI_ASSISTANT_TOKEN or ADMIN_TOKEN
 * Logs all access for audit trail
 */
function requireAiAuth(req, res, next) {
  const token = req.header('X-AI-Token') || 
                req.header('X-Admin-Token') ||
                req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  
  const aiToken = process.env.AI_ASSISTANT_TOKEN;
  const adminToken = process.env.ADMIN_TOKEN;
  
  // Check if tokens are configured
  if (!aiToken && !adminToken) {
    console.error('[ai-auth] No AI_ASSISTANT_TOKEN or ADMIN_TOKEN configured');
    return res.status(503).json({ 
      ok: false, 
      error: { 
        code: 'SERVICE_UNAVAILABLE',
        message: 'AI assistant access not configured' 
      } 
    });
  }
  
  // Validate token
  if (!token) {
    logEvent('ai_auth_failed', { 
      reason: 'no_token',
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent')
    });
    
    return res.status(401).json({ 
      ok: false, 
      error: { 
        code: 'UNAUTHORIZED',
        message: 'Authentication required' 
      } 
    });
  }
  
  // Check against both tokens
  const isAiToken = aiToken && token === aiToken;
  const isAdminToken = adminToken && token === adminToken;
  
  if (!isAiToken && !isAdminToken) {
    logEvent('ai_auth_failed', { 
      reason: 'invalid_token',
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent')
    });
    
    return res.status(401).json({ 
      ok: false, 
      error: { 
        code: 'UNAUTHORIZED',
        message: 'Invalid authentication token' 
      } 
    });
  }
  
  // Set auth context
  req.authType = isAiToken ? 'ai_assistant' : 'admin';
  req.isReadOnly = isAiToken; // AI tokens are read-only
  
  // Audit log all AI access
  if (req.authType === 'ai_assistant') {
    logEvent('ai_api_access', {
      path: req.path,
      method: req.method,
      query: req.query,
      ip: req.ip
    });
  }
  
  next();
}

/**
 * Middleware to enforce read-only operations
 * Blocks non-GET requests for AI assistant tokens
 */
function enforceReadOnly(req, res, next) {
  if (req.isReadOnly && req.method !== 'GET') {
    logEvent('ai_write_attempt_blocked', {
      method: req.method,
      path: req.path,
      ip: req.ip
    });
    
    return res.status(403).json({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'AI assistant has read-only access. Use ADMIN_TOKEN for write operations.'
      }
    });
  }
  
  next();
}

/**
 * Rate limiting specifically for AI assistant
 */
const aiAccessCount = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute

function aiRateLimit(req, res, next) {
  if (req.authType !== 'ai_assistant') {
    return next(); // No rate limit for admin tokens
  }
  
  const now = Date.now();
  const key = 'ai_assistant';
  
  if (!aiAccessCount.has(key)) {
    aiAccessCount.set(key, []);
  }
  
  const timestamps = aiAccessCount.get(key);
  
  // Remove timestamps outside the window
  const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
  
  if (recent.length >= RATE_LIMIT_MAX) {
    logEvent('ai_rate_limit_exceeded', {
      path: req.path,
      count: recent.length,
      limit: RATE_LIMIT_MAX
    });
    
    return res.status(429).json({
      ok: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} requests per minute.`,
        retryAfter: Math.ceil((recent[0] + RATE_LIMIT_WINDOW - now) / 1000)
      }
    });
  }
  
  // Add current timestamp
  recent.push(now);
  aiAccessCount.set(key, recent);
  
  next();
}

module.exports = {
  requireAiAuth,
  enforceReadOnly,
  aiRateLimit
};
