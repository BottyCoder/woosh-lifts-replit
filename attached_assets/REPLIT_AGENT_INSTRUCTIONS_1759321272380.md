# Instructions for Replit Agent

## Task: Integrate AI Assistant Troubleshooting Endpoints

### Context
New files have been created for AI assistant troubleshooting:
- `src/mw/ai-auth.js` - Authentication middleware
- `src/routes/troubleshoot.js` - Read-only API endpoints

These need to be integrated into `src/server.js`.

---

## Required Changes to `src/server.js`

### Change 1: Add Import Statement

**Location:** After line 16

**Current code at line 16:**
```javascript
const adminRoutes = require('./routes/admin');
```

**Add this new line after it:**
```javascript
const troubleshootRoutes = require('./routes/troubleshoot');
```

---

### Change 2: Mount Troubleshoot Routes

**Location:** After line 88

**Current code at line 88:**
```javascript
app.use('/admin', adminRoutes);
```

**Add these lines after it:**
```javascript

// Mount AI troubleshooting routes (read-only with authentication)
app.use('/api/troubleshoot', troubleshootRoutes);
```

---

### Change 3: Secure the /api/inbound/latest Endpoint

**Location:** Around line 1109-1112

**Find and replace this code:**
```javascript
// Latest inbound reader
app.get("/api/inbound/latest", (_req, res) => {
  if (!global.LAST_INBOUND) return res.status(404).json({ error: "no_inbound_yet" });
  res.json(global.LAST_INBOUND);
});
```

**Replace with:**
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

---

## Summary

Three simple changes to `src/server.js`:
1. Import the troubleshoot routes module
2. Mount the routes at `/api/troubleshoot`
3. Add authentication to the existing `/api/inbound/latest` endpoint

These changes enable read-only AI assistant access for troubleshooting while maintaining security.

