// Call Centre Live Chat Routes
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { sendTextViaBridge } = require('../lib/bridge');

const BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL || "https://wa.woosh.ai";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";

// Authentication middleware (same as admin routes)
function requireAuth(req, res, next) {
  const token = req.header('X-Admin-Token') || 
                req.header('X-AI-Token') ||
                req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  
  const adminToken = process.env.ADMIN_TOKEN;
  const aiToken = process.env.AI_ASSISTANT_TOKEN;
  
  if (!token || (token !== adminToken && token !== aiToken)) {
    return res.status(401).json({ 
      ok: false, 
      error: { message: 'Unauthorized' } 
    });
  }
  
  next();
}

router.use(requireAuth);

// Get all active conversations (tickets with chat activity)
router.get('/conversations', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        l.msisdn as lift_msisdn,
        c.display_name as contact_name,
        c.primary_msisdn as contact_phone,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name,
        (SELECT COUNT(*) FROM chat_messages WHERE ticket_id = t.id) as message_count,
        (SELECT COUNT(*) FROM chat_messages WHERE ticket_id = t.id AND read_by_agent = false AND direction = 'inbound') as unread_count,
        (SELECT MAX(created_at) FROM chat_messages WHERE ticket_id = t.id) as last_message_at
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      WHERE t.status IN ('open', 'closed')
      ORDER BY 
        CASE WHEN t.agent_requested = true THEN 0 ELSE 1 END,
        last_message_at DESC NULLS LAST,
        t.created_at DESC
    `);

    res.json({
      ok: true,
      conversations: result.rows
    });
  } catch (error) {
    console.error('[chat/conversations] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Failed to load conversations' } 
    });
  }
});

// Get chat thread for specific ticket
router.get('/:ticketId/messages', async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Get ticket details
    const ticketResult = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        c.display_name as contact_name,
        c.primary_msisdn as contact_phone,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      WHERE t.id = $1
    `, [parseInt(ticketId)]);

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: { message: 'Ticket not found' }
      });
    }

    // Get all messages for this ticket
    const messagesResult = await query(`
      SELECT * FROM chat_messages
      WHERE ticket_id = $1
      ORDER BY created_at ASC
    `, [parseInt(ticketId)]);

    res.json({
      ok: true,
      ticket: ticketResult.rows[0],
      messages: messagesResult.rows
    });
  } catch (error) {
    console.error('[chat/:ticketId/messages] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Failed to load messages' } 
    });
  }
});

// Send message from agent to contact
router.post('/:ticketId/send', express.json(), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message, agent_name } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        ok: false,
        error: { message: 'Message is required' }
      });
    }

    // Get ticket and contact info
    const ticketResult = await query(`
      SELECT 
        t.*,
        c.primary_msisdn as contact_phone,
        c.display_name as contact_name
      FROM tickets t
      LEFT JOIN contacts c ON t.responded_by = c.id
      WHERE t.id = $1
    `, [parseInt(ticketId)]);

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: { message: 'Ticket not found' }
      });
    }

    const ticket = ticketResult.rows[0];
    const toNumber = ticket.contact_phone;

    if (!toNumber) {
      return res.status(400).json({
        ok: false,
        error: { message: 'No contact phone number for this ticket' }
      });
    }

    // Send via Woosh Bridge
    try {
      await sendTextViaBridge({
        baseUrl: BRIDGE_BASE_URL,
        apiKey: BRIDGE_API_KEY,
        to: toNumber,
        text: message.trim()
      });

      // Save to database
      await query(`
        INSERT INTO chat_messages (ticket_id, from_number, to_number, message, direction, agent_name, created_at)
        VALUES ($1, $2, $3, $4, 'outbound', $5, NOW())
      `, [parseInt(ticketId), 'agent', toNumber, message.trim(), agent_name || 'Agent']);

      console.log(`[chat] Agent sent message to ${ticket.contact_name || toNumber} for ticket ${ticketId}`);

      res.json({
        ok: true,
        message: 'Message sent successfully'
      });
    } catch (sendError) {
      console.error('[chat] Failed to send message:', sendError);
      res.status(500).json({
        ok: false,
        error: { message: 'Failed to send WhatsApp message', details: sendError.message }
      });
    }
  } catch (error) {
    console.error('[chat/:ticketId/send] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal error' } 
    });
  }
});

// Mark messages as read by agent
router.post('/:ticketId/mark-read', async (req, res) => {
  try {
    const { ticketId } = req.params;

    await query(`
      UPDATE chat_messages
      SET read_by_agent = true
      WHERE ticket_id = $1 AND direction = 'inbound' AND read_by_agent = false
    `, [parseInt(ticketId)]);

    res.json({
      ok: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('[chat/:ticketId/mark-read] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { message: 'Failed to mark as read' } 
    });
  }
});

module.exports = router;

