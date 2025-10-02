# AI Assistant Troubleshooting Setup Instructions

## Overview
This document provides instructions for the Replit agent to integrate AI assistant troubleshooting capabilities into the system. The AI assistant will have **read-only** access to system data for debugging and monitoring purposes.

## ✅ What Has Been Created

I've created the following new files that don't interfere with existing system files:

1. **`src/mw/ai-auth.js`** - Authentication middleware for AI assistant access
   - Token validation (AI_ASSISTANT_TOKEN or ADMIN_TOKEN)
   - Read-only enforcement
   - Rate limiting (30 requests/minute)
   - Audit logging of all AI access

2. **`src/routes/troubleshoot.js`** - Read-only troubleshooting endpoints
   - GET /api/troubleshoot/tickets - List tickets with filters
   - GET /api/troubleshoot/tickets/:id - Get ticket details
   - GET /api/troubleshoot/tickets/:id/events - Get ticket event timeline
   - GET /api/troubleshoot/lifts - List lifts with pagination
   - GET /api/troubleshoot/lifts/:id - Get lift details
   - GET /api/troubleshoot/contacts - List contacts
   - GET /api/troubleshoot/contacts/:id - Get contact details
   - GET /api/troubleshoot/logs - System event logs with filtering
   - GET /api/troubleshoot/diagnostics - System health and diagnostics
   - GET /api/troubleshoot/event-types - Available event types

3. **`env.example`** - Updated with new environment variables

## 🔧 Required Changes to Server.js

Please ask the Replit agent to make these changes to `src/server.js`:

### 1. Add Import for Troubleshoot Routes

**Location:** After line 16 (after `const adminRoutes = require('./routes/admin');`)

**Add:**
```javascript
const troubleshootRoutes = require('./routes/troubleshoot');
```

### 2. Mount Troubleshoot Routes

**Location:** After line 88 (after `app.use('/admin', adminRoutes);`)

**Add:**
```javascript
// Mount AI troubleshooting routes (read-only with authentication)
app.use('/api/troubleshoot', troubleshootRoutes);
```

### 3. Secure the /api/inbound/latest Endpoint

**Location:** Replace the existing `/api/inbound/latest` endpoint (around line 1109-1112)

**Replace this:**
```javascript
// Latest inbound reader
app.get("/api/inbound/latest", (_req, res) => {
  if (!global.LAST_INBOUND) return res.status(404).json({ error: "no_inbound_yet" });
  res.json(global.LAST_INBOUND);
});
```

**With this:**
```javascript
// Latest inbound reader (secured with AI auth)
app.get("/api/inbound/latest", (req, res) => {
  // Require authentication
  const token = req.header('X-AI-Token') || 
                req.header('X-Admin-Token') ||
                req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  
  const aiToken = process.env.AI_ASSISTANT_TOKEN;
  const adminToken = process.env.ADMIN_TOKEN;
  
  if (!token || (token !== aiToken && token !== adminToken)) {
    return res.status(401).json({ 
      ok: false, 
      error: 'Authentication required. Provide X-AI-Token or X-Admin-Token header.' 
    });
  }
  
  if (!global.LAST_INBOUND) {
    return res.status(404).json({ 
      ok: false, 
      error: "no_inbound_yet",
      message: "No inbound SMS has been received yet" 
    });
  }
  
  res.json({
    ok: true,
    data: global.LAST_INBOUND
  });
});
```

## 🔐 Environment Variables Setup

Add these to your Replit Secrets:

```bash
AI_ASSISTANT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ3b29zaC5haSIsInN1YiI6Im1hcmNAdm9vc2guYWkiLCJpYXQiOjE3MNTkyNDc4ODAsInNjb3BlIjoiYWRtaW4ifQ._q0Gv0aK1l1sXkJYx2Tb3Zk2r8V5yQYhQyqP8w1Z0b4
```

**Also recommended to add (if not already set):**
```bash
ADMIN_TOKEN=<generate-a-strong-random-token>
WEBHOOK_AUTH_TOKEN=<generate-a-strong-random-token>
```

To generate secure tokens:
```bash
openssl rand -base64 32
```

## 📋 Testing the API Endpoints

Once integrated, test with:

### 1. Test Authentication
```bash
curl -H "X-AI-Token: YOUR_TOKEN" https://your-replit-url.repl.co/api/troubleshoot/diagnostics
```

### 2. Get System Diagnostics
```bash
curl -H "X-AI-Token: YOUR_TOKEN" https://your-replit-url.repl.co/api/troubleshoot/diagnostics
```

### 3. List Recent Tickets
```bash
curl -H "X-AI-Token: YOUR_TOKEN" "https://your-replit-url.repl.co/api/troubleshoot/tickets?status=open&limit=10"
```

