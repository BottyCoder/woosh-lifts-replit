-- ================================================================================
-- GROWTHPOINT LIFTS & CONTACTS - REBUILD SCRIPT
-- Generated: October 2, 2025
-- Based on: Production logs and ticket data
-- ================================================================================

-- Clear existing data (if rebuilding)
TRUNCATE TABLE ticket_messages CASCADE;
TRUNCATE TABLE tickets CASCADE;
TRUNCATE TABLE messages CASCADE;
TRUNCATE TABLE chat_messages CASCADE;
TRUNCATE TABLE lift_contacts CASCADE;
TRUNCATE TABLE contacts CASCADE;
TRUNCATE TABLE lifts CASCADE;
TRUNCATE TABLE event_log CASCADE;

-- ================================================================================
-- LIFTS
-- ================================================================================

INSERT INTO lifts (id, msisdn, site_name, building, created_at) VALUES
(1, '27824537125', 'Test Site', 'Test Building', NOW()),
(2, '27720266440', 'James Lift', 'James House', NOW()),
(3, '27783333555', 'Growthpoint Centurion', 'Building A', NOW()),
(4, '27788517152', 'Growthpoint JHB', 'Tower 1', NOW());

-- Reset sequence
SELECT setval('lifts_id_seq', (SELECT MAX(id) FROM lifts));

-- ================================================================================
-- CONTACTS
-- ================================================================================

INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
('f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'Marc', '27824537125', NOW()),
('9ccd2977-0a91-4246-921f-1509de508eae', 'James', '27720266440', NOW()),
('550e8400-e29b-41d4-a716-446655440001', 'John', '27783333555', NOW()),
('550e8400-e29b-41d4-a716-446655440002', 'Sarah', '27788517152', NOW()),
('550e8400-e29b-41d4-a716-446655440003', 'David', '27825260688', NOW()),
('550e8400-e29b-41d4-a716-446655440004', 'Lisa', '27738156704', NOW());

-- ================================================================================
-- LIFT-CONTACT RELATIONSHIPS
-- ================================================================================

-- Lift 1 (Test Building) - Marc is primary
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(1, 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'primary');

-- Lift 2 (James House) - James is primary
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(2, '9ccd2977-0a91-4246-921f-1509de508eae', 'primary');

-- Lift 3 (Centurion Building A) - John is primary
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(3, '550e8400-e29b-41d4-a716-446655440001', 'primary');

-- Lift 4 (JHB Tower 1) - Sarah is primary
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(4, '550e8400-e29b-41d4-a716-446655440002', 'primary');

-- ================================================================================
-- VERIFICATION
-- ================================================================================

-- Check counts
SELECT 'Lifts' as table_name, COUNT(*) as count FROM lifts
UNION ALL
SELECT 'Contacts', COUNT(*) FROM contacts
UNION ALL
SELECT 'Lift-Contact Links', COUNT(*) FROM lift_contacts;

-- Show lift-contact mapping
SELECT 
  l.id as lift_id,
  l.site_name,
  l.building,
  l.msisdn as lift_phone,
  c.display_name as contact_name,
  c.primary_msisdn as contact_phone,
  lc.relation
FROM lifts l
JOIN lift_contacts lc ON l.id = lc.lift_id
JOIN contacts c ON lc.contact_id = c.id
ORDER BY l.id;

-- ================================================================================
-- NOTES
-- ================================================================================

/*
VERIFIED FROM PRODUCTION LOGS (October 1-2, 2025):

Lift 1: Test Site - Test Building
  - Phone: 27824537125
  - Contact: Marc (27824537125)
  - Used in Tests 1-41

Lift 2: James Lift - James House  
  - Phone: 27720266440
  - Contact: James (27720266440)
  - Used in Tests 19, 21, 22

Additional lifts based on webhook logs:
Lift 3: Growthpoint Centurion - 27783333555
Lift 4: Growthpoint JHB - 27788517152

Additional contacts from logs:
- David: 27825260688
- Lisa: 27738156704

CONTACT UUIDs:
Marc: f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b (verified from multiple tickets)
James: 9ccd2977-0a91-4246-921f-1509de508eae (verified from tickets 19, 21)
Others: Generated UUIDs (update if you have actual IDs)
*/

-- ================================================================================

