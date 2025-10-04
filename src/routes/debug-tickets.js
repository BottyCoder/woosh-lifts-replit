const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth } = require('../mw/ai-auth');

// Apply AI authentication to all routes
router.use(requireAiAuth);

// Debug endpoint to check all tickets regardless of status
router.get('/all-tickets', async (req, res) => {
  try {
    console.log('[debug-tickets] Checking all tickets in database...');
    
    // Get all tickets without any filters
    const allTickets = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        l.msisdn as lift_msisdn,
        c.display_name as contact_name,
        c.primary_msisdn as contact_phone,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      ORDER BY t.created_at DESC
    `);
    
    // Get tickets by status
    const byStatus = await query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM tickets
      GROUP BY status
      ORDER BY status
    `);
    
    // Get tickets with chat messages
    const withMessages = await query(`
      SELECT 
        t.id,
        t.status,
        t.created_at,
        COUNT(cm.id) as message_count
      FROM tickets t
      LEFT JOIN chat_messages cm ON t.id = cm.ticket_id
      GROUP BY t.id, t.status, t.created_at
      ORDER BY t.created_at DESC
    `);

    res.json({
      ok: true,
      message: 'Ticket debug completed',
      timestamp: new Date().toISOString(),
      debug: {
        totalTickets: allTickets.rows.length,
        ticketsByStatus: byStatus.rows,
        ticketsWithMessages: withMessages.rows,
        sampleTickets: allTickets.rows.slice(0, 5)
      },
      allTickets: allTickets.rows
    });
  } catch (error) {
    console.error('[debug-tickets] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Ticket debug failed', 
        details: error.message,
        stack: error.stack 
      } 
    });
  }
});

// Debug endpoint to check what the chat query would return
router.get('/chat-query-debug', async (req, res) => {
  try {
    console.log('[debug-tickets] Testing chat conversations query...');
    
    // Test the exact chat query
    const chatQueryResult = await query(`
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
      WHERE t.status = 'open' OR (t.status = 'closed' AND t.resolved_at > NOW() - INTERVAL '1 hour')
      ORDER BY 
        CASE WHEN t.agent_requested = true THEN 0 ELSE 1 END,
        last_message_at DESC NULLS LAST,
        t.created_at DESC
    `);
    
    // Test without the time restriction
    const allOpenClosed = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        l.msisdn as lift_msisdn,
        c.display_name as contact_name,
        c.primary_msisdn as contact_phone,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      WHERE t.status IN ('open', 'closed')
      ORDER BY t.created_at DESC
    `);

    res.json({
      ok: true,
      message: 'Chat query debug completed',
      timestamp: new Date().toISOString(),
      debug: {
        chatQueryResults: chatQueryResult.rows.length,
        allOpenClosedResults: allOpenClosed.rows.length,
        timeRestriction: 'Only shows closed tickets resolved within 1 hour'
      },
      chatQueryTickets: chatQueryResult.rows,
      allOpenClosedTickets: allOpenClosed.rows
    });
  } catch (error) {
    console.error('[debug-tickets/chat-query] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Chat query debug failed', 
        details: error.message,
        stack: error.stack 
      } 
    });
  }
});

module.exports = router;
