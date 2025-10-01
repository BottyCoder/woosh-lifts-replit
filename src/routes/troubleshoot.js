// AI Assistant Troubleshooting Routes (Read-Only)
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth, enforceReadOnly, aiRateLimit } = require('../mw/ai-auth');

// Apply authentication, rate limiting, and read-only enforcement to all routes
router.use(requireAiAuth);
router.use(aiRateLimit);
router.use(enforceReadOnly);

// Get all tickets with filtering
router.get('/tickets', async (req, res) => {
  try {
    const { 
      status, 
      lift_id, 
      since, 
      limit = 50, 
      offset = 0 
    } = req.query;
    
    let sql = `
      SELECT 
        t.*,
        l.site_name,
        l.building,
        l.msisdn as lift_msisdn,
        c.display_name as responded_by_name,
        c.primary_msisdn as responded_by_phone,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      sql += ` AND t.status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (lift_id) {
      sql += ` AND t.lift_id = $${paramIndex++}`;
      params.push(parseInt(lift_id));
    }
    
    if (since) {
      sql += ` AND t.created_at >= $${paramIndex++}`;
      params.push(since);
    }
    
    sql += ` ORDER BY t.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(sql, params);
    
    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM tickets t WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (status) {
      countSql += ` AND t.status = $${countIndex++}`;
      countParams.push(status);
    }
    
    if (lift_id) {
      countSql += ` AND t.lift_id = $${countIndex++}`;
      countParams.push(parseInt(lift_id));
    }
    
    if (since) {
      countSql += ` AND t.created_at >= $${countIndex++}`;
      countParams.push(since);
    }
    
    const countResult = await query(countSql, countParams);
    
    res.json({
      ok: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        returned: result.rows.length
      },
      filters: { status, lift_id, since }
    });
  } catch (error) {
    console.error('[troubleshoot/tickets] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve tickets' 
      } 
    });
  }
});

// Get specific ticket with full details
router.get('/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get ticket details
    const ticketResult = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        l.msisdn as lift_msisdn,
        l.notes as lift_notes,
        c.display_name as responded_by_name,
        c.primary_msisdn as responded_by_phone,
        c.email as responded_by_email,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      WHERE t.id = $1
    `, [parseInt(id)]);
    
    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }
    
    const ticket = ticketResult.rows[0];
    
    // Get all contacts for this lift
    const contactsResult = await query(`
      SELECT c.*, lc.relation
      FROM contacts c
      JOIN lift_contacts lc ON c.id = lc.contact_id
      WHERE lc.lift_id = $1
      ORDER BY c.display_name
    `, [ticket.lift_id]);
    
    // Get message tracking
    const messagesResult = await query(`
      SELECT 
        tm.*,
        c.display_name as contact_name,
        c.primary_msisdn as contact_phone
      FROM ticket_messages tm
      LEFT JOIN contacts c ON tm.contact_id = c.id
      WHERE tm.ticket_id = $1
      ORDER BY tm.sent_at
    `, [parseInt(id)]);
    
    res.json({
      ok: true,
      data: {
        ticket,
        contacts: contactsResult.rows,
        messages: messagesResult.rows
      }
    });
  } catch (error) {
    console.error('[troubleshoot/tickets/:id] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve ticket details' 
      } 
    });
  }
});

