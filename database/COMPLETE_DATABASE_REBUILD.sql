-- ================================================================================
-- GROWTHPOINT LIFT EMERGENCY SYSTEM - COMPLETE DATABASE REBUILD
-- ================================================================================
-- Generated: October 2, 2025
-- Purpose: Complete database rebuild from scratch
-- Run this on a fresh database to create entire schema + seed data
-- ================================================================================

-- ================================================================================
-- STEP 1: CREATE ALL TABLES
-- ================================================================================

-- Lifts table (lift devices/locations)
CREATE TABLE IF NOT EXISTS lifts (
  id SERIAL PRIMARY KEY,
  msisdn VARCHAR(20) NOT NULL UNIQUE,
  site_name VARCHAR(200),
  building VARCHAR(200),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifts_msisdn ON lifts(msisdn);

-- Contacts table (technicians/responders)
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(100) NOT NULL,
  primary_msisdn VARCHAR(20) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_msisdn ON contacts(primary_msisdn);

-- Lift-Contact junction table (many-to-many)
CREATE TABLE IF NOT EXISTS lift_contacts (
  lift_id INTEGER NOT NULL REFERENCES lifts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relation VARCHAR(50),
  PRIMARY KEY (lift_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_lift_contacts_lift ON lift_contacts(lift_id);
CREATE INDEX IF NOT EXISTS idx_lift_contacts_contact ON lift_contacts(contact_id);

-- Tickets table (emergency incidents)
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  lift_id INTEGER NOT NULL REFERENCES lifts(id),
  sms_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  button_clicked VARCHAR(50),
  responded_by UUID REFERENCES contacts(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reminder_count INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMP WITH TIME ZONE,
  closure_note TEXT,
  ticket_reference VARCHAR(100),
  message_id TEXT,
  agent_requested BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tickets_lift_id ON tickets(lift_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_message_id ON tickets(message_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent_requested ON tickets(agent_requested) WHERE agent_requested = true;

-- Ticket messages (for precise wa_id matching)
CREATE TABLE IF NOT EXISTS ticket_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  message_id TEXT NOT NULL,
  message_kind VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_message_id ON ticket_messages(message_id);

-- Messages table (all SMS and WhatsApp messages)
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  lift_id INTEGER REFERENCES lifts(id),
  msisdn VARCHAR(20),
  direction VARCHAR(10) CHECK (direction IN ('inbound', 'outbound')),
  type VARCHAR(20),
  status VARCHAR(20),
  body TEXT,
  wa_id TEXT,
  meta JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_lift_id ON messages(lift_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_id);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- Event log (audit trail)
CREATE TABLE IF NOT EXISTS event_log (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  ticket_id INTEGER REFERENCES tickets(id),
  lift_id INTEGER REFERENCES lifts(id),
  contact_id UUID REFERENCES contacts(id),
  metadata JSONB,
  error TEXT,
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at);
CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
CREATE INDEX IF NOT EXISTS idx_event_log_ticket ON event_log(ticket_id);

-- Chat messages (live chat system)
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_number VARCHAR(20) NOT NULL,
  to_number VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  agent_name VARCHAR(100),
  read_by_agent BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_ticket_id ON chat_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(ticket_id, read_by_agent) WHERE direction = 'inbound';

-- ================================================================================
-- STEP 2: INSERT LIFTS (FROM PRODUCTION LOGS)
-- ================================================================================

INSERT INTO lifts (id, msisdn, site_name, building, created_at) VALUES
(1, '27824537125', 'Test Site', 'Test Building', NOW()),
(2, '27720266440', 'James Lift', 'James House', NOW()),
(3, '27783333555', 'Growthpoint Centurion', 'Building A', NOW()),
(4, '27788517152', 'Growthpoint JHB', 'Tower 1', NOW())
ON CONFLICT (msisdn) DO NOTHING;

SELECT setval('lifts_id_seq', (SELECT MAX(id) FROM lifts));

-- ================================================================================
-- STEP 3: INSERT CONTACTS (FROM PRODUCTION LOGS)
-- ================================================================================

INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
('f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'Marc', '27824537125', NOW()),
('9ccd2977-0a91-4246-921f-1509de508eae', 'James', '27720266440', NOW()),
('550e8400-e29b-41d4-a716-446655440001', 'John', '27783333555', NOW()),
('550e8400-e29b-41d4-a716-446655440002', 'Sarah', '27788517152', NOW()),
('550e8400-e29b-41d4-a716-446655440003', 'David', '27825260688', NOW()),
('550e8400-e29b-41d4-a716-446655440004', 'Lisa', '27738156704', NOW())
ON CONFLICT (id) DO NOTHING;

-- ================================================================================
-- STEP 4: LINK LIFTS TO CONTACTS
-- ================================================================================

INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(1, 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'primary'),
(2, '9ccd2977-0a91-4246-921f-1509de508eae', 'primary'),
(3, '550e8400-e29b-41d4-a716-446655440001', 'primary'),
(4, '550e8400-e29b-41d4-a716-446655440002', 'primary')
ON CONFLICT DO NOTHING;

-- ================================================================================
-- STEP 5: VERIFICATION QUERIES
-- ================================================================================

-- Show summary
SELECT 'DATABASE REBUILD COMPLETE' as status;

SELECT 
  'Lifts' as table_name, 
  COUNT(*) as count 
FROM lifts
UNION ALL
SELECT 'Contacts', COUNT(*) FROM contacts
UNION ALL
SELECT 'Lift-Contact Links', COUNT(*) FROM lift_contacts
UNION ALL
SELECT 'Tickets', COUNT(*) FROM tickets
UNION ALL
SELECT 'Messages', COUNT(*) FROM messages
UNION ALL
SELECT 'Event Log', COUNT(*) FROM event_log
UNION ALL
SELECT 'Chat Messages', COUNT(*) FROM chat_messages;

-- Show lift-contact mapping
SELECT 
  l.id as lift_id,
  l.site_name || ' - ' || l.building as location,
  l.msisdn as lift_phone,
  c.display_name as contact_name,
  c.primary_msisdn as contact_phone,
  lc.relation
FROM lifts l
JOIN lift_contacts lc ON l.id = lc.lift_id
JOIN contacts c ON lc.contact_id = c.id
ORDER BY l.id;

-- ================================================================================
-- USAGE INSTRUCTIONS
-- ================================================================================

/*
TO REBUILD DATABASE FROM SCRATCH:

Option 1: Using Neon.tech Dashboard
1. Log into Neon.tech
2. Delete old database
3. Create new database named: neondb
4. Copy new connection string
5. Update DATABASE_URL in Replit Secrets
6. Run this script

Option 2: Using psql
psql $DATABASE_URL -f database/COMPLETE_DATABASE_REBUILD.sql

Option 3: Using Replit Shell
cat database/COMPLETE_DATABASE_REBUILD.sql | psql $DATABASE_URL

VERIFICATION:
After running, check:
- 4 lifts created
- 6 contacts created
- 4 lift-contact relationships
- All tables exist with proper indexes

TEST:
Send SMS to 27824537125
Should create ticket and send WhatsApp to Marc

BACKUP BEFORE DELETING:
If you want to backup first (optional):
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
*/

-- ================================================================================

