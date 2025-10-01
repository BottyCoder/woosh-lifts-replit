# Guide: Using Cursor AI with Woosh Lifts Troubleshooting API

## 🎯 Overview

You now have a complete troubleshooting API that Cursor AI (or any AI assistant) can use to diagnose issues with the Woosh Lifts system. This guide shows how to effectively use it.

## 🔑 Setup in Cursor AI

When asking Cursor AI to troubleshoot, provide this context:

```
The Woosh Lifts system has a troubleshooting API at:
Base URL: https://[your-replit-url].repl.co/api/troubleshoot

Authentication:
X-AI-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ3b29zaC5haSIsInN1YiI6Im1hcmNAdm9vc2guYWkiLCJpYXQiOjE3MNTkyNDc4ODAsInNjb3BlIjoiYWRtaW4ifQ._q0Gv0aK1l1sXkJYx2Tb3Zk2r8V5yQYhQyqP8w1Z0b4

Available endpoints:
- GET /diagnostics - System health
- GET /tickets?status=open - Open tickets
- GET /tickets/:id - Ticket details
- GET /tickets/:id/events - Ticket event timeline
- GET /lifts - List lifts
- GET /lifts/:id - Lift details
- GET /contacts - List contacts
- GET /contacts/:id - Contact details
- GET /messages - Message history (with wa_id tracking)
- GET /logs - Event logs with filtering
- GET /event-types - Available event types

Rate limit: 30 requests/minute
```

## 💬 Example Prompts for Cursor AI

### Prompt 1: General Health Check
```
Check the health of the Woosh Lifts system. Use the /api/troubleshoot/diagnostics 
endpoint to verify:
1. Database connectivity
2. Message counts
3. Open tickets
4. Environment configuration

Report any issues found.
```

### Prompt 2: Investigate Specific Ticket
```
Ticket #123 is showing as stuck in "entrapment_awaiting_confirmation" status.
Investigate by:
1. Getting ticket details from /api/troubleshoot/tickets/123
2. Checking the event timeline at /api/troubleshoot/tickets/123/events
3. Reviewing messages for this ticket at /api/troubleshoot/messages?ticket_id=123
4. Checking logs for button_click events

Tell me what happened and why it might be stuck.
```

### Prompt 3: Debug Message Delivery
```
Contact Marc (UUID: xxx-xxx-xxx) reports not receiving WhatsApp messages for 
lift "Sandton City - North Lift" (ID: 5).

Diagnose by:
1. Checking lift configuration and linked contacts
2. Reviewing message history for this lift
3. Looking for failed template sends in logs
4. Verifying contact's phone number is correct

Provide a root cause analysis.
```

### Prompt 4: Button Click Not Working
```
Button clicks aren't being processed for ticket #456. Investigate:
1. Check if messages have wa_id values (required for button tracking)
2. Review webhook logs for button_click events
3. Check ticket_messages table via ticket details
4. Look for authentication failures in logs

Explain what's broken and how to fix it.
```

### Prompt 5: Performance Investigation
```
The system seems slow. Analyze:
1. Database latency from diagnostics
2. Recent error patterns in logs
3. Number of open tickets and their states
4. Event log size

Identify bottlenecks and suggest optimizations.
```

### Prompt 6: Audit Data Access
```
Review all AI assistant access to the system in the last 24 hours:
1. Get logs with event_type containing "ai_"
2. Filter by date: since=2025-10-01T00:00:00Z
3. Summarize what was accessed and by whom

This is for POPIA compliance auditing.
```

## 🔄 Multi-Step Troubleshooting Example

### User Reports: "Lift emergency SMS received but contacts didn't get WhatsApp"

**Step 1: AI starts with diagnostics**
```bash
curl -H "X-AI-Token: ..." /api/troubleshoot/diagnostics
```
✅ System is healthy, database connected

**Step 2: Find recent tickets**
```bash
curl -H "X-AI-Token: ..." /api/troubleshoot/tickets?status=open&limit=10
```
✅ Found ticket #789 created 5 minutes ago

**Step 3: Get ticket details**
```bash
curl -H "X-AI-Token: ..." /api/troubleshoot/tickets/789
```
🔍 Ticket shows lift_id=15, but no contacts listed!

**Step 4: Check lift configuration**
```bash
curl -H "X-AI-Token: ..." /api/troubleshoot/lifts/15
```
❌ Lift has 0 contacts linked!

**Step 5: Review messages**
```bash
curl -H "X-AI-Token: ..." /api/troubleshoot/messages?ticket_id=789
```
✅ Confirms no outbound messages sent

