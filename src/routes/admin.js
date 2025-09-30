const express = require('express');
const router = express.Router();
const { query, withTxn } = require('../db');
const { getPagination, paginateQuery } = require('../pagination');

// Authentication middleware for admin routes
function requireAdminAuth(req, res, next) {
  const token = req.header('X-Admin-Token') || req.header('Authorization')?.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_TOKEN;
  
  // If no admin token is configured, deny access
  if (!adminToken) {
    return res.status(503).json({ 
      ok: false, 
      error: { message: 'Admin access not configured' } 
    });
  }
  
  // Verify token
  if (!token || token !== adminToken) {
    return res.status(401).json({ 
      ok: false, 
      error: { message: 'Unauthorized - Invalid or missing admin token' } 
    });
  }
  
  next();
}

// Apply auth to all admin routes
router.use(requireAdminAuth);

// Resolve lift by MSISDN
router.get('/resolve/lift', async (req, res) => {
  try {
    const { msisdn } = req.query;
    
    if (!msisdn) {
      return res.status(400).json({ 
        ok: false, 
        error: { message: 'MSISDN is required' } 
      });
    }

    // Try to find existing lift
    let result = await query('SELECT * FROM lifts WHERE msisdn = $1', [msisdn]);
    
    if (result.rows.length === 0) {
      // Create new lift if not found
      result = await query(
        'INSERT INTO lifts (msisdn) VALUES ($1) RETURNING *',
        [msisdn]
      );
    }

    return res.json({
      ok: true,
      data: {
        lift: result.rows[0]
      }
    });
  } catch (error) {
    console.error('[admin/resolve/lift] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

// Create or update lift
router.post('/lifts', express.json(), async (req, res) => {
  try {
    const { msisdn, site_name, building, notes } = req.body;
    
    if (!msisdn) {
      return res.status(400).json({ 
        ok: false, 
        error: { message: 'MSISDN is required' } 
      });
    }

    const result = await query(
      `INSERT INTO lifts (msisdn, site_name, building, notes, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (msisdn) 
       DO UPDATE SET 
         site_name = EXCLUDED.site_name,
         building = EXCLUDED.building,
         notes = EXCLUDED.notes,
         updated_at = now()
       RETURNING *`,
      [msisdn, site_name, building, notes]
    );

    return res.json({
      ok: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[admin/lifts] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

// Get contacts for a lift
router.get('/lifts/:liftId/contacts', async (req, res) => {
  try {
    const { liftId } = req.params;

    const result = await query(
      `SELECT c.*, lc.relation
       FROM contacts c
       JOIN lift_contacts lc ON c.id = lc.contact_id
       WHERE lc.lift_id = $1
       ORDER BY c.display_name`,
      [liftId]
    );

    return res.json({
      ok: true,
      data: result.rows
    });
  } catch (error) {
    console.error('[admin/lifts/:liftId/contacts] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

// Create or update contact
router.post('/contacts', express.json(), async (req, res) => {
  try {
    const { display_name, primary_msisdn, email, role } = req.body;
    
    if (!display_name || !primary_msisdn) {
      return res.status(400).json({ 
        ok: false, 
        error: { message: 'Display name and MSISDN are required' } 
      });
    }

    const result = await query(
      `INSERT INTO contacts (display_name, primary_msisdn, email, role, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (primary_msisdn) 
       DO UPDATE SET 
         display_name = EXCLUDED.display_name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         updated_at = now()
       RETURNING *`,
      [display_name, primary_msisdn, email, role]
    );

    return res.json({
      ok: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('[admin/contacts] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: error.message || 'Internal server error' } 
    });
  }
});

// Link contact to lift
router.post('/lifts/:liftId/contacts', express.json(), async (req, res) => {
  try {
    const { liftId } = req.params;
    const { contact_id, relation } = req.body;
    
    if (!contact_id) {
      return res.status(400).json({ 
        ok: false, 
        error: { message: 'Contact ID is required' } 
      });
    }

    await query(
      `INSERT INTO lift_contacts (lift_id, contact_id, relation)
       VALUES ($1, $2, $3)
       ON CONFLICT (lift_id, contact_id) 
       DO UPDATE SET relation = EXCLUDED.relation`,
      [liftId, contact_id, relation || 'tenant']
    );

    return res.json({
      ok: true,
      data: { lift_id: liftId, contact_id, relation }
    });
  } catch (error) {
    console.error('[admin/lifts/:liftId/contacts] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

// Unlink contact from lift
router.delete('/lifts/:liftId/contacts/:contactId', async (req, res) => {
  try {
    const { liftId, contactId } = req.params;

    await query(
      'DELETE FROM lift_contacts WHERE lift_id = $1 AND contact_id = $2',
      [liftId, contactId]
    );

    return res.json({
      ok: true,
      data: { message: 'Contact unlinked successfully' }
    });
  } catch (error) {
    console.error('[admin/lifts/:liftId/contacts/:contactId] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

// Get messages for a lift
router.get('/messages', async (req, res) => {
  try {
    const { lift_id, limit = 50 } = req.query;
    
    if (!lift_id) {
      return res.status(400).json({ 
        ok: false, 
        error: { message: 'Lift ID is required' } 
      });
    }

    const result = await query(
      `SELECT id, lift_id, msisdn, direction, type, status, body, 
              created_at as ts, meta
       FROM messages
       WHERE lift_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [lift_id, parseInt(limit)]
    );

    return res.json({
      ok: true,
      data: {
        items: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('[admin/messages] error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: { message: 'Internal server error' } 
    });
  }
});

module.exports = router;
