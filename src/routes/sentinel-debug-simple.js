// Simple Sentinel Debug Routes for testing
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth } = require('../mw/ai-auth');

// Apply authentication to all routes
router.use(requireAiAuth);

// Simple system overview
router.get('/system-overview', async (req, res) => {
  try {
    const overview = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      message: 'Sentinel debug routes are working!',
      system: {
        uptime_seconds: process.uptime(),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        node_version: process.version
      }
    };

    res.json({
      ok: true,
      data: overview
    });

  } catch (error) {
    console.error('[sentinel-debug-simple/system-overview] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'System overview failed', details: error.message } 
    });
  }
});

// Simple webhook activity
router.get('/webhook-activity', async (req, res) => {
  try {
    const activity = await query(`
      SELECT 
        event_type,
        created_at,
        metadata->>'from' as from_number
      FROM event_log 
      WHERE created_at > NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    res.json({
      ok: true,
      data: {
        activities: activity.rows,
        count: activity.rows.length,
        message: 'Webhook activity endpoint working!'
      }
    });

  } catch (error) {
    console.error('[sentinel-debug-simple/webhook-activity] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Webhook activity failed', details: error.message } 
    });
  }
});

module.exports = router;
