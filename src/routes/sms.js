// SMS routes for Replit
const express = require('express');
const router = express.Router();

// Simple SMS plain endpoint
router.post('/plain', express.json(), async (req, res) => {
  try {
    console.log('[sms/plain] ===== INCOMING SMS WEBHOOK =====');
    console.log('[sms/plain] Full payload:', JSON.stringify(req.body, null, 2));
    console.log('[sms/plain] Content-Type:', req.get('content-type'));
    
    const { phone, message, msisdn, text } = req.body;
    
    // Normalize phone number and message
    const phoneNumber = phone || msisdn || '';
    const messageText = message || text || '';
    
    console.log(`[sms/plain] Parsed - Phone: ${phoneNumber}, Message: ${messageText}`);
    
    if (!phoneNumber || !messageText) {
      console.log('[sms/plain] ERROR: Missing phone or message in payload');
      return res.status(400).json({ error: 'Missing phone or message' });
    }
    
    // Store in global buffer for debugging
    global.LAST_INBOUND = {
      id: `plain-${Date.now()}`,
      from: phoneNumber,
      message: messageText,
      received_at: new Date().toISOString(),
      raw: req.body
    };
    
    console.log(`[sms/plain] SUCCESS: Received from ${phoneNumber}: "${messageText}"`);
    console.log('[sms/plain] ===== END SMS WEBHOOK =====');
    
    res.json({ status: 'ok', processed: true });
  } catch (error) {
    console.error('[sms/plain] EXCEPTION:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
