// Sentinel Enhanced Debug Routes - Maximum Diagnostic Power
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth } = require('../mw/ai-auth');

// Apply authentication to all routes
router.use(requireAiAuth);

// ============================================================================
// SYSTEM OVERVIEW - One endpoint to rule them all
// ============================================================================
router.get('/system-overview', async (req, res) => {
  try {
    const overview = {
      timestamp: new Date().toISOString(),
      system: {},
      database: {},
      whatsapp: {},
      performance: {},
      alerts: []
    };

    // System Health
    overview.system = {
      uptime_seconds: process.uptime(),
      uptime_human: formatUptime(process.uptime()),
      memory: {
        used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external_mb: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      node_version: process.version,
      platform: process.platform,
      pid: process.pid
    };

    // Database Health & Stats
    try {
      const start = Date.now();
      await query('SELECT 1');
      overview.database.latency_ms = Date.now() - start;
      overview.database.status = 'connected';
      
      // Get all counts in one go
      const counts = await query(`
        SELECT 
          (SELECT COUNT(*) FROM lifts) as lifts,
          (SELECT COUNT(*) FROM contacts) as contacts,
          (SELECT COUNT(*) FROM tickets) as tickets,
          (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
          (SELECT COUNT(*) FROM tickets WHERE status = 'closed') as closed_tickets,
          (SELECT COUNT(*) FROM chat_messages) as chat_messages,
          (SELECT COUNT(*) FROM event_log) as event_logs,
          (SELECT COUNT(*) FROM messages) as messages
      `);
      
      overview.database.counts = counts.rows[0];
      
      // Recent activity
      const recent = await query(`
        SELECT 
          (SELECT MAX(created_at) FROM tickets) as last_ticket,
          (SELECT MAX(created_at) FROM chat_messages) as last_message,
          (SELECT MAX(created_at) FROM event_log) as last_event,
          (SELECT MAX(created_at) FROM messages) as last_whatsapp
      `);
      
      overview.database.recent_activity = recent.rows[0];
      
    } catch (dbError) {
      overview.database.status = 'error';
      overview.database.error = dbError.message;
      overview.alerts.push({ type: 'critical', message: `Database error: ${dbError.message}` });
    }

    // WhatsApp/Meta API Status
    try {
      const accessToken = process.env.META_ACCESS_TOKEN;
      const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
      
      if (accessToken && phoneNumberId) {
        const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        overview.whatsapp.status = response.ok ? 'connected' : 'error';
        overview.whatsapp.status_code = response.status;
        
        if (!response.ok) {
          overview.alerts.push({ type: 'warning', message: `Meta API returned ${response.status}` });
        }
      } else {
        overview.whatsapp.status = 'not_configured';
        overview.alerts.push({ type: 'warning', message: 'Meta API credentials not configured' });
      }
    } catch (metaError) {
      overview.whatsapp.status = 'error';
      overview.whatsapp.error = metaError.message;
      overview.alerts.push({ type: 'critical', message: `Meta API error: ${metaError.message}` });
    }

    // Performance Metrics (last 24 hours)
    try {
      const perf = await query(`
        SELECT 
          COUNT(*) as total_messages,
          COUNT(*) FILTER (WHERE status = 'sent') as successful_messages,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_messages,
          AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))) as avg_delivery_time
        FROM messages 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      
      const ticketPerf = await query(`
        SELECT 
          COUNT(*) as total_tickets,
          COUNT(*) FILTER (WHERE status = 'closed') as closed_tickets,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_response_time
        FROM tickets 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      
      overview.performance = {
        messages: perf.rows[0],
        tickets: ticketPerf.rows[0]
      };
      
      // Add performance alerts
      const successRate = perf.rows[0].total_messages > 0 ? 
        (perf.rows[0].successful_messages / perf.rows[0].total_messages) * 100 : 100;
      
      if (successRate < 95) {
        overview.alerts.push({ type: 'warning', message: `Message success rate is ${successRate.toFixed(1)}% (below 95%)` });
      }
      
    } catch (perfError) {
      overview.performance.error = perfError.message;
    }

    // Environment Check
    overview.environment = {
      admin_token: !!process.env.ADMIN_TOKEN,
      ai_token: !!process.env.AI_ASSISTANT_TOKEN,
      meta_access_token: !!process.env.META_ACCESS_TOKEN,
      meta_phone_id: !!process.env.META_PHONE_NUMBER_ID,
      webhook_verify_token: !!process.env.WEBHOOK_VERIFY_TOKEN,
      database_url: !!process.env.DATABASE_URL,
      bridge_api_key: !!process.env.BRIDGE_API_KEY,
      bridge_base_url: process.env.BRIDGE_BASE_URL || 'not_set'
    };

    // Overall health score
    const healthScore = calculateHealthScore(overview);
    overview.health_score = healthScore;
    overview.status = healthScore > 80 ? 'healthy' : healthScore > 60 ? 'degraded' : 'critical';

    res.json({
      ok: true,
      data: overview
    });

  } catch (error) {
    console.error('[sentinel-debug/system-overview] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'System overview failed', details: error.message } 
    });
  }
});

// ============================================================================
// LIVE WEBHOOK MONITORING - See what's happening in real-time
// ============================================================================
router.get('/webhook-activity', async (req, res) => {
  try {
    const { since = '5 minutes ago' } = req.query;
    
    const activity = await query(`
      SELECT 
        event_type,
        created_at,
        metadata->>'from' as from_number,
        metadata->>'to' as to_number,
        metadata->>'text' as message_text,
        metadata->>'button' as button_clicked,
        metadata->>'ticket_id' as ticket_id,
        CASE 
          WHEN event_type = 'webhook_received' THEN '📥'
          WHEN event_type = 'whatsapp_message_sent' THEN '📤'
          WHEN event_type = 'button_click_received' THEN '🔘'
          WHEN event_type = 'ticket_created' THEN '🎫'
          WHEN event_type = 'ticket_closed' THEN '✅'
          ELSE '📋'
        END as icon
      FROM event_log 
      WHERE created_at > NOW() - INTERVAL '${since}'
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    
    res.json({
      ok: true,
      data: {
        activities: activity.rows,
        count: activity.rows.length,
        period: since,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[sentinel-debug/webhook-activity] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Webhook activity failed', details: error.message } 
    });
  }
});

// ============================================================================
// DATABASE SCHEMA VALIDATION - Ensure all tables are healthy
// ============================================================================
router.get('/database-health', async (req, res) => {
  try {
    const health = {
      timestamp: new Date().toISOString(),
      tables: {},
      issues: [],
      recommendations: []
    };

    // Check all critical tables
    const tables = ['lifts', 'contacts', 'lift_contacts', 'tickets', 'chat_messages', 'event_log', 'messages'];
    
    for (const table of tables) {
      try {
        const result = await query(`
          SELECT 
            COUNT(*) as row_count,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as recent_rows,
            MAX(created_at) as last_activity
          FROM ${table}
        `);
        
        health.tables[table] = {
          status: 'healthy',
          ...result.rows[0]
        };
        
        // Check for issues
        if (result.rows[0].row_count == 0) {
          health.issues.push(`${table} table is empty`);
        }
        
        if (!result.rows[0].last_activity) {
          health.issues.push(`${table} table has no recent activity`);
        }
        
      } catch (tableError) {
        health.tables[table] = {
          status: 'error',
          error: tableError.message
        };
        health.issues.push(`${table} table error: ${tableError.message}`);
      }
    }

    // Check foreign key relationships
    try {
      const relationships = await query(`
        SELECT 
          COUNT(*) as orphaned_tickets
        FROM tickets t 
        LEFT JOIN lifts l ON t.lift_id = l.id 
        WHERE l.id IS NULL
      `);
      
      if (relationships.rows[0].orphaned_tickets > 0) {
        health.issues.push(`${relationships.rows[0].orphaned_tickets} tickets have invalid lift_id`);
      }
      
    } catch (relError) {
      health.issues.push(`Relationship check failed: ${relError.message}`);
    }

    // Generate recommendations
    if (health.issues.length === 0) {
      health.recommendations.push('Database is healthy - no issues detected');
    } else {
      health.recommendations.push('Run database maintenance to fix identified issues');
    }

    res.json({
      ok: true,
      data: health
    });

  } catch (error) {
    console.error('[sentinel-debug/database-health] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Database health check failed', details: error.message } 
    });
  }
});

// ============================================================================
// WHATSAPP FLOW VALIDATION - Test the complete message flow
// ============================================================================
router.get('/whatsapp-flow-test', async (req, res) => {
  try {
    const test = {
      timestamp: new Date().toISOString(),
      steps: {},
      overall_status: 'unknown'
    };

    // Step 1: Check Meta API credentials
    test.steps.credentials = {
      name: 'Meta API Credentials',
      status: 'unknown',
      details: {}
    };
    
    const accessToken = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    
    if (accessToken && phoneNumberId) {
      test.steps.credentials.status = 'pass';
      test.steps.credentials.details = {
        token_length: accessToken.length,
        phone_id: phoneNumberId
      };
    } else {
      test.steps.credentials.status = 'fail';
      test.steps.credentials.details = {
        missing: !accessToken ? 'META_ACCESS_TOKEN' : 'META_PHONE_NUMBER_ID'
      };
    }

    // Step 2: Test Meta API connectivity
    test.steps.api_connectivity = {
      name: 'Meta API Connectivity',
      status: 'unknown',
      details: {}
    };
    
    if (accessToken && phoneNumberId) {
      try {
        const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (response.ok) {
          test.steps.api_connectivity.status = 'pass';
          test.steps.api_connectivity.details = { status_code: response.status };
        } else {
          test.steps.api_connectivity.status = 'fail';
          test.steps.api_connectivity.details = { 
            status_code: response.status,
            error: 'API returned non-200 status'
          };
        }
      } catch (apiError) {
        test.steps.api_connectivity.status = 'fail';
        test.steps.api_connectivity.details = { error: apiError.message };
      }
    } else {
      test.steps.api_connectivity.status = 'skip';
      test.steps.api_connectivity.details = { reason: 'Missing credentials' };
    }

    // Step 3: Check webhook configuration
    test.steps.webhook_config = {
      name: 'Webhook Configuration',
      status: 'unknown',
      details: {}
    };
    
    const webhookToken = process.env.WEBHOOK_VERIFY_TOKEN;
    if (webhookToken) {
      test.steps.webhook_config.status = 'pass';
      test.steps.webhook_config.details = { token_configured: true };
    } else {
      test.steps.webhook_config.status = 'fail';
      test.steps.webhook_config.details = { error: 'WEBHOOK_VERIFY_TOKEN not configured' };
    }

    // Step 4: Check recent message activity
    test.steps.recent_activity = {
      name: 'Recent Message Activity',
      status: 'unknown',
      details: {}
    };
    
    try {
      const recentMessages = await query(`
        SELECT 
          COUNT(*) as total_messages,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
          MAX(created_at) as last_message
        FROM messages
      `);
      
      const recentTickets = await query(`
        SELECT 
          COUNT(*) as total_tickets,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
          MAX(created_at) as last_ticket
        FROM tickets
      `);
      
      test.steps.recent_activity.status = 'pass';
      test.steps.recent_activity.details = {
        messages: recentMessages.rows[0],
        tickets: recentTickets.rows[0]
      };
      
    } catch (activityError) {
      test.steps.recent_activity.status = 'fail';
      test.steps.recent_activity.details = { error: activityError.message };
    }

    // Calculate overall status
    const stepStatuses = Object.values(test.steps).map(step => step.status);
    if (stepStatuses.every(status => status === 'pass')) {
      test.overall_status = 'healthy';
    } else if (stepStatuses.some(status => status === 'fail')) {
      test.overall_status = 'issues_detected';
    } else {
      test.overall_status = 'partial';
    }

    res.json({
      ok: true,
      data: test
    });

  } catch (error) {
    console.error('[sentinel-debug/whatsapp-flow-test] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'WhatsApp flow test failed', details: error.message } 
    });
  }
});

// ============================================================================
// EMERGENCY QUICK FIX - One-click system repair
// ============================================================================
router.post('/emergency-fix', async (req, res) => {
  try {
    const { fix_type } = req.body;
    const results = {
      timestamp: new Date().toISOString(),
      fix_type,
      actions_taken: [],
      status: 'unknown'
    };

    switch (fix_type) {
      case 'database_cleanup':
        // Clean up orphaned records
        const cleanup = await query(`
          DELETE FROM tickets 
          WHERE lift_id NOT IN (SELECT id FROM lifts)
        `);
        results.actions_taken.push(`Cleaned ${cleanup.rowCount} orphaned tickets`);
        results.status = 'success';
        break;

      case 'reset_sequences':
        // Reset database sequences
        await query(`SELECT setval('tickets_id_seq', (SELECT MAX(id) FROM tickets))`);
        await query(`SELECT setval('chat_messages_id_seq', (SELECT MAX(id) FROM chat_messages))`);
        results.actions_taken.push('Reset database sequences');
        results.status = 'success';
        break;

      case 'clear_old_logs':
        // Clear logs older than 7 days
        const oldLogs = await query(`
          DELETE FROM event_log 
          WHERE created_at < NOW() - INTERVAL '7 days'
        `);
        results.actions_taken.push(`Cleared ${oldLogs.rowCount} old log entries`);
        results.status = 'success';
        break;

      default:
        results.status = 'error';
        results.error = 'Unknown fix type. Valid types: database_cleanup, reset_sequences, clear_old_logs';
    }

    res.json({
      ok: results.status === 'success',
      data: results
    });

  } catch (error) {
    console.error('[sentinel-debug/emergency-fix] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Emergency fix failed', details: error.message } 
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function calculateHealthScore(overview) {
  let score = 100;
  
  // Database health
  if (overview.database.status !== 'connected') score -= 30;
  if (overview.database.latency_ms > 1000) score -= 10;
  
  // WhatsApp health
  if (overview.whatsapp.status !== 'connected') score -= 25;
  
  // Environment health
  const envChecks = Object.values(overview.environment);
  const missingEnv = envChecks.filter(check => !check).length;
  score -= missingEnv * 5;
  
  // Alert penalties
  overview.alerts.forEach(alert => {
    if (alert.type === 'critical') score -= 20;
    if (alert.type === 'warning') score -= 5;
  });
  
  return Math.max(0, score);
}

module.exports = router;
