# Button Click Tracking - Quick Reference

## TL;DR for Growthpoint

✅ **YES** - You can track which specific message a button click came from  
✅ **Field:** `context.id` in the webhook payload  
✅ **Works for:** Multiple identical button sets sent to same user

---

## The Key Field

```javascript
// When user clicks a button, webhook contains:
webhook.entry[0].changes[0].value.messages[0].context.id
// This is the ID of the ORIGINAL message that had the button
```

---

## Simple 3-Step Process

### 1️⃣ Send Message - Save ID

```javascript
POST /api/messages/send
// Response: { "wa_id": "wamid.ABC123..." }

// Save this wa_id with your ticket:
db.save({ ticketId: "EMG-001", messageId: "wamid.ABC123..." })
```

### 2️⃣ User Clicks Button - Webhook Arrives

```javascript
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "context": {
            "id": "wamid.ABC123..."  // ← Links to original message!
          },
          "interactive": {
            "button_reply": {
              "id": "opt_entrapment",
              "title": "Entrapment"
            }
          }
        }]
      }
    }]
  }]
}
```

### 3️⃣ Match & Process

```javascript
const contextId = webhook.entry[0].changes[0].value.messages[0].context.id;
const buttonTitle = webhook.entry[0].changes[0].value.messages[0].interactive.button_reply.title;

const ticket = db.findByMessageId(contextId);
// Now you know: User clicked "Entrapment" for Ticket EMG-001
```

---

## Example: Multiple Lifts

```javascript
// Send alert for LIFT-A
const msg1 = await send({ to: "user", text: "Alert: LIFT-A", buttons: [...] });
db.save({ ticket: "T1", lift: "LIFT-A", msgId: msg1.wa_id });

// Send alert for LIFT-B  
const msg2 = await send({ to: "user", text: "Alert: LIFT-B", buttons: [...] });
db.save({ ticket: "T2", lift: "LIFT-B", msgId: msg2.wa_id });

// User clicks button on LIFT-B message
// Webhook has: context.id = msg2.wa_id
// You can now: Look up ticket T2, Lift LIFT-B
```

---

## All Available Fields in Button Click Webhook

| Path | Value | Use |
|------|-------|-----|
| `messages[0].from` | `"27824537125"` | User who clicked |
| `messages[0].id` | `"wamid.XYZ..."` | This click event's ID |
| `messages[0].timestamp` | `"1696166400"` | When clicked (Unix) |
| `messages[0].interactive.button_reply.id` | `"opt_test"` | Your button ID |
| `messages[0].interactive.button_reply.title` | `"Test"` | Button text |
| **`messages[0].context.id`** | **`"wamid.ABC..."`** | **Original message ID** ⭐ |

---

## Database Schema (Recommended)

```sql
CREATE TABLE emergency_alerts (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(255) UNIQUE,  -- Store wa_id from send response
  ticket_id VARCHAR(100),
  lift_id VARCHAR(100),
  sent_at TIMESTAMP,
  response_button VARCHAR(100),
  responded_at TIMESTAMP
);
```

---

## Testing

### Send Test Message
```bash
curl -X POST https://wa.woosh.ai/api/messages/send \
  -H "X-Api-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "27824537125",
    "type": "interactive",
    "interactive": {
      "type": "button",
      "body": {"text": "Test - Lift A"},
      "action": {
        "buttons": [
          {"type": "reply", "reply": {"id": "test_1", "title": "Option 1"}}
        ]
      }
    }
  }'
```

### Check Webhook
When user clicks, your webhook receives the full payload with `context.id`.

---

## Resources

- **Full Documentation:** `docs/INTERACTIVE-BUTTON-WEBHOOKS.md`
- **Working Example Code:** `docs/examples/track-button-clicks.js`
- **Test the Example:**
  ```bash
  cd docs/examples
  export BRIDGE_API_KEY="your-key"
  node track-button-clicks.js
  ```

---

## Questions?

Contact Woosh Support with:
- Your specific use case
- Sample payloads (if something doesn't match)
- Any integration challenges

