// SMS routes for Replit
const express = require('express');
const router = express.Router();

// Simple SMS plain endpoint
router.post('/plain', express.json(), async (req, res) => {
  try {
    const { phone, message, msisdn, text } = req.body;
    
    // Normalize phone number and message
    const phoneNumber = phone || msisdn || '';
    const messageText = message || text || '';
    
    if (!phoneNumber || !messageText) {
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
    
    console.log(`[sms/plain] Received: ${phoneNumber} -> ${messageText}`);
    
    res.json({ status: 'ok', processed: true });
  } catch (error) {
    console.error('[sms/plain] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
