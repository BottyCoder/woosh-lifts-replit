// src/routes/status.js
// Handles WhatsApp message status updates (delivered, read, failed) from Woosh Bridge

const express = require('express');
const { query, withTxn } = require('../db');

const router = express.Router();
const jsonParser = express.json();

// Webhook authentication middleware
function authenticateWebhook(req, res, next) {
  const webhookAuthToken = process.env.WEBHOOK_AUTH_TOKEN || process.env.BRIDGE_API_KEY;
  
  if (!webhookAuthToken) {
    console.error('[status/webhook] CRITICAL: No WEBHOOK_AUTH_TOKEN or BRIDGE_API_KEY configured - webhook is UNPROTECTED');
    return res.status(401).json({ 
      error: 'Webhook authentication not configured',
      message: 'WEBHOOK_AUTH_TOKEN or BRIDGE_API_KEY must be set'
    });
  }
  
  const authHeader = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'];
  const xTenantKey = req.headers['x-tenant-key'];
  
  const providedToken = authHeader?.replace(/^Bearer\s+/i, '') || xApiKey || xTenantKey;
  
  if (providedToken !== webhookAuthToken) {
    console.warn('[status/webhook] Unauthorized webhook attempt:', {
      ip: req.ip,
      headers: Object.keys(req.headers)
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

// Status webhook endpoint
router.post('/webhook', authenticateWebhook, jsonParser, async (req, res) => {
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
    
    // Process update in a transaction
    const result = await withTxn(async (txn) => {
      // Check if this message exists in ticket_messages
      const tmResult = await txn.query(
        `SELECT id, ticket_id, contact_id, message_kind 
         FROM ticket_messages 
         WHERE message_id = $1`,
        [wa_id]
      );
      
      // Check if this message exists in messages table
      const msgResult = await txn.query(
        `SELECT id, lift_id FROM messages WHERE wa_id = $1`,
        [wa_id]
      );
      
      if (tmResult.rows.length === 0 && msgResult.rows.length === 0) {
        console.warn('[status/webhook] Message not found in database:', wa_id);
        return { found: false, wa_id };
      }
      
      const updateFields = buildUpdateFields(status, timestamp, data);
      
      // Update ticket_messages if found
      if (tmResult.rows.length > 0) {
        const ticketMessage = tmResult.rows[0];
        
        await txn.query(
          `UPDATE ticket_messages 
           SET current_status = $1,
               delivered_at = CASE WHEN $2 IS NOT NULL THEN $2 ELSE delivered_at END,
               read_at = CASE WHEN $3 IS NOT NULL THEN $3 ELSE read_at END,
               error_code = CASE WHEN $4 IS NOT NULL THEN $4 ELSE NULL END,
               error_message = CASE WHEN $5 IS NOT NULL THEN $5 ELSE NULL END
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
      }
      
      // Update messages table if found
      if (msgResult.rows.length > 0) {
        await txn.query(
          `UPDATE messages 
           SET current_status = $1,
               delivered_at = CASE WHEN $2 IS NOT NULL THEN $2 ELSE delivered_at END,
               read_at = CASE WHEN $3 IS NOT NULL THEN $3 ELSE read_at END,
               error_code = CASE WHEN $4 IS NOT NULL THEN $4 ELSE NULL END,
               error_message = CASE WHEN $5 IS NOT NULL THEN $5 ELSE NULL END
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
        
        console.log('[status/webhook] ✅ Updated messages table for wa_id:', wa_id);
      }
      
      return {
        found: true,
        ticket_id: tmResult.rows[0]?.ticket_id,
        lift_id: msgResult.rows[0]?.lift_id,
        status
      };
    });
    
    // Handle message not found
    if (!result.found) {
      return res.status(200).json({ 
        ok: true, 
        processed: false,
        reason: 'message_not_found',
        wa_id
      });
    }
    
    return res.status(200).json({ 
      ok: true, 
      processed: true,
      status
    });
    
  } catch (error) {
    console.error('[status/webhook] Error processing status update:', error);
    
    // Return 500 for database errors to allow retry
    if (error.code && error.code.startsWith('23')) {
      // PostgreSQL constraint violation - likely transient
      return res.status(500).json({ 
        ok: false, 
        error: 'database_error',
        processed: false
      });
    }
    
    // Return 500 for unexpected errors
    return res.status(500).json({ 
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
    // Clear error fields when transitioning from failed to delivered
  } else if (status === 'read') {
    fields.read_at = timestamp;
    // Clear error fields when transitioning from failed to read
  } else if (status === 'failed') {
    fields.error_code = data.errors?.[0]?.code || 'UNKNOWN_ERROR';
    fields.error_message = data.errors?.[0]?.title || data.errors?.[0]?.message || 'Message delivery failed';
  }
  
  return fields;
}

module.exports = router;