### 4. Get Specific Ticket Details
```bash
curl -H "X-AI-Token: YOUR_TOKEN" https://your-replit-url.repl.co/api/troubleshoot/tickets/123
```

### 5. Get Event Logs
```bash
curl -H "X-AI-Token: YOUR_TOKEN" "https://your-replit-url.repl.co/api/troubleshoot/logs?limit=50"
```

### 6. List Lifts
```bash
curl -H "X-AI-Token: YOUR_TOKEN" https://your-replit-url.repl.co/api/troubleshoot/lifts
```

### 7. Test Read-Only Enforcement (should fail)
```bash
curl -X POST -H "X-AI-Token: YOUR_TOKEN" https://your-replit-url.repl.co/api/troubleshoot/tickets
# Expected: 403 Forbidden - "AI assistant has read-only access"
```

## 🔒 Security Features

The AI troubleshooting system includes:

1. **Token Authentication** - Requires valid AI_ASSISTANT_TOKEN or ADMIN_TOKEN
2. **Read-Only Enforcement** - AI token can only make GET requests
3. **Rate Limiting** - 30 requests per minute for AI assistant
4. **Audit Logging** - All AI access logged to event_log table
5. **No Credential Exposure** - API keys/tokens are masked in responses
6. **POPIA Compliance** - All data access audited and logged

## 📊 Available Endpoints Summary

| Endpoint | Description | Parameters |
|----------|-------------|------------|
| `GET /api/troubleshoot/diagnostics` | System health check | none |
| `GET /api/troubleshoot/tickets` | List tickets | status, lift_id, since, limit, offset |
| `GET /api/troubleshoot/tickets/:id` | Ticket details | none |
| `GET /api/troubleshoot/tickets/:id/events` | Ticket event timeline | limit |
| `GET /api/troubleshoot/lifts` | List lifts | search, limit, offset |
| `GET /api/troubleshoot/lifts/:id` | Lift details | none |
| `GET /api/troubleshoot/contacts` | List contacts | search, limit, offset |
| `GET /api/troubleshoot/contacts/:id` | Contact details | none |
| `GET /api/troubleshoot/logs` | Event logs | event_type, ticket_id, lift_id, contact_id, since, limit, offset |
| `GET /api/troubleshoot/event-types` | Available event types | none |
| `GET /api/inbound/latest` | Latest inbound SMS | none |

## 🎯 What AI Assistant Can Do

✅ **Can do:**
- View all tickets and their status
- Check lift configurations and contact assignments
- View event logs and message history
- Monitor system health and diagnostics
- Troubleshoot issues by examining data
- Check recent activity and error patterns

❌ **Cannot do:**
- Create, modify, or delete tickets
- Change lift or contact data
- Send messages
- Modify system configuration
- Execute write operations of any kind

## 📝 Audit Trail

All AI assistant access is logged to the `event_log` table with:
- Event type: `ai_api_access`
- Timestamp
- Endpoint accessed
- Query parameters
- Source IP address

Failed authentication attempts are logged as: `ai_auth_failed`

Rate limit violations are logged as: `ai_rate_limit_exceeded`

## 🔍 Troubleshooting

### AI Token Not Working
- Verify `AI_ASSISTANT_TOKEN` is set in Replit Secrets
- Check token is sent in `X-AI-Token` header
- Ensure no extra spaces or newlines in token

### Rate Limit Exceeded
- AI assistant limited to 30 requests/minute
- Use ADMIN_TOKEN instead for unlimited access
- Wait 60 seconds and try again

### 503 Service Unavailable
- Neither AI_ASSISTANT_TOKEN nor ADMIN_TOKEN is configured
- Add at least one token to Replit Secrets

## 📞 Integration Complete Checklist

- [ ] Replit agent updates `src/server.js` with the 3 changes above
- [ ] `AI_ASSISTANT_TOKEN` added to Replit Secrets
- [ ] Server restarted to pick up new environment variable
- [ ] Test diagnostics endpoint returns success
- [ ] Verify read-only enforcement (POST request fails with 403)
- [ ] Check audit logging in event_log table

## 💡 Usage Tips for AI Assistant

1. **Start with diagnostics**: Always check `/api/troubleshoot/diagnostics` first
2. **Use filters**: Most endpoints support filtering to narrow results
3. **Check event logs**: Use `/api/troubleshoot/logs` to see recent activity
4. **Ticket timeline**: Use `/api/troubleshoot/tickets/:id/events` for detailed ticket history
5. **Search functionality**: Use the `search` parameter on lifts/contacts endpoints

## 🎉 Benefits

- Safe troubleshooting without risk of data modification
- Complete system visibility for AI assistant
- Audit trail of all AI interactions
- Rate limiting prevents abuse
- POPIA compliant data access logging

