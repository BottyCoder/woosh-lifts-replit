const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth } = require('../mw/ai-auth');

// Apply AI authentication to all routes
router.use(requireAiAuth);

// Test endpoint to verify AI token is working
router.get('/test', async (req, res) => {
  try {
    res.json({
      ok: true,
      message: 'AI token authentication successful!',
      timestamp: new Date().toISOString(),
      authType: req.authType,
      isReadOnly: req.isReadOnly,
      tokenInfo: {
        isValid: true,
        hasAdminAccess: req.authType === 'admin',
        hasAiAccess: req.authType === 'ai_assistant'
      }
    });
  } catch (error) {
    console.error('[ai-test] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

// Test database connectivity
router.get('/database', async (req, res) => {
  try {
    const result = await query('SELECT NOW() as current_time, version() as postgres_version');
    
    res.json({
      ok: true,
      message: 'Database connection successful',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        currentTime: result.rows[0].current_time,
        version: result.rows[0].postgres_version
      }
    });
  } catch (error) {
    console.error('[ai-test/database] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Database connection failed', details: error.message } 
    });
  }
});

// Test chat API access
router.get('/chat-test', async (req, res) => {
  try {
    // Test if we can access the conversations endpoint
    const result = await query(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_tickets
      FROM tickets
    `);
    
    const chatMessagesResult = await query(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(CASE WHEN direction = 'inbound' THEN 1 END) as inbound_messages,
        COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as outbound_messages
      FROM chat_messages
    `);
    
    res.json({
      ok: true,
      message: 'Chat API access successful',
      timestamp: new Date().toISOString(),
      chatData: {
        tickets: result.rows[0],
        messages: chatMessagesResult.rows[0]
      }
    });
  } catch (error) {
    console.error('[ai-test/chat-test] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Chat API test failed', details: error.message } 
    });
  }
});

// Test environment variables
router.get('/env-check', async (req, res) => {
  try {
    const envVars = {
      ADMIN_TOKEN: process.env.ADMIN_TOKEN ? '✅ Set' : '❌ Missing',
      AI_ASSISTANT_TOKEN: process.env.AI_ASSISTANT_TOKEN ? '✅ Set' : '❌ Missing',
      DATABASE_URL: process.env.DATABASE_URL ? '✅ Set' : '❌ Missing',
      BRIDGE_BASE_URL: process.env.BRIDGE_BASE_URL ? '✅ Set' : '❌ Missing',
      BRIDGE_API_KEY: process.env.BRIDGE_API_KEY ? '✅ Set' : '❌ Missing',
      META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN ? '✅ Set' : '❌ Missing',
      META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID ? '✅ Set' : '❌ Missing'
    };
    
    res.json({
      ok: true,
      message: 'Environment variables check',
      timestamp: new Date().toISOString(),
      environment: envVars,
      nodeEnv: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 8080
    });
  } catch (error) {
    console.error('[ai-test/env-check] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Environment check failed', details: error.message } 
    });
  }
});

// Test Meta API connectivity
router.get('/meta-test', async (req, res) => {
  try {
    const accessToken = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    
    if (!accessToken || !phoneNumberId) {
      return res.json({
        ok: false,
        message: 'Meta API credentials not configured',
        meta: {
          accessToken: accessToken ? '✅ Set' : '❌ Missing',
          phoneNumberId: phoneNumberId ? '✅ Set' : '❌ Missing'
        }
      });
    }
    
    // Test Meta API connectivity
    const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const data = await response.json();
    
    res.json({
      ok: response.ok,
      message: response.ok ? 'Meta API connection successful' : 'Meta API connection failed',
      timestamp: new Date().toISOString(),
      meta: {
        connected: response.ok,
        status: response.status,
        phoneNumberId: phoneNumberId,
        response: response.ok ? {
          id: data.id,
          verified_name: data.verified_name,
          display_phone_number: data.display_phone_number,
          quality_rating: data.quality_rating
        } : data
      }
    });
  } catch (error) {
    console.error('[ai-test/meta-test] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Meta API test failed', details: error.message } 
    });
  }
});

// Comprehensive system health check
router.get('/health', async (req, res) => {
  try {
    const checks = {
      authentication: true,
      database: false,
      metaApi: false,
      environment: false
    };
    
    // Test database
    try {
      await query('SELECT 1');
      checks.database = true;
    } catch (dbError) {
      checks.database = false;
    }
    
    // Test Meta API
    try {
      const accessToken = process.env.META_ACCESS_TOKEN;
      const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
      
      if (accessToken && phoneNumberId) {
        const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        checks.metaApi = response.ok;
      }
    } catch (metaError) {
      checks.metaApi = false;
    }
    
    // Check environment
    checks.environment = !!(
      process.env.ADMIN_TOKEN || process.env.AI_ASSISTANT_TOKEN
    );
    
    const allHealthy = Object.values(checks).every(check => check === true);
    
    res.json({
      ok: allHealthy,
      message: allHealthy ? 'All systems healthy' : 'Some systems have issues',
      timestamp: new Date().toISOString(),
      checks: checks,
      status: allHealthy ? 'healthy' : 'degraded'
    });
  } catch (error) {
    console.error('[ai-test/health] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Health check failed', details: error.message } 
    });
  }
});

module.exports = router;