**Step 6: Check event logs**
```bash
curl -H "X-AI-Token: ..." /api/troubleshoot/logs?ticket_id=789
```
📝 Shows "no_contacts" event logged

**AI Conclusion:**
```
Root cause: Lift #15 (MSISDN: 27821234567) has no contacts configured.

Action required:
1. Use admin interface to add contacts to lift #15
2. Link existing contacts or create new ones
3. Test by triggering another emergency

This is a configuration issue, not a technical failure.
```

## 🎓 Teaching Cursor AI About Your System

Create a prompt file that explains your system architecture:

```markdown
# Woosh Lifts System Architecture for AI Assistant

## Flow Overview
1. Lift sends SMS to system → POST /sms/direct or /sms/inbound
2. System creates ticket in database
3. System sends WhatsApp template to all linked contacts
4. Contact clicks button → POST /webhooks/whatsapp
5. System updates ticket and sends confirmation

## Key Tables
- lifts: Lift inventory with MSISDN
- contacts: Contact directory with WhatsApp numbers
- lift_contacts: Many-to-many relationship
- tickets: Emergency tickets with status tracking
- ticket_messages: Message tracking with wa_id
- event_log: Comprehensive audit trail

## Button Click Tracking
- Each outbound message gets a wa_id from WhatsApp
- wa_id stored in ticket_messages table
- Button clicks include context.id (original message wa_id)
- System matches context.id to ticket via ticket_messages

## Ticket States
- open: Active emergency, awaiting response
- open + button_clicked='entrapment_awaiting_confirmation': Awaiting final confirmation
- closed: Emergency resolved

## Common Issues
1. No contacts linked to lift → no_contacts event
2. Template send fails → wa_template_fail event
3. Button click no match → button_click_contact_not_found event
4. Missing wa_id → button tracking fails

## Troubleshooting Priority
1. Always check diagnostics first
2. Then check ticket details
3. Then check messages (wa_id is critical)
4. Then check event logs
5. Finally check lift/contact configuration
```

## 🔒 Security Best Practices

When using Cursor AI with production data:

1. **Never expose tokens in code commits**
   - Store token in environment variable
   - Reference it in scripts, don't hardcode

2. **Review audit logs regularly**
   ```bash
   GET /api/troubleshoot/logs?event_type=ai_api_access&since=2025-10-01
   ```

3. **Use read-only token only**
   - AI assistant cannot modify data
   - Use ADMIN_TOKEN only when writes needed

4. **Respect rate limits**
   - 30 requests/minute is enough for troubleshooting
   - Implement caching if needed

5. **POPIA Compliance**
   - All AI access is logged
   - Personal data visible (names, phone numbers)
   - Audit trail available for compliance

## 📊 Monitoring AI Usage

Track AI assistant effectiveness:

```sql
-- Get AI access summary
SELECT 
  DATE(created_at) as date,
  COUNT(*) as access_count,
  COUNT(DISTINCT jsonb_extract_path_text(metadata::jsonb, 'path')) as unique_endpoints
FROM event_log
WHERE event_type = 'ai_api_access'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Most accessed endpoints
SELECT 
  jsonb_extract_path_text(metadata::jsonb, 'path') as endpoint,
  COUNT(*) as access_count
FROM event_log
WHERE event_type = 'ai_api_access'
GROUP BY endpoint
ORDER BY access_count DESC
LIMIT 10;

-- Rate limit violations
SELECT 
  DATE(created_at) as date,
  COUNT(*) as violations
FROM event_log
WHERE event_type = 'ai_rate_limit_exceeded'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

## 🚀 Advanced Use Cases

### Use Case 1: Automated Health Checks
Create a Cursor AI command that runs every hour:
```
Check system health and alert if:
- Database latency > 500ms
- Open tickets > 10
- Failed messages in last hour > 5
```

### Use Case 2: Ticket Aging Report
```
List all tickets open for > 24 hours with no response:
1. Get tickets with status=open
2. Filter by created_at < 24 hours ago
3. Check if button_clicked is null
4. Report with lift names and ticket references
```

### Use Case 3: Contact Response Analysis
```
For each contact, show:
- Total emergencies responded to
- Average response time (button click delay)
- Most common button choice
Use contacts endpoint + response_history
```

## 🎉 Success Metrics

You'll know the AI troubleshooting is working well when:

- ✅ Issues diagnosed in < 2 minutes
- ✅ Root cause identified without human intervention
- ✅ Audit trail shows appropriate access patterns
- ✅ No rate limit violations
- ✅ Complete visibility into system state

---

**Happy troubleshooting with Cursor AI!** 🤖