// Get event timeline for a ticket
router.get('/tickets/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100 } = req.query;
    
    const result = await query(`
      SELECT *
      FROM event_log
      WHERE ticket_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [parseInt(id), parseInt(limit)]);
    
    res.json({
      ok: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('[troubleshoot/tickets/:id/events] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve ticket events' 
      } 
    });
  }
});

// Get all lifts with pagination
router.get('/lifts', async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    
    let sql = `
      SELECT 
        l.*,
        COUNT(DISTINCT lc.contact_id) as contact_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'open') as open_tickets,
        MAX(t.created_at) as last_ticket_at
      FROM lifts l
      LEFT JOIN lift_contacts lc ON l.id = lc.lift_id
      LEFT JOIN tickets t ON l.id = t.lift_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      sql += ` AND (l.building ILIKE $${paramIndex} OR l.site_name ILIKE $${paramIndex} OR l.msisdn ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    sql += ` GROUP BY l.id ORDER BY l.site_name, l.building LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(sql, params);
    
    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM lifts WHERE 1=1';
    const countParams = [];
    
    if (search) {
      countSql += ' AND (building ILIKE $1 OR site_name ILIKE $1 OR msisdn ILIKE $1)';
      countParams.push(`%${search}%`);
    }
    
    const countResult = await query(countSql, countParams);
    
    res.json({
      ok: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        returned: result.rows.length
      }
    });
  } catch (error) {
    console.error('[troubleshoot/lifts] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve lifts' 
      } 
    });
  }
});

// Get specific lift with full details
router.get('/lifts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get lift details
    const liftResult = await query('SELECT * FROM lifts WHERE id = $1', [parseInt(id)]);
    
    if (liftResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Lift not found'
        }
      });
    }
    
    const lift = liftResult.rows[0];
    
    // Get contacts
    const contactsResult = await query(`
      SELECT c.*, lc.relation
      FROM contacts c
      JOIN lift_contacts lc ON c.id = lc.contact_id
      WHERE lc.lift_id = $1
      ORDER BY c.display_name
    `, [parseInt(id)]);
    
    // Get recent tickets
    const ticketsResult = await query(`
      SELECT *
      FROM tickets
      WHERE lift_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [parseInt(id)]);
    
    res.json({
      ok: true,
      data: {
        lift,
        contacts: contactsResult.rows,
        recent_tickets: ticketsResult.rows
      }
    });
  } catch (error) {
    console.error('[troubleshoot/lifts/:id] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve lift details' 
      } 
    });
  }
});

// Get all contacts with pagination
router.get('/contacts', async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    
    let sql = `
      SELECT 
        c.*,
        COUNT(DISTINCT lc.lift_id) as lift_count
      FROM contacts c
      LEFT JOIN lift_contacts lc ON c.id = lc.contact_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      sql += ` AND (c.display_name ILIKE $${paramIndex} OR c.primary_msisdn ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    sql += ` GROUP BY c.id ORDER BY c.display_name LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(sql, params);
    
    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM contacts WHERE 1=1';
    const countParams = [];
    
    if (search) {
      countSql += ' AND (display_name ILIKE $1 OR primary_msisdn ILIKE $1 OR email ILIKE $1)';
      countParams.push(`%${search}%`);
    }
    
    const countResult = await query(countSql, countParams);
    
    res.json({
      ok: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        returned: result.rows.length
      }
    });
  } catch (error) {
    console.error('[troubleshoot/contacts] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve contacts' 
      } 
    });
  }
});

