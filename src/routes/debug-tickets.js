const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth } = require('../mw/ai-auth');

// Apply AI authentication to all routes (accepts both AI and Admin tokens)
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

// Create sample tickets for testing
router.post('/create-samples', async (req, res) => {
  try {
    console.log('[debug-tickets] Creating sample tickets...');
    
    // First, ensure we have basic data
    await query(`
      INSERT INTO lifts (id, msisdn, site_name, building, created_at) VALUES
      (1, '27824537125', 'Test Site', 'Test Building', NOW()),
      (2, '27720266440', 'James Lift', 'James House', NOW()),
      (3, '27783333555', 'Growthpoint Centurion', 'Building A', NOW()),
      (4, '27788517152', 'Growthpoint JHB', 'Tower 1', NOW())
      ON CONFLICT (msisdn) DO NOTHING
    `);
    
    await query(`
      INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
      ('f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'Marc', '27824537125', NOW()),
      ('9ccd2977-0a91-4246-921f-1509de508eae', 'James', '27720266440', NOW()),
      ('550e8400-e29b-41d4-a716-446655440001', 'John', '27783333555', NOW()),
      ('550e8400-e29b-41d4-a716-446655440002', 'Sarah', '27788517152', NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    
    await query(`
      INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
      (1, 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'primary'),
      (2, '9ccd2977-0a91-4246-921f-1509de508eae', 'primary'),
      (3, '550e8400-e29b-41d4-a716-446655440001', 'primary'),
      (4, '550e8400-e29b-41d4-a716-446655440002', 'primary')
      ON CONFLICT DO NOTHING
    `);
    
    // Create sample tickets
    const ticketsResult = await query(`
      INSERT INTO tickets (lift_id, sms_id, status, button_clicked, responded_by, created_at, updated_at, agent_requested, notes) VALUES
      (1, 'test_sms_001', 'open', 'emergency', 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', NOW() - INTERVAL '10 minutes', NOW(), true, 'Test emergency at Test Building - Marc is responding'),
      (2, 'test_sms_002', 'open', 'maintenance', '9ccd2977-0a91-4246-921f-1509de508eae', NOW() - INTERVAL '30 minutes', NOW(), false, 'Maintenance request at James House'),
      (3, 'test_sms_003', 'closed', 'emergency', '550e8400-e29b-41d4-a716-446655440001', NOW() - INTERVAL '2 hours', NOW(), false, 'Emergency resolved at Growthpoint Centurion'),
      (4, 'test_sms_004', 'open', 'emergency', '550e8400-e29b-41d4-a716-446655440002', NOW() - INTERVAL '45 minutes', NOW(), false, 'Lift stuck at Growthpoint JHB Tower 1')
      RETURNING id
    `);
    
    // Add chat messages
    await query(`
      INSERT INTO chat_messages (ticket_id, from_number, to_number, message, direction, agent_name, read_by_agent, created_at) VALUES
      (1, '27824537125', 'system', 'Emergency button pressed in Test Building', 'inbound', NULL, false, NOW() - INTERVAL '10 minutes'),
      (1, 'system', '27824537125', 'Emergency response team has been notified. Help is on the way.', 'outbound', 'System', true, NOW() - INTERVAL '9 minutes'),
      (1, '27824537125', 'system', 'I am stuck in the lift, please hurry!', 'inbound', NULL, false, NOW() - INTERVAL '5 minutes'),
      (2, '27720266440', 'system', 'Lift needs maintenance check', 'inbound', NULL, false, NOW() - INTERVAL '30 minutes'),
      (2, 'system', '27720266440', 'Maintenance request received. Technician will visit within 24 hours.', 'outbound', 'System', true, NOW() - INTERVAL '29 minutes'),
      (3, '27783333555', 'system', 'Emergency in Building A', 'inbound', NULL, true, NOW() - INTERVAL '2 hours'),
      (3, 'system', '27783333555', 'Emergency response dispatched', 'outbound', 'System', true, NOW() - INTERVAL '1 hour 55 minutes'),
      (3, '27783333555', 'system', 'Thank you, I am safe now', 'inbound', NULL, true, NOW() - INTERVAL '1 hour 50 minutes'),
      (3, 'system', '27783333555', 'Ticket closed. Stay safe!', 'outbound', 'System', true, NOW() - INTERVAL '1 hour 45 minutes'),
      (4, '27788517152', 'system', 'Lift stuck between floors', 'inbound', NULL, false, NOW() - INTERVAL '45 minutes'),
      (4, 'system', '27788517152', 'Emergency response team notified', 'outbound', 'System', true, NOW() - INTERVAL '44 minutes')
    `);
    
    // Update resolved_at for closed ticket
    await query(`
      UPDATE tickets SET resolved_at = NOW() - INTERVAL '1 hour 45 minutes' WHERE id = 3
    `);
    
    res.json({
      ok: true,
      message: 'Sample tickets created successfully',
      created: {
        tickets: ticketsResult.rows.length,
        messages: 11
      }
    });
  } catch (error) {
    console.error('[debug-tickets/create-samples] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Failed to create sample tickets', 
        details: error.message
      } 
    });
  }
});

// Add WhatsApp contact for testing
router.post('/add-whatsapp-contact', async (req, res) => {
  try {
    console.log('[debug-tickets] Adding WhatsApp contact...');
    
    // Add Marc's actual WhatsApp number as a contact
    const contactResult = await query(`
      INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
      ('f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95c', 'Marc WhatsApp', '27690232755', NOW())
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `);
    
    // Link to existing lift (Test Building)
    await query(`
      INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
      (1, 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95c', 'primary')
      ON CONFLICT DO NOTHING
    `);
    
    res.json({
      ok: true,
      message: 'WhatsApp contact added successfully',
      contact: contactResult.rows[0] || 'Contact already exists'
    });
  } catch (error) {
    console.error('[debug-tickets/add-whatsapp-contact] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        message: 'Failed to add WhatsApp contact', 
        details: error.message
      } 
    });
  }
});

module.exports = router;
