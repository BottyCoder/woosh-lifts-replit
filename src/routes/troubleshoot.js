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

// Get message history with filtering (NEW - Critical for debugging communication)
router.get('/messages', async (req, res) => {
  try {
    const { 
      lift_id, 
      ticket_id, 
      direction, 
      type, 
      status,
      since,
      limit = 100, 
      offset = 0 
    } = req.query;
    
    let sql = `
      SELECT 
        m.*,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM messages m
      LEFT JOIN lifts l ON m.lift_id = l.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (lift_id) {
      sql += ` AND m.lift_id = $${paramIndex++}`;
      params.push(parseInt(lift_id));
    }
    
    if (ticket_id) {
      sql += ` AND m.meta->>'ticket_id' = $${paramIndex++}`;
      params.push(ticket_id);
    }
    
    if (direction) {
      sql += ` AND m.direction = $${paramIndex++}`;
      params.push(direction);
    }
    
    if (type) {
      sql += ` AND m.type = $${paramIndex++}`;
      params.push(type);
    }
    
    if (status) {
      sql += ` AND m.status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (since) {
      sql += ` AND m.created_at >= $${paramIndex++}`;
      params.push(since);
    }
    
    sql += ` ORDER BY m.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await query(sql, params);
    
    // Get total count with same filters
    let countSql = 'SELECT COUNT(*) as total FROM messages m WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (lift_id) {
      countSql += ` AND m.lift_id = $${countIndex++}`;
      countParams.push(parseInt(lift_id));
    }
    
    if (ticket_id) {
      countSql += ` AND m.meta->>'ticket_id' = $${countIndex++}`;
      countParams.push(ticket_id);
    }
    
    if (direction) {
      countSql += ` AND m.direction = $${countIndex++}`;
      countParams.push(direction);
    }
    
    if (type) {
      countSql += ` AND m.type = $${countIndex++}`;
      countParams.push(type);
    }
    
    if (status) {
      countSql += ` AND m.status = $${countIndex++}`;
      countParams.push(status);
    }
    
    if (since) {
      countSql += ` AND m.created_at >= $${countIndex++}`;
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
      filters: { lift_id, ticket_id, direction, type, status, since }
    });
  } catch (error) {
    console.error('[troubleshoot/messages] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve messages' 
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
      const [lifts, contacts, tickets, openTickets, messages, logs] = await Promise.all([
        query('SELECT COUNT(*) as count FROM lifts'),
        query('SELECT COUNT(*) as count FROM contacts'),
        query('SELECT COUNT(*) as count FROM tickets'),
        query("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'"),
        query('SELECT COUNT(*) as count FROM messages'),
        query('SELECT COUNT(*) as count FROM event_log')
      ]);
      
      counts.lifts = parseInt(lifts.rows[0].count);
      counts.contacts = parseInt(contacts.rows[0].count);
      counts.tickets = parseInt(tickets.rows[0].count);
      counts.open_tickets = parseInt(openTickets.rows[0].count);
      counts.messages = parseInt(messages.rows[0].count);
      counts.event_logs = parseInt(logs.rows[0].count);
    } catch (err) {
      counts.error = err.message;
    }
    
    // Recent activity
    const recentActivity = {};
    try {
      const [lastTicket, lastMessage, lastEvent, lastLog] = await Promise.all([
        query('SELECT created_at FROM tickets ORDER BY created_at DESC LIMIT 1'),
        query('SELECT created_at FROM messages ORDER BY created_at DESC LIMIT 1'),
        query('SELECT MAX(ts) as last_ts FROM events'),
        query('SELECT created_at FROM event_log ORDER BY created_at DESC LIMIT 1')
      ]);
      
      recentActivity.last_ticket = lastTicket.rows[0]?.created_at || null;
      recentActivity.last_message = lastMessage.rows[0]?.created_at || null;
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

module.exports = router;
