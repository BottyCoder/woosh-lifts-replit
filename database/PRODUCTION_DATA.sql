-- ================================================================================
-- GROWTHPOINT PRODUCTION DATA - THE PLACE BUILDING + TEST LIFTS
-- ================================================================================
-- Source: Lift details reroutes spreadsheet + Testing configuration
-- Date: October 2, 2025
-- ================================================================================

-- Clear existing data
TRUNCATE TABLE ticket_messages CASCADE;
TRUNCATE TABLE tickets CASCADE;
TRUNCATE TABLE messages CASCADE;
TRUNCATE TABLE chat_messages CASCADE;
TRUNCATE TABLE lift_contacts CASCADE;
TRUNCATE TABLE contacts CASCADE;
TRUNCATE TABLE lifts CASCADE;
TRUNCATE TABLE event_log CASCADE;

-- ================================================================================
-- INSERT LIFTS
-- ================================================================================

-- Production lifts (THE PLACE building)
INSERT INTO lifts (id, msisdn, site_name, building, created_at) VALUES
(1, '27607043779', 'Growthpoint', 'THE PLACE - Lift 7', NOW()),
(2, '27660667427', 'Growthpoint', 'THE PLACE - Lift 8', NOW());

-- Test/Development lifts (keep for testing)
INSERT INTO lifts (id, msisdn, site_name, building, created_at) VALUES
(3, '27824537125', 'Test Site', 'Test Building', NOW()),
(4, '27720266440', 'James Lift', 'James House', NOW());

SELECT setval('lifts_id_seq', (SELECT MAX(id) FROM lifts));

-- ================================================================================
-- INSERT CONTACTS
-- ================================================================================

-- Production contacts (THE PLACE technicians)
INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'Michael', '27820956584', NOW()),
('550e8400-e29b-41d4-a716-446655440002', 'Kaylin', '27813912338', NOW()),
('550e8400-e29b-41d4-a716-446655440003', 'Phinda', '27682653965', NOW());

-- Test/Development contacts (keep for testing)
INSERT INTO contacts (id, display_name, primary_msisdn, created_at) VALUES
('f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'Marc', '27824537125', NOW()),
('9ccd2977-0a91-4246-921f-1509de508eae', 'James', '27720266440', NOW());

-- ================================================================================
-- LINK LIFTS TO CONTACTS
-- ================================================================================

-- Lift 7 (THE PLACE) - All three production contacts
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(1, '550e8400-e29b-41d4-a716-446655440001', 'primary'),
(1, '550e8400-e29b-41d4-a716-446655440002', 'secondary'),
(1, '550e8400-e29b-41d4-a716-446655440003', 'tertiary');

-- Lift 8 (THE PLACE) - All three production contacts
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(2, '550e8400-e29b-41d4-a716-446655440001', 'primary'),
(2, '550e8400-e29b-41d4-a716-446655440002', 'secondary'),
(2, '550e8400-e29b-41d4-a716-446655440003', 'tertiary');

-- Test Building - Marc only
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(3, 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', 'primary');

-- James House - James only
INSERT INTO lift_contacts (lift_id, contact_id, relation) VALUES
(4, '9ccd2977-0a91-4246-921f-1509de508eae', 'primary');

-- ================================================================================
-- VERIFICATION
-- ================================================================================

SELECT 'PRODUCTION DATA LOADED' as status;

SELECT 
  'Lifts' as table_name, 
  COUNT(*) as count 
FROM lifts
UNION ALL
SELECT 'Contacts', COUNT(*) FROM contacts
UNION ALL
SELECT 'Lift-Contact Links', COUNT(*) FROM lift_contacts;

-- Show mapping
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
ORDER BY l.id, lc.relation;

-- ================================================================================