// Get specific contact with full details
router.get('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get contact details
    const contactResult = await query('SELECT * FROM contacts WHERE id = $1', [id]);
    
    if (contactResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Contact not found'
        }
      });
    }
    
    const contact = contactResult.rows[0];
    
    // Get linked lifts
    const liftsResult = await query(`
      SELECT l.*, lc.relation
      FROM lifts l
      JOIN lift_contacts lc ON l.id = lc.lift_id
      WHERE lc.contact_id = $1
      ORDER BY l.site_name, l.building
    `, [id]);
    
    // Get response history
    const responsesResult = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      WHERE t.responded_by = $1
      ORDER BY t.created_at DESC
      LIMIT 20
    `, [id]);
    
    res.json({
      ok: true,
      data: {
        contact,
        lifts: liftsResult.rows,
        response_history: responsesResult.rows
      }
    });
  } catch (error) {
    console.error('[troubleshoot/contacts/:id] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve contact details' 
      } 
    });
  }
});

// Get system event logs with filtering
router.get('/logs', async (req, res) => {
  try {
    const { 
      event_type, 
      ticket_id,
      lift_id,
      contact_id,
      since,
      limit = 100, 
      offset = 0 
    } = req.query;
    
    let sql = 'SELECT * FROM event_log WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (event_type) {
      sql += ` AND event_type ILIKE $${paramIndex++}`;
      params.push(`%${event_type}%`);
    }
    
    if (ticket_id) {
      sql += ` AND ticket_id = $${paramIndex++}`;
      params.push(parseInt(ticket_id));
    }
    
    if (lift_id) {
      sql += ` AND lift_id = $${paramIndex++}`;
      params.push(parseInt(lift_id));
    }
    
    if (contact_id) {
      sql += ` AND contact_id = $${paramIndex++}`;
      params.push(contact_id);
    }
    
    if (since) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(since);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(sql, params);
    
    res.json({
      ok: true,
      data: result.rows,
      count: result.rows.length,
      filters: { event_type, ticket_id, lift_id, contact_id, since }
    });
  } catch (error) {
    console.error('[troubleshoot/logs] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve logs' 
      } 
    });
  }
});

// Get system diagnostics
router.get('/diagnostics', async (req, res) => {
  try {
    // Database health
    const dbHealth = { connected: false, latency_ms: null };
    try {
      const start = Date.now();
      await query('SELECT 1');
      dbHealth.connected = true;
      dbHealth.latency_ms = Date.now() - start;
    } catch (err) {
      dbHealth.error = err.message;
    }
    
    // Get counts
    const counts = {};
    try {
      const [lifts, contacts, tickets, openTickets, logs] = await Promise.all([
        query('SELECT COUNT(*) as count FROM lifts'),
        query('SELECT COUNT(*) as count FROM contacts'),
        query('SELECT COUNT(*) as count FROM tickets'),
        query("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'"),
        query('SELECT COUNT(*) as count FROM event_log')
      ]);
      
      counts.lifts = parseInt(lifts.rows[0].count);
      counts.contacts = parseInt(contacts.rows[0].count);
      counts.tickets = parseInt(tickets.rows[0].count);
      counts.open_tickets = parseInt(openTickets.rows[0].count);
      counts.event_logs = parseInt(logs.rows[0].count);
    } catch (err) {
      counts.error = err.message;
    }
    
    // Recent activity
    const recentActivity = {};
    try {
      const [lastTicket, lastEvent, lastLog] = await Promise.all([
        query('SELECT created_at FROM tickets ORDER BY created_at DESC LIMIT 1'),
        query('SELECT MAX(ts) as last_ts FROM events'),
        query('SELECT created_at FROM event_log ORDER BY created_at DESC LIMIT 1')
      ]);
      
      recentActivity.last_ticket = lastTicket.rows[0]?.created_at || null;
      recentActivity.last_event = lastEvent.rows[0]?.last_ts || null;
      recentActivity.last_log = lastLog.rows[0]?.created_at || null;
    } catch (err) {
      recentActivity.error = err.message;
    }
    
    // Environment check (sanitized)
    const envCheck = {
      bridge_api_key: !!process.env.BRIDGE_API_KEY,
      bridge_base_url: process.env.BRIDGE_BASE_URL || 'not_set',
      template_name: process.env.BRIDGE_TEMPLATE_NAME || 'not_set',
      template_lang: process.env.BRIDGE_TEMPLATE_LANG || 'not_set',
      admin_token: !!process.env.ADMIN_TOKEN,
      ai_token: !!process.env.AI_ASSISTANT_TOKEN,
      webhook_auth: !!process.env.WEBHOOK_AUTH_TOKEN,
      hmac_secret: !!process.env.SMSPORTAL_HMAC_SECRET,
      database_url: !!process.env.DATABASE_URL
    };
    
    res.json({
      ok: true,
      data: {
        timestamp: new Date().toISOString(),
        database: dbHealth,
        counts,
        recent_activity: recentActivity,
        environment: envCheck,
        node_version: process.version,
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage()
      }
    });
  } catch (error) {
    console.error('[troubleshoot/diagnostics] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve diagnostics' 
      } 
    });
  }
});

// Get available event types for filtering
router.get('/event-types', async (req, res) => {
  try {
    const result = await query(`
      SELECT DISTINCT event_type, COUNT(*) as count
      FROM event_log
      GROUP BY event_type
      ORDER BY count DESC
    `);
    
    res.json({
      ok: true,
      data: result.rows
    });
  } catch (error) {
    console.error('[troubleshoot/event-types] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve event types' 
      } 
    });
  }
});

// ============================================================================
// NEW ADVANCED FEATURES
// ============================================================================

// Get application logs (captured console output)
router.get('/logs/application', async (req, res) => {
  try {
    const { since, level, limit = 100, search } = req.query;
    
    let logs = global.LOG_BUFFER || [];
    
    // Filter by timestamp
    if (since) {
      logs = logs.filter(log => log.timestamp >= since);
    }
    
    // Filter by level
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    // Filter by search term
    if (search) {
      const searchLower = search.toLowerCase();
      logs = logs.filter(log => log.message.toLowerCase().includes(searchLower));
    }
    
    // Limit results (get most recent)
    logs = logs.slice(-parseInt(limit));
    
    res.json({
      ok: true,
      logs: logs,
      count: logs.length,
      buffer_size: (global.LOG_BUFFER || []).length
    });
  } catch (error) {
    console.error('[troubleshoot/logs/application] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve application logs' 
      } 
    });
  }
});

// Get system performance metrics
router.get('/metrics', async (req, res) => {
  try {
    // Calculate message delivery metrics (last 24 hours)
    const messageMetrics = await query(`
      SELECT 
        COUNT(*) FILTER (WHERE direction = 'out') as total_sent,
        COUNT(*) FILTER (WHERE direction = 'out' AND status = 'sent') as successful,
        COUNT(*) FILTER (WHERE direction = 'out' AND status = 'failed') as failed,
        AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))) FILTER (WHERE delivered_at IS NOT NULL) as avg_delivery_time_seconds
      FROM messages
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    
    // Calculate button response metrics (last 24 hours)
    const buttonMetrics = await query(`
      SELECT 
        COUNT(DISTINCT t.id) as total_tickets,
        COUNT(DISTINCT t.id) FILTER (WHERE t.button_clicked IS NOT NULL) as responded_tickets,
        AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at))) FILTER (WHERE t.button_clicked IS NOT NULL) as avg_response_time_seconds
      FROM tickets t
      WHERE t.created_at > NOW() - INTERVAL '24 hours'
    `);
    
    const msgRow = messageMetrics.rows[0];
    const btnRow = buttonMetrics.rows[0];
    
    const totalSent = parseInt(msgRow.total_sent) || 0;
    const successful = parseInt(msgRow.successful) || 0;
    const failed = parseInt(msgRow.failed) || 0;
    
    const totalTickets = parseInt(btnRow.total_tickets) || 0;
    const respondedTickets = parseInt(btnRow.responded_tickets) || 0;
    
    res.json({
      ok: true,
      data: {
        timestamp: new Date().toISOString(),
        period: 'last_24_hours',
        message_delivery: {
          total_sent: totalSent,
          successful: successful,
          failed: failed,
          success_rate_percent: totalSent > 0 ? ((successful / totalSent) * 100).toFixed(2) : 0,
          avg_delivery_time_seconds: parseFloat(msgRow.avg_delivery_time_seconds) || null
        },
        button_responses: {
          total_tickets: totalTickets,
          responded_tickets: respondedTickets,
          response_rate_percent: totalTickets > 0 ? ((respondedTickets / totalTickets) * 100).toFixed(2) : 0,
          avg_response_time_seconds: parseFloat(btnRow.avg_response_time_seconds) || null
        },
        system: {
          uptime_seconds: process.uptime(),
          memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
          node_version: process.version
        }
      }
    });
  } catch (error) {
    console.error('[troubleshoot/metrics] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve metrics' 
      } 
    });
  }
});

