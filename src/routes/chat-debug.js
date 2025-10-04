const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth } = require('../mw/ai-auth');

// Apply AI authentication to all routes
router.use(requireAiAuth);

// Test endpoint to get all conversations (same as chat route but with debug info)
router.get('/conversations-debug', async (req, res) => {
  try {
    console.log('[chat-debug] Testing conversations endpoint...');
    
    // Test the exact same query as the chat route
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
      WHERE t.status = 'open' OR (t.status = 'closed' AND t.resolved_at > NOW() - INTERVAL '1 hour')
      ORDER BY 
        CASE WHEN t.agent_requested = true THEN 0 ELSE 1 END,
        last_message_at DESC NULLS LAST,
        t.created_at DESC
    `);

    console.log(`[chat-debug] Found ${result.rows.length} conversations`);

    res.json({
      ok: true,
      message: 'Conversations debug successful',
      timestamp: new Date().toISOString(),
      debug: {
        totalConversations: result.rows.length,
        queryExecuted: true,
        hasResults: result.rows.length > 0
      },
      conversations: result.rows
    });
  } catch (error) {
    console.error('[chat-debug/conversations] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Conversations debug failed', 
        details: error.message,
        stack: error.stack 
      } 
    });
  }
});

// Test endpoint to get specific ticket messages
router.get('/ticket/:ticketId/messages-debug', async (req, res) => {
  try {
    const { ticketId } = req.params;
    console.log(`[chat-debug] Testing messages for ticket ${ticketId}...`);

    // Get ticket details (same query as chat route)
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
      return res.json({
        ok: false,
        message: 'Ticket not found',
        debug: {
          ticketId: ticketId,
          ticketFound: false
        }
      });
    }

    // Get all messages for this ticket
    const messagesResult = await query(`
      SELECT * FROM chat_messages
      WHERE ticket_id = $1
      ORDER BY created_at ASC
    `, [parseInt(ticketId)]);

    console.log(`[chat-debug] Found ${messagesResult.rows.length} messages for ticket ${ticketId}`);

    res.json({
      ok: true,
      message: 'Ticket messages debug successful',
      timestamp: new Date().toISOString(),
      debug: {
        ticketId: ticketId,
        ticketFound: true,
        messageCount: messagesResult.rows.length,
        queryExecuted: true
      },
      ticket: ticketResult.rows[0],
      messages: messagesResult.rows
    });
  } catch (error) {
    console.error('[chat-debug/messages] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Ticket messages debug failed', 
        details: error.message,
        stack: error.stack 
      } 
    });
  }
});

// Test endpoint to check database schema
router.get('/schema-check', async (req, res) => {
  try {
    console.log('[chat-debug] Checking database schema...');
    
    // Check if all required tables exist
    const tables = ['tickets', 'lifts', 'contacts', 'chat_messages', 'lift_contacts'];
    const tableChecks = {};
    
    for (const table of tables) {
      try {
        const result = await query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [table]);
        tableChecks[table] = result.rows[0].exists;
      } catch (error) {
        tableChecks[table] = false;
      }
    }
    
    // Check table structures
    const structureChecks = {};
    
    // Check tickets table structure
    try {
      const result = await query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'tickets' 
        ORDER BY ordinal_position
      `);
      structureChecks.tickets = result.rows;
    } catch (error) {
      structureChecks.tickets = 'Error: ' + error.message;
    }
    
    // Check chat_messages table structure
    try {
      const result = await query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'chat_messages' 
        ORDER BY ordinal_position
      `);
      structureChecks.chat_messages = result.rows;
    } catch (error) {
      structureChecks.chat_messages = 'Error: ' + error.message;
    }

    res.json({
      ok: true,
      message: 'Database schema check completed',
      timestamp: new Date().toISOString(),
      debug: {
        tablesExist: tableChecks,
        tableStructures: structureChecks
      }
    });
  } catch (error) {
    console.error('[chat-debug/schema] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Schema check failed', 
        details: error.message 
      } 
    });
  }
});

// Test endpoint to check data integrity
router.get('/data-integrity', async (req, res) => {
  try {
    console.log('[chat-debug] Checking data integrity...');
    
    // Check for orphaned records
    const orphanedTickets = await query(`
      SELECT COUNT(*) as count 
      FROM tickets t 
      LEFT JOIN lifts l ON t.lift_id = l.id 
      WHERE l.id IS NULL
    `);
    
    const orphanedMessages = await query(`
      SELECT COUNT(*) as count 
      FROM chat_messages cm 
      LEFT JOIN tickets t ON cm.ticket_id = t.id 
      WHERE t.id IS NULL
    `);
    
    // Check for tickets without contacts
    const ticketsWithoutContacts = await query(`
      SELECT COUNT(*) as count 
      FROM tickets t 
      LEFT JOIN contacts c ON t.responded_by = c.id 
      WHERE t.responded_by IS NOT NULL AND c.id IS NULL
    `);
    
    // Get sample data counts
    const counts = await query(`
      SELECT 
        (SELECT COUNT(*) FROM tickets) as total_tickets,
        (SELECT COUNT(*) FROM lifts) as total_lifts,
        (SELECT COUNT(*) FROM contacts) as total_contacts,
        (SELECT COUNT(*) FROM chat_messages) as total_chat_messages,
        (SELECT COUNT(*) FROM lift_contacts) as total_lift_contacts
    `);

    res.json({
      ok: true,
      message: 'Data integrity check completed',
      timestamp: new Date().toISOString(),
      debug: {
        orphanedRecords: {
          tickets: orphanedTickets.rows[0].count,
          messages: orphanedMessages.rows[0].count,
          ticketsWithoutContacts: ticketsWithoutContacts.rows[0].count
        },
        dataCounts: counts.rows[0]
      }
    });
  } catch (error) {
    console.error('[chat-debug/integrity] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Data integrity check failed', 
        details: error.message 
      } 
    });
  }
});

// Test endpoint to simulate the exact chat API call
router.get('/simulate-chat-api', async (req, res) => {
  try {
    console.log('[chat-debug] Simulating exact chat API call...');
    
    // Simulate the exact same logic as the chat conversations endpoint
    const startTime = Date.now();
    
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
      WHERE t.status = 'open' OR (t.status = 'closed' AND t.resolved_at > NOW() - INTERVAL '1 hour')
      ORDER BY 
        CASE WHEN t.agent_requested = true THEN 0 ELSE 1 END,
        last_message_at DESC NULLS LAST,
        t.created_at DESC
    `);
    
    const executionTime = Date.now() - startTime;
    
    // Format the response exactly like the chat API
    const chatApiResponse = {
      ok: true,
      conversations: result.rows
    };

    res.json({
      ok: true,
      message: 'Chat API simulation completed',
      timestamp: new Date().toISOString(),
      debug: {
        executionTimeMs: executionTime,
        resultCount: result.rows.length,
        querySuccessful: true,
        responseFormat: 'matches chat API'
      },
      chatApiResponse: chatApiResponse,
      rawData: result.rows
    });
  } catch (error) {
    console.error('[chat-debug/simulate] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Chat API simulation failed', 
        details: error.message,
        stack: error.stack 
      } 
    });
  }
});

// Test endpoint to check authentication on chat routes
router.get('/test-chat-auth', async (req, res) => {
  try {
    console.log('[chat-debug] Testing chat route authentication...');
    
    // Try to make a request to the actual chat endpoint
    const response = await fetch('http://localhost:8080/api/chat/conversations', {
      method: 'GET',
      headers: {
        'X-Admin-Token': process.env.ADMIN_TOKEN || '',
        'X-AI-Token': process.env.AI_ASSISTANT_TOKEN || '',
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    res.json({
      ok: true,
      message: 'Chat authentication test completed',
      timestamp: new Date().toISOString(),
      debug: {
        chatEndpointReachable: true,
        statusCode: response.status,
        hasAdminToken: !!process.env.ADMIN_TOKEN,
        hasAiToken: !!process.env.AI_ASSISTANT_TOKEN,
        responseOk: response.ok
      },
      chatResponse: data
    });
  } catch (error) {
    console.error('[chat-debug/auth] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Chat authentication test failed', 
        details: error.message 
      } 
    });
  }
});

module.exports = router;
