# AI Troubleshooting API - Quick Reference

## 🔑 Authentication

Add this header to all requests:
```bash
X-AI-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ3b29zaC5haSIsInN1YiI6Im1hcmNAdm9vc2guYWkiLCJpYXQiOjE3MNTkyNDc4ODAsInNjb3BlIjoiYWRtaW4ifQ._q0Gv0aK1l1sXkJYx2Tb3Zk2r8V5yQYhQyqP8w1Z0b4
```

## 🚀 Common Troubleshooting Scenarios

### Scenario 1: Check System Health
```bash
GET /api/troubleshoot/diagnostics
```
Returns: Database status, counts, recent activity, environment check

### Scenario 2: Debug Message Delivery Issue
```bash
# Get recent messages for a specific lift
GET /api/troubleshoot/messages?lift_id=123&limit=20

# Check failed messages
GET /api/troubleshoot/messages?status=failed

# Find messages for a specific ticket
GET /api/troubleshoot/messages?ticket_id=456
```

### Scenario 3: Track Button Click Issues
```bash
# Get ticket with all messages (includes wa_id tracking)
GET /api/troubleshoot/tickets/123

# Check event timeline for button clicks
GET /api/troubleshoot/tickets/123/events

# Search logs for button-related events
GET /api/troubleshoot/logs?event_type=button_click&ticket_id=123
```

### Scenario 4: Verify Lift Configuration
```bash
# Find a lift by search
GET /api/troubleshoot/lifts?search=Sandton

# Get lift with all contacts
GET /api/troubleshoot/lifts/5

# Check if contacts are properly linked
# (Look at contacts array in response)
```

### Scenario 5: Check Contact Response History
```bash
# Get contact details with response history
GET /api/troubleshoot/contacts/uuid-here

# Search for contact by phone/name
GET /api/troubleshoot/contacts?search=marc
```

### Scenario 6: Investigate Open Tickets
```bash
# Get all open tickets
GET /api/troubleshoot/tickets?status=open

# Get tickets for specific lift
GET /api/troubleshoot/tickets?lift_id=5&status=open

# Get recent tickets (last 24 hours)
GET /api/troubleshoot/tickets?since=2025-10-01T00:00:00Z
```

### Scenario 7: Analyze Event Patterns
```bash
# Get all event types to see what's available
GET /api/troubleshoot/event-types

# Search for specific event patterns
GET /api/troubleshoot/logs?event_type=template_fail&limit=50

# Get logs for a specific timeframe
GET /api/troubleshoot/logs?since=2025-10-01T08:00:00Z&limit=100
```

### Scenario 8: Check Latest Inbound SMS
```bash
GET /api/inbound/latest
```
Returns the most recent SMS received (useful for testing)

## 📊 Key Response Fields

### Messages Endpoint
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": 123,
        "lift_id": 5,
        "lift_name": "Sandton City - North Lift",
        "ticket_id": 456,
        "msisdn": "27821234567",
        "direction": "outbound",
        "type": "template",
        "status": "sent",
        "wa_id": "wamid.xxx",  // WhatsApp message ID for tracking
        "body": "message content",
        "created_at": "2025-10-01T10:30:00Z"
      }
    ],
    "total": 150,
    "returned": 20
  }
}
```

### Ticket Details
```json
{
  "ok": true,
  "data": {
    "ticket": {
      "id": 123,
      "ticket_reference": "SANDTON-CITY-TKT123",
      "status": "open",
      "button_clicked": "entrapment_awaiting_confirmation",
      "lift_name": "Sandton City - North Lift",
      "responded_by": "uuid",
      "responded_by_name": "Marc Smith"
    },
    "contacts": [...],  // All contacts for this lift
    "messages": [...]   // Message tracking with wa_id
  }
}
```

### Diagnostics
```json
{
  "ok": true,
  "data": {
    "timestamp": "2025-10-01T10:30:00Z",
    "database": {
      "connected": true,
      "latency_ms": 45
    },
    "counts": {
      "lifts": 150,
      "contacts": 350,
      "tickets": 1250,
      "open_tickets": 5
    },
    "recent_activity": {
      "last_ticket": "2025-10-01T10:15:00Z",
      "last_event": "2025-10-01T10:20:00Z",
      "last_log": "2025-10-01T10:25:00Z"
    },
    "environment": {
      "bridge_api_key": true,
      "template_name": "growthpoint_lift_emergency",
      "admin_token": true,
      "ai_token": true
    }
  }
}
```

## 🔍 Debugging Workflows

### Workflow 1: "Why didn't contact X receive the message?"

1. **Get ticket details**
   ```bash
   GET /api/troubleshoot/tickets/123
   ```
   Check: Are all expected contacts listed?

2. **Check message history**
   ```bash
   GET /api/troubleshoot/messages?ticket_id=123
   ```
   Look for: Messages to that contact, status (sent/failed)

3. **Check event logs**
   ```bash
   GET /api/troubleshoot/logs?ticket_id=123&event_type=template
   ```
   Look for: template_ok vs template_fail events

4. **Verify contact linkage**
   ```bash
   GET /api/troubleshoot/lifts/{lift_id}
   ```
   Check: Is contact properly linked to lift?

### Workflow 2: "Button clicks not working"

1. **Get ticket with messages**
   ```bash
   GET /api/troubleshoot/tickets/123
   ```
   Check: `message_id` and `wa_id` fields populated?

2. **Check button click events**
   ```bash
   GET /api/troubleshoot/tickets/123/events
   ```
   Look for: button_click_received, entrapment_followup_sent

3. **Check webhook logs**
   ```bash
   GET /api/troubleshoot/logs?event_type=webhook&ticket_id=123
   ```
   Look for: webhook_whatsapp_received, button authentication

4. **Verify message tracking**
   ```bash
   GET /api/troubleshoot/messages?ticket_id=123
   ```
   Check: All messages have wa_id values

### Workflow 3: "System seems slow/unresponsive"

1. **Check diagnostics**
   ```bash
   GET /api/troubleshoot/diagnostics
   ```
   Look at: database.latency_ms, memory_usage

2. **Check recent error patterns**
   ```bash
   GET /api/troubleshoot/logs?event_type=error&limit=50
   ```

3. **Check open tickets**
   ```bash
   GET /api/troubleshoot/tickets?status=open
   ```
   Look for: Stuck tickets with high reminder_count

4. **Check event log size**
   ```bash
   GET /api/troubleshoot/diagnostics
   ```
   Look at: counts.event_logs (if very high, may need cleanup)

## ⚠️ Rate Limits

- **AI Token**: 30 requests/minute
- **Admin Token**: Unlimited

If you hit rate limits, wait 60 seconds or switch to ADMIN_TOKEN.

## 🔐 Security Notes

- ✅ AI token is read-only (cannot modify data)
- ✅ All access is logged to event_log table
- ✅ Failed auth attempts are logged with IP
- ✅ No sensitive credentials exposed in responses
- ✅ POPIA compliant audit trail

## 💡 Pro Tips

1. **Always start with diagnostics** to check system health
2. **Use pagination** on large result sets (limit + offset)
3. **Filter by time** with `since` parameter to narrow results
4. **Search is case-insensitive** on lifts/contacts
5. **Check event_types first** to see what logs are available
6. **Message wa_id** is critical for button click tracking
7. **Ticket events** show complete chronological history

## 📞 Getting Help

If you need additional endpoints or functionality:
1. Check what data exists in the database
2. Request new read-only endpoint
3. Never modify core system files (server.js)
4. Create new files in src/routes/ or src/mw/

---

**Ready to troubleshoot!** 🚀