// Get time-series analytics
router.get('/analytics/timeseries', async (req, res) => {
  try {
    const { metric, interval = '1h', since, until } = req.query;
    
    if (!metric) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: 'metric parameter is required (tickets, messages, or button_clicks)'
        }
      });
    }
    
    // SECURITY FIX: Whitelist validation to prevent SQL injection
    const validIntervals = { '1h': 'hour', '1d': 'day', '1w': 'week' };
    const truncInterval = validIntervals[interval];
    
    if (!truncInterval) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_INTERVAL',
          message: 'Valid intervals: 1h, 1d, 1w'
        }
      });
    }
    
    // Build date range safely
    const sinceClause = since ? `AND created_at >= $1` : `AND created_at > NOW() - INTERVAL '7 days'`;
    const untilClause = until ? (since ? `AND created_at <= $2` : `AND created_at <= $1`) : '';
    
    const params = [];
    if (since) params.push(since);
    if (until) params.push(until);
    
    let sql;
    
    if (metric === 'tickets') {
      sql = `
        SELECT 
          DATE_TRUNC('${truncInterval}', created_at) as time_bucket,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE status = 'open') as open_count,
          COUNT(*) FILTER (WHERE status = 'closed') as closed_count
        FROM tickets
        WHERE 1=1 ${sinceClause} ${untilClause}
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;
    } else if (metric === 'messages') {
      sql = `
        SELECT 
          DATE_TRUNC('${truncInterval}', created_at) as time_bucket,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE direction = 'out' AND status = 'sent') as sent_count,
          COUNT(*) FILTER (WHERE direction = 'out' AND status = 'failed') as failed_count
        FROM messages
        WHERE 1=1 ${sinceClause} ${untilClause}
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;
    } else if (metric === 'button_clicks') {
      sql = `
        SELECT 
          DATE_TRUNC('${truncInterval}', created_at) as time_bucket,
          COUNT(*) as count,
          COUNT(*) FILTER (WHERE metadata->>'payload' = 'Test') as test_clicks,
          COUNT(*) FILTER (WHERE metadata->>'payload' = 'Maintenance') as maintenance_clicks,
          COUNT(*) FILTER (WHERE metadata->>'payload' = 'Entrapment') as entrapment_clicks
        FROM event_log
        WHERE event_type = 'button_click_received'
          ${sinceClause} ${untilClause}
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;
    } else {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_METRIC',
          message: 'Valid metrics: tickets, messages, button_clicks'
        }
      });
    }
    
    const result = await query(sql, params);
    
    res.json({
      ok: true,
      data: {
        metric: metric,
        interval: interval,
        since: since || 'last_7_days',
        until: until || 'now',
        datapoints: result.rows
      }
    });
  } catch (error) {
    console.error('[troubleshoot/analytics/timeseries] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve time-series data' 
      } 
    });
  }
});

// Get recent events (polling-based real-time monitoring)
router.get('/events/recent', async (req, res) => {
  try {
    const { since, limit = 50 } = req.query;
    
    // Default to events in last 30 seconds if no 'since' provided
    const sinceTime = since || new Date(Date.now() - 30000).toISOString();
    
    const result = await query(`
      SELECT *
      FROM event_log
      WHERE created_at >= $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [sinceTime, parseInt(limit)]);
    
    res.json({
      ok: true,
      events: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString(),
      next_poll_url: `/api/troubleshoot/events/recent?since=${new Date().toISOString()}`
    });
  } catch (error) {
    console.error('[troubleshoot/events/recent] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve recent events' 
      } 
    });
  }
});

module.exports = router;

