# WhatsApp Interactive Button Webhooks - Complete Guide

## Overview
When a user clicks an interactive button in WhatsApp (from either a template message or session message), Meta includes comprehensive tracking information in the webhook payload. This guide explains exactly what data is available for Growthpoint's emergency alert system.

---

## ✅ YES - Button Clicks Include Original Message ID

**The good news:** Meta **DOES include the original message ID** through the `context` object in button reply webhooks.

---

## Complete Webhook Payload Structure

When a user clicks a button, the webhook received at your endpoint contains:

### Full Sample Payload

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "27123456789",
              "phone_number_id": "753321277868753"
            },
            "contacts": [
              {
                "profile": {
                  "name": "John Smith"
                },
                "wa_id": "27824537125"
              }
            ],
            "messages": [
              {
                "from": "27824537125",
                "id": "wamid.HBgLMjc4MjQ1MzcxMjUVAgARGBI5RTNBQTA2RTMzRjdGMDc3NTEA",
                "timestamp": "1696166400",
                "type": "interactive",
                "interactive": {
                  "type": "button_reply",
                  "button_reply": {
                    "id": "lift_emergency_001",
                    "title": "Entrapment"
                  }
                },
                "context": {
                  "from": "27123456789",
                  "id": "wamid.HBgLMjc4MjQ1MzcxMjUVAgASGBQzQTU2NzlCQzA3QkFCNzdCRjgA"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

---

## Key Fields for Tracking Button Clicks

### 1. Message Context ID (Original Message)
**Path:** `entry[0].changes[0].value.messages[0].context.id`  
**Value:** `"wamid.HBgLMjc4MjQ1MzcxMjUVAgASGBQzQTU2NzlCQzA3QkFCNzdCRjgA"`

✅ **This is the ID of the original message** that contained the button. Use this to match button clicks to specific emergency alerts.

### 2. Button Click Details
**Path:** `entry[0].changes[0].value.messages[0].interactive.button_reply`

Contains:
- **`id`**: Your custom button identifier (e.g., `"lift_emergency_001"`, `"opt_test"`, `"opt_maintenance"`)
- **`title`**: The button text displayed to user (e.g., `"Entrapment"`, `"Test"`)

### 3. User Information
**Path:** `entry[0].changes[0].value.messages[0]`

Contains:
- **`from`**: User's WhatsApp ID (phone number)
- **`id`**: Unique ID for this button click event (different from original message)
- **`timestamp`**: Unix timestamp when button was clicked

### 4. Contact Profile
**Path:** `entry[0].changes[0].value.contacts[0]`

Contains:
- **`profile.name`**: User's WhatsApp display name
- **`wa_id`**: User's WhatsApp ID

---

## Solving the Multi-Emergency Scenario

### Problem Statement
Growthpoint needs to support scenarios where:
1. User receives **multiple emergency alerts** for different lifts
2. Each alert has the **same buttons** ("Test", "Maintenance", "Entrapment")
3. System must correctly match button click to specific emergency/ticket

### Solution: Use `context.id` Field

When you send a message through Woosh Bridge, Meta returns a `wa_id` in the response:

**Step 1: Send Emergency Alert**
```bash
POST https://wa.woosh.ai/api/messages/send
X-Api-Key: <your_key>

{
  "to": "27824537125",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "Emergency Alert: Lift A - Floor 3\nPlease indicate emergency type:" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "lift_a_test", "title": "Test" } },
        { "type": "reply", "reply": { "id": "lift_a_maint", "title": "Maintenance" } },
        { "type": "reply", "reply": { "id": "lift_a_entrap", "title": "Entrapment" } }
      ]
    }
  }
}
```

**Response:**
```json
{
  "ok": true,
  "wa_id": "wamid.HBgLMjc4MjQ1MzcxMjUVAgASGBQzQTU2NzlCQzA3QkFCNzdCRjgA",
  "accepted": true
}
```

**Step 2: Store Mapping**
Store this `wa_id` in your database with the emergency/ticket details:

```javascript
// Your system stores:
{
  messageId: "wamid.HBgLMjc4MjQ1MzcxMjUVAgASGBQzQTU2NzlCQzA3QkFCNzdCRjgA",
  ticketId: "EMG-2024-001",
  liftId: "LIFT-A",
  floor: 3,
  sentAt: "2024-10-01T10:30:00Z",
  status: "awaiting_response"
}
```

**Step 3: Match Button Click**
When webhook arrives with button click:

```javascript
const webhook = req.body;
const message = webhook.entry[0].changes[0].value.messages[0];

// Extract the original message ID
const originalMessageId = message.context.id;
// e.g., "wamid.HBgLMjc4MjQ1MzcxMjUVAgASGBQzQTU2NzlCQzA3QkFCNzdCRjgA"

// Extract button info
const buttonId = message.interactive.button_reply.id;
const buttonTitle = message.interactive.button_reply.title;

// Look up in your database
const emergency = await db.query(
  'SELECT * FROM emergencies WHERE message_id = $1',
  [originalMessageId]
);

// Now you know:
// - Which specific emergency alert this click is for
// - Which lift/ticket
// - What button they clicked
console.log(`User clicked "${buttonTitle}" for Ticket ${emergency.ticketId}, Lift ${emergency.liftId}`);
```

---

## Complete Field Reference

### Available at `entry[0].changes[0].value.messages[0]`

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `from` | string | User's WhatsApp ID | `"27824537125"` |
| `id` | string | Unique ID for this webhook event | `"wamid.HBgL..."` |
| `timestamp` | string | Unix timestamp (seconds) | `"1696166400"` |
| `type` | string | Always `"interactive"` for buttons | `"interactive"` |
| `interactive.type` | string | Type of interactive element | `"button_reply"` |
| `interactive.button_reply.id` | string | Your custom button ID | `"opt_test"` |
| `interactive.button_reply.title` | string | Button text shown to user | `"Test"` |
| **`context.id`** | string | **ID of original message** | `"wamid.HBgL..."` |
| `context.from` | string | Business phone number | `"27123456789"` |

---

## Implementation Recommendations

### 1. Database Schema
```sql
CREATE TABLE emergency_messages (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(255) UNIQUE NOT NULL,  -- The wa_id from send response
  ticket_id VARCHAR(100) NOT NULL,
  lift_id VARCHAR(100) NOT NULL,
  contact_phone VARCHAR(50) NOT NULL,
  sent_at TIMESTAMP NOT NULL,
  responded_at TIMESTAMP,
  response_button_id VARCHAR(100),
  response_button_title VARCHAR(100),
  status VARCHAR(50) DEFAULT 'sent'
);

CREATE INDEX idx_emergency_msg_id ON emergency_messages(message_id);
CREATE INDEX idx_emergency_ticket ON emergency_messages(ticket_id);
```

### 2. Send Message Handler
```javascript
async function sendEmergencyAlert(ticketId, liftId, contactPhone) {
  // Send via Woosh Bridge
  const response = await fetch('https://wa.woosh.ai/api/messages/send', {
    method: 'POST',
    headers: {
      'X-Api-Key': process.env.BRIDGE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: contactPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { 
          text: `Emergency Alert: ${liftId}\nTicket: ${ticketId}\nPlease indicate type:` 
        },
        action: {
          buttons: [
            { type: 'reply', reply: { id: `${ticketId}_test`, title: 'Test' } },
            { type: 'reply', reply: { id: `${ticketId}_maint`, title: 'Maintenance' } },
            { type: 'reply', reply: { id: `${ticketId}_entrap`, title: 'Entrapment' } }
          ]
        }
      }
    })
  });

  const result = await response.json();
  
  // Store the message ID for tracking
  await db.query(
    `INSERT INTO emergency_messages 
     (message_id, ticket_id, lift_id, contact_phone, sent_at, status)
     VALUES ($1, $2, $3, $4, NOW(), 'sent')`,
    [result.wa_id, ticketId, liftId, contactPhone]
  );

  return result.wa_id;
}
```

### 3. Webhook Handler
```javascript
async function handleButtonClick(webhook) {
  const message = webhook.entry[0].changes[0].value.messages[0];
  
  // Only process interactive button replies
  if (message.type !== 'interactive' || 
      message.interactive?.type !== 'button_reply') {
    return;
  }

  const originalMessageId = message.context?.id;
  const buttonId = message.interactive.button_reply.id;
  const buttonTitle = message.interactive.button_reply.title;
  const userPhone = message.from;
  const clickedAt = new Date(parseInt(message.timestamp) * 1000);

  if (!originalMessageId) {
    console.warn('Button click missing context.id - cannot track');
    return;
  }

  // Find the original emergency alert
  const result = await db.query(
    `UPDATE emergency_messages 
     SET responded_at = $1, 
         response_button_id = $2,
         response_button_title = $3,
         status = 'responded'
     WHERE message_id = $4
     RETURNING *`,
    [clickedAt, buttonId, buttonTitle, originalMessageId]
  );

  if (result.rows.length === 0) {
    console.warn('Button click for unknown message:', originalMessageId);
    return;
  }

  const emergency = result.rows[0];
  console.log(`Emergency response received:
    Ticket: ${emergency.ticket_id}
    Lift: ${emergency.lift_id}
    Response: ${buttonTitle}
    User: ${userPhone}
  `);

  // Update your ticketing system, trigger alerts, etc.
  await updateTicketStatus(emergency.ticket_id, buttonTitle);
}
```

---

## Testing Guide

### 1. Send Test Message
```bash
curl -X POST https://wa.woosh.ai/api/messages/send \
  -H "X-Api-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "27824537125",
    "type": "interactive",
    "interactive": {
      "type": "button",
      "body": {"text": "Test Alert - Lift A"},
      "action": {
        "buttons": [
          {"type": "reply", "reply": {"id": "test_1", "title": "Option 1"}},
          {"type": "reply", "reply": {"id": "test_2", "title": "Option 2"}}
        ]
      }
    }
  }'
```

Save the `wa_id` from response.

### 2. Click Button in WhatsApp
User clicks one of the buttons.

### 3. Check Webhook Payload
The webhook you receive will contain:
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "context": {
            "id": "<THE_WA_ID_YOU_SAVED>"
          },
          "interactive": {
            "button_reply": {
              "id": "test_1",
              "title": "Option 1"
            }
          }
        }]
      }
    }]
  }]
}
```

---

## Current Woosh Bridge Implementation

### ⚠️ Note: Context Field Not Yet Extracted

The current Woosh Bridge code in `src/bot/router.js` **does extract** the button ID and title, but **does not yet extract** the `context.id` field.

**Current code (lines 33-36):**
```javascript
if (i?.type === 'button_reply') {
  return { type: 'button', id: i.button_reply.id, title: i.button_reply.title };
}
```

### Enhancement Needed

To make the `context.id` available to your webhook handler, we should enhance the normalization:

```javascript
if (i?.type === 'button_reply') {
  return { 
    type: 'button', 
    id: i.button_reply.id, 
    title: i.button_reply.title,
    contextId: msg.context?.id || null  // Add this
  };
}
```

However, **you don't need to wait for this enhancement** because:
1. The raw webhook payload is forwarded to your endpoint
2. You can extract `context.id` directly from the webhook payload in your handler
3. The full webhook structure is preserved in the forwarding

---

## Summary & Next Steps

### ✅ Answers to Your Questions

1. **Message Context ID**: YES - Meta includes `context.id` with the original message ID
2. **Payload Structure**: Full structure documented above with all available fields
3. **Tracking Multiple Messages**: Use `context.id` to match clicks to specific messages

### Recommended Approach

1. **Store `wa_id` from send responses** - Map these to tickets/emergencies in your DB
2. **Extract `context.id` from button click webhooks** - Use this to look up original message
3. **Match & Process** - Connect the dots: button click → message ID → ticket/emergency

### Optional Enhancement

If you'd like us to enhance Woosh Bridge to automatically extract and forward the `context.id` in a more convenient format, let us know. However, the raw webhook data is already available to you, so this is optional.

---

## Questions or Issues?

If you need:
- Sample webhook payloads from real button clicks
- Help implementing the tracking logic
- Database schema recommendations
- Testing support

Please reach out to Woosh Support.

