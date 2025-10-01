// Contact Performance Analysis Routes
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAiAuth, enforceReadOnly, aiRateLimit } = require('../mw/ai-auth');

// Apply authentication and rate limiting
router.use(requireAiAuth);
router.use(aiRateLimit);
router.use(enforceReadOnly);

// Get contact response performance
router.get('/performance', async (req, res) => {
  try {
    const { since, lift_id } = req.query;
    
    // Build date filter
    const dateFilter = since ? `AND t.created_at >= $1` : `AND t.created_at > NOW() - INTERVAL '30 days'`;
    const params = since ? [since] : [];
    
    // Build lift filter
    let liftFilter = '';
    if (lift_id) {
      liftFilter = params.length > 0 ? `AND lc.lift_id = $2` : `AND lc.lift_id = $1`;
      params.push(parseInt(lift_id));
    }
    
    const result = await query(`
      WITH contact_tickets AS (
        SELECT 
          c.id as contact_id,
          c.display_name,
          c.primary_msisdn,
          c.role,
          COUNT(DISTINCT t.id) as total_assigned_tickets,
          COUNT(DISTINCT t.id) FILTER (WHERE t.responded_by = c.id) as tickets_responded,
          COUNT(DISTINCT t.id) FILTER (WHERE t.responded_by = c.id AND t.status = 'closed') as tickets_closed_by_contact,
          AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at))) FILTER (WHERE t.responded_by = c.id) as avg_response_time_seconds,
          MAX(t.resolved_at) FILTER (WHERE t.responded_by = c.id) as last_response_at,
          MIN(t.created_at) FILTER (WHERE t.responded_by = c.id) as first_response_at,
          COUNT(DISTINCT lc.lift_id) as lifts_assigned
        FROM contacts c
        JOIN lift_contacts lc ON c.id = lc.contact_id
        JOIN tickets t ON t.lift_id = lc.lift_id
        WHERE 1=1 ${dateFilter} ${liftFilter}
        GROUP BY c.id, c.display_name, c.primary_msisdn, c.role
      )
      SELECT 
        *,
        CASE 
          WHEN total_assigned_tickets > 0 
          THEN ROUND((tickets_responded::numeric / total_assigned_tickets::numeric) * 100, 2)
          ELSE 0 
        END as response_rate_percent
      FROM contact_tickets
      ORDER BY response_rate_percent DESC, total_assigned_tickets DESC
    `, params);
    
    res.json({
      ok: true,
      data: result.rows,
      period: since || 'last_30_days',
      lift_filter: lift_id || 'all',
      count: result.rows.length
    });
  } catch (error) {
    console.error('[contact-performance/performance] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve contact performance data' 
      } 
    });
  }
});

// Get detailed contact response history
router.get('/:contactId/history', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { limit = 50 } = req.query;
    
    // Get contact info
    const contactResult = await query(
      'SELECT * FROM contacts WHERE id = $1',
      [contactId]
    );
    
    if (contactResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Contact not found'
        }
      });
    }
    
    const contact = contactResult.rows[0];
    
    // Get all tickets this contact could have responded to
    const ticketsResult = await query(`
      SELECT 
        t.*,
        l.site_name,
        l.building,
        l.msisdn as lift_msisdn,
        COALESCE(l.site_name || ' - ' || l.building, l.building, 'Lift ' || l.id) as lift_name,
        CASE 
          WHEN t.responded_by = $1 THEN true
          ELSE false
        END as responded,
        EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) as response_time_seconds
      FROM tickets t
      JOIN lifts l ON t.lift_id = l.id
      JOIN lift_contacts lc ON l.id = lc.lift_id
      WHERE lc.contact_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2
    `, [contactId, parseInt(limit)]);
    
    // Calculate stats
    const tickets = ticketsResult.rows;
    const totalAssigned = tickets.length;
    const responded = tickets.filter(t => t.responded).length;
    const responseRate = totalAssigned > 0 ? ((responded / totalAssigned) * 100).toFixed(2) : 0;
    
    const responseTimes = tickets
      .filter(t => t.responded)
      .map(t => parseFloat(t.response_time_seconds))
      .filter(t => t && t > 0);
    
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;
    
    const fastestResponse = responseTimes.length > 0 ? Math.min(...responseTimes) : null;
    const slowestResponse = responseTimes.length > 0 ? Math.max(...responseTimes) : null;
    
    res.json({
      ok: true,
      data: {
        contact: contact,
        statistics: {
          total_assigned: totalAssigned,
          responded: responded,
          no_response: totalAssigned - responded,
          response_rate_percent: responseRate,
          avg_response_time_seconds: avgResponseTime,
          fastest_response_seconds: fastestResponse,
          slowest_response_seconds: slowestResponse
        },
        tickets: tickets
      }
    });
  } catch (error) {
    console.error('[contact-performance/:contactId/history] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve contact history' 
      } 
    });
  }
});

