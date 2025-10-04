const { Pool } = require('pg');

// Database connection setup (same as src/db.js)
function buildDbConfig() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    return {
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };
  }
  
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

async function createSampleTickets() {
  const config = buildDbConfig();
  const pool = new Pool(config);
  
  try {
    console.log('Creating sample tickets for live chat testing...');
    
    // Check if we have existing lifts and contacts
    const liftsResult = await pool.query('SELECT COUNT(*) FROM lifts');
    const contactsResult = await pool.query('SELECT COUNT(*) FROM contacts');
    
    console.log(`Found ${liftsResult.rows[0].count} lifts and ${contactsResult.rows[0].count} contacts`);
    
    if (liftsResult.rows[0].count === '0' || contactsResult.rows[0].count === '0') {
      console.log('No lifts or contacts found. Creating basic test data first...');
      
      // Create basic test data
      await pool.query(`
        INSERT INTO lifts (id, msisdn, site_name, building, created_at) VALUES
        (1, '27824537125', 'Test Site', 'Test Building', NOW()),
        (2, '27720266440', 'James Lift', 'James House', NOW()),
        (3, '27783333555', 'Growthpoint Centurion', 'Building A', NOW()),
        (4, '27788517152', 'Growthpoint JHB', 'Tower 1', NOW())
        ON CONFLICT (msisdn) DO NOTHING
      `);
      
      await pool.query(`
        INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
        ('f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'Marc', '27824537125', NOW()),
        ('9ccd2977-0a91-4246-921f-1509de508eae', 'James', '27720266440', NOW()),
        ('550e8400-e29b-41d4-a716-446655440001', 'John', '27783333555', NOW()),
        ('550e8400-e29b-41d4-a716-446655440002', 'Sarah', '27788517152', NOW())
        ON CONFLICT (id) DO NOTHING
      `);
      
      await pool.query(`
        INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
        (1, 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'primary'),
        (2, '9ccd2977-0a91-4246-921f-1509de508eae', 'primary'),
        (3, '550e8400-e29b-41d4-a716-446655440001', 'primary'),
        (4, '550e8400-e29b-41d4-a716-446655440002', 'primary')
        ON CONFLICT DO NOTHING
      `);
      
      console.log('Basic test data created');
    }
    
    // Create sample tickets
    const ticketsResult = await pool.query(`
      INSERT INTO tickets (lift_id, sms_id, status, button_clicked, responded_by, created_at, updated_at, agent_requested, notes) VALUES
      (1, 'test_sms_001', 'open', 'emergency', 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', NOW() - INTERVAL '10 minutes', NOW(), true, 'Test emergency at Test Building - Marc is responding'),
      (2, 'test_sms_002', 'open', 'maintenance', '9ccd2977-0a91-4246-921f-1509de508eae', NOW() - INTERVAL '30 minutes', NOW(), false, 'Maintenance request at James House'),
      (3, 'test_sms_003', 'closed', 'emergency', '550e8400-e29b-41d4-a716-446655440001', NOW() - INTERVAL '2 hours', NOW(), false, 'Emergency resolved at Growthpoint Centurion'),
      (4, 'test_sms_004', 'open', 'emergency', '550e8400-e29b-41d4-a716-446655440002', NOW() - INTERVAL '45 minutes', NOW(), false, 'Lift stuck at Growthpoint JHB Tower 1')
      RETURNING id
    `);
    
    console.log(`Created ${ticketsResult.rows.length} sample tickets`);
    
    // Add chat messages
    await pool.query(`
      INSERT INTO chat_messages (ticket_id, from_number, to_number, message, direction, agent_name, read_by_agent, created_at) VALUES
      (1, '27824537125', 'system', 'Emergency button pressed in Test Building', 'inbound', NULL, false, NOW() - INTERVAL '10 minutes'),
      (1, 'system', '27824537125', 'Emergency response team has been notified. Help is on the way.', 'outbound', 'System', true, NOW() - INTERVAL '9 minutes'),
      (1, '27824537125', 'system', 'I am stuck in the lift, please hurry!', 'inbound', NULL, false, NOW() - INTERVAL '5 minutes'),
      (2, '27720266440', 'system', 'Lift needs maintenance check', 'inbound', NULL, false, NOW() - INTERVAL '30 minutes'),
      (2, 'system', '27720266440', 'Maintenance request received. Technician will visit within 24 hours.', 'outbound', 'System', true, NOW() - INTERVAL '29 minutes'),
      (3, '27783333555', 'system', 'Emergency in Building A', 'inbound', NULL, true, NOW() - INTERVAL '2 hours'),
      (3, 'system', '27783333555', 'Emergency response dispatched', 'outbound', 'System', true, NOW() - INTERVAL '1 hour 55 minutes'),
      (3, '27783333555', 'system', 'Thank you, I am safe now', 'inbound', NULL, true, NOW() - INTERVAL '1 hour 50 minutes'),
      (3, 'system', '27783333555', 'Ticket closed. Stay safe!', 'outbound', 'System', true, NOW() - INTERVAL '1 hour 45 minutes'),
      (4, '27788517152', 'system', 'Lift stuck between floors', 'inbound', NULL, false, NOW() - INTERVAL '45 minutes'),
      (4, 'system', '27788517152', 'Emergency response team notified', 'outbound', 'System', true, NOW() - INTERVAL '44 minutes')
    `);
    
    console.log('Added sample chat messages');
    
    // Update resolved_at for closed ticket
    await pool.query(`
      UPDATE tickets SET resolved_at = NOW() - INTERVAL '1 hour 45 minutes' WHERE id = 3
    `);
    
    // Show summary
    const summary = await pool.query(`
      SELECT 
        t.id,
        t.status,
        l.site_name || ' - ' || l.building as location,
        c.display_name as contact_name,
        t.agent_requested,
        t.created_at,
        (SELECT COUNT(*) FROM chat_messages WHERE ticket_id = t.id) as message_count
      FROM tickets t
      LEFT JOIN lifts l ON t.lift_id = l.id
      LEFT JOIN contacts c ON t.responded_by = c.id
      ORDER BY t.agent_requested DESC, t.created_at DESC
    `);
    
    console.log('\nSample tickets created:');
    summary.rows.forEach(row => {
      console.log(`- Ticket ${row.id}: ${row.status} | ${row.location} | ${row.contact_name} | ${row.message_count} messages`);
    });
    
    console.log('\n✅ Sample data created successfully!');
    console.log('Now refresh the live chat page to see the tickets.');
    
  } catch (error) {
    console.error('Error creating sample data:', error);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  createSampleTickets();
}

module.exports = { createSampleTickets };
