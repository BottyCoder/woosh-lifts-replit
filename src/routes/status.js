// src/routes/status.js
// Handles WhatsApp message status updates (delivered, read, failed) from Woosh Bridge

const express = require('express');
const { query } = require('../db');

const router = express.Router();
const jsonParser = express.json();

// Status webhook endpoint
router.post('/webhook', jsonParser, async (req, res) => {
  try {
    console.log('[status/webhook] Received status update:', JSON.stringify(req.body, null, 2));
    
    const { type, wa_id, data, event_ts } = req.body;
    
    // Verify it's a status update
    if (type !== 'message.status') {
      console.log('[status/webhook] Not a status update, ignoring:', type);
      return res.status(200).json({ ok: true, ignored: true, reason: 'not_status_update' });
    }
    
    if (!wa_id || !data || !data.status) {
      console.warn('[status/webhook] Missing required fields:', { wa_id, hasData: !!data, status: data?.status });
      return res.status(200).json({ ok: true, ignored: true, reason: 'missing_fields' });
    }
    
    const status = data.status; // 'sent' | 'delivered' | 'read' | 'failed'
    const timestamp = data.timestamp ? new Date(parseInt(data.timestamp) * 1000) : new Date();
    const recipientId = data.recipient_id;
    
    console.log('[status/webhook] Processing status update:', {
      wa_id,
      status,
      timestamp: timestamp.toISOString(),
      recipient: recipientId
    });
    
    // Update ticket_messages table (our primary tracking table)
    const tmResult = await query(
      `SELECT id, ticket_id, contact_id, message_kind 
       FROM ticket_messages 
       WHERE message_id = $1`,
      [wa_id]
    );
    
    if (tmResult.rows.length === 0) {
      // Check messages table as fallback
      const msgResult = await query(
        `SELECT id FROM messages WHERE wa_id = $1`,
        [wa_id]
      );
      
      if (msgResult.rows.length === 0) {
        console.warn('[status/webhook] Message not found in database:', wa_id);
        return res.status(200).json({ 
          ok: true, 
          processed: false, 
          reason: 'message_not_found',
          wa_id 
        });
      }
      
      // Update messages table only
      const updateFields = buildUpdateFields(status, timestamp, data);
      await query(
        `UPDATE messages 
         SET current_status = $1,
             delivered_at = COALESCE($2, delivered_at),
             read_at = COALESCE($3, read_at),
             error_code = COALESCE($4, error_code),
             error_message = COALESCE($5, error_message)
         WHERE wa_id = $6`,
        [
          updateFields.current_status,
          updateFields.delivered_at,
          updateFields.read_at,
          updateFields.error_code,
          updateFields.error_message,
          wa_id
        ]
      );
      
      console.log('[status/webhook] Updated messages table for wa_id:', wa_id);
      return res.status(200).json({ ok: true, processed: true, table: 'messages' });
    }
    
    // Update ticket_messages table
    const ticketMessage = tmResult.rows[0];
    const updateFields = buildUpdateFields(status, timestamp, data);
    
    await query(
      `UPDATE ticket_messages 
       SET current_status = $1,
           delivered_at = COALESCE($2, delivered_at),
           read_at = COALESCE($3, read_at),
           error_code = COALESCE($4, error_code),
           error_message = COALESCE($5, error_message)
       WHERE message_id = $6`,
      [
        updateFields.current_status,
        updateFields.delivered_at,
        updateFields.read_at,
        updateFields.error_code,
        updateFields.error_message,
        wa_id
      ]
    );
    
    console.log('[status/webhook] ✅ Updated ticket_messages:', {
      ticket_id: ticketMessage.ticket_id,
      message_kind: ticketMessage.message_kind,
      status,
      wa_id
    });
    
    // Log the status event for audit trail
    await query(
      `INSERT INTO event_log (event_type, metadata, request_payload, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        'message_status_update',
        JSON.stringify({
          wa_id,
          status,
          ticket_id: ticketMessage.ticket_id,
          message_kind: ticketMessage.message_kind,
          recipient: recipientId
        }),
        JSON.stringify(req.body)
      ]
    );
    
    return res.status(200).json({ 
      ok: true, 
      processed: true,
      ticket_id: ticketMessage.ticket_id,
      status
    });
    
  } catch (error) {
    console.error('[status/webhook] Error processing status update:', error);
    // Always return 200 to prevent Woosh Bridge from retrying
    return res.status(200).json({ 
      ok: false, 
      error: error.message,
      processed: false
    });
  }
});

// Helper function to build update fields based on status
function buildUpdateFields(status, timestamp, data) {
  const fields = {
    current_status: status,
    delivered_at: null,
    read_at: null,
    error_code: null,
    error_message: null
  };
  
  if (status === 'delivered') {
    fields.delivered_at = timestamp;
  } else if (status === 'read') {
    fields.read_at = timestamp;
  } else if (status === 'failed') {
    fields.error_code = data.errors?.[0]?.code || 'UNKNOWN_ERROR';
    fields.error_message = data.errors?.[0]?.title || data.errors?.[0]?.message || 'Message delivery failed';
  }
  
  return fields;
}

module.exports = router;