// Get contact leaderboard (top performers)
router.get('/leaderboard', async (req, res) => {
  try {
    const { since, top = 10 } = req.query;
    
    const dateFilter = since ? `AND t.created_at >= $1` : `AND t.created_at > NOW() - INTERVAL '30 days'`;
    const params = since ? [since] : [];
    params.push(parseInt(top));
    const limitParam = params.length;
    
    const result = await query(`
      SELECT 
        c.id,
        c.display_name,
        c.primary_msisdn,
        c.role,
        COUNT(DISTINCT t.id) FILTER (WHERE t.responded_by = c.id) as responses,
        AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at))) FILTER (WHERE t.responded_by = c.id) as avg_response_time_seconds,
        MIN(EXTRACT(EPOCH FROM (t.updated_at - t.created_at))) FILTER (WHERE t.responded_by = c.id) as fastest_response_seconds,
        MAX(t.resolved_at) FILTER (WHERE t.responded_by = c.id) as last_response_at
      FROM contacts c
      LEFT JOIN tickets t ON t.responded_by = c.id
      WHERE 1=1 ${dateFilter}
      GROUP BY c.id, c.display_name, c.primary_msisdn, c.role
      HAVING COUNT(DISTINCT t.id) FILTER (WHERE t.responded_by = c.id) > 0
      ORDER BY responses DESC, avg_response_time_seconds ASC
      LIMIT $${limitParam}
    `, params);
    
    res.json({
      ok: true,
      data: result.rows,
      period: since || 'last_30_days',
      top: parseInt(top)
    });
  } catch (error) {
    console.error('[contact-performance/leaderboard] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve leaderboard' 
      } 
    });
  }
});

// Get non-responders (contacts who haven't responded to tickets)
router.get('/non-responders', async (req, res) => {
  try {
    const { since, min_tickets = 3 } = req.query;
    
    const dateFilter = since ? `AND t.created_at >= $1` : `AND t.created_at > NOW() - INTERVAL '30 days'`;
    const params = since ? [since] : [];
    
    const result = await query(`
      SELECT 
        c.id,
        c.display_name,
        c.primary_msisdn,
        c.role,
        COUNT(DISTINCT t.id) as tickets_assigned,
        COUNT(DISTINCT t.id) FILTER (WHERE t.responded_by = c.id) as tickets_responded,
        COUNT(DISTINCT lc.lift_id) as lifts_assigned,
        MAX(t.created_at) as last_ticket_received
      FROM contacts c
      JOIN lift_contacts lc ON c.id = lc.contact_id
      JOIN tickets t ON t.lift_id = lc.lift_id
      WHERE 1=1 ${dateFilter}
      GROUP BY c.id, c.display_name, c.primary_msisdn, c.role
      HAVING 
        COUNT(DISTINCT t.id) >= ${parseInt(min_tickets)}
        AND COUNT(DISTINCT t.id) FILTER (WHERE t.responded_by = c.id) = 0
      ORDER BY COUNT(DISTINCT t.id) DESC
    `, params);
    
    res.json({
      ok: true,
      data: result.rows,
      period: since || 'last_30_days',
      min_tickets: parseInt(min_tickets),
      count: result.rows.length
    });
  } catch (error) {
    console.error('[contact-performance/non-responders] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: { 
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve non-responders' 
      } 
    });
  }
});

module.exports = router;

