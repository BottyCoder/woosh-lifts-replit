-- ===============================================================================
-- CREATE SAMPLE TICKETS FOR LIVE CHAT TESTING
-- ===============================================================================
-- Purpose: Add test tickets to existing database for live chat interface testing
-- Date: January 2025
-- ===============================================================================

-- Create sample tickets using existing lifts and contacts
INSERT INTO tickets (lift_id, sms_id, status, button_clicked, responded_by, created_at, updated_at, agent_requested, notes) VALUES
-- Open ticket with agent requested (should appear first)
(1, 'test_sms_001', 'open', 'emergency', 'f2c41e5f-9a96-4a45-aa6a-a7d3f4fce95b', NOW() - INTERVAL '10 minutes', NOW(), true, 'Test emergency at Test Building - Marc is responding'),

-- Open ticket without agent requested
(2, 'test_sms_002', 'open', 'maintenance', '9ccd2977-0a91-4246-921f-1509de508eae', NOW() - INTERVAL '30 minutes', NOW(), false, 'Maintenance request at James House'),

-- Closed ticket (recently resolved)
(3, 'test_sms_003', 'closed', 'emergency', '550e8400-e29b-41d4-a716-446655440001', NOW() - INTERVAL '2 hours', NOW(), false, 'Emergency resolved at Growthpoint Centurion'),

-- Another open ticket
(4, 'test_sms_004', 'open', 'emergency', '550e8400-e29b-41d4-a716-446655440002', NOW() - INTERVAL '45 minutes', NOW(), false, 'Lift stuck at Growthpoint JHB Tower 1');

-- Add some chat messages to make it realistic
INSERT INTO chat_messages (ticket_id, from_number, to_number, message, direction, agent_name, read_by_agent, created_at) VALUES
-- Messages for ticket 1 (open with agent requested)
(1, '27824537125', 'system', 'Emergency button pressed in Test Building', 'inbound', NULL, false, NOW() - INTERVAL '10 minutes'),
(1, 'system', '27824537125', 'Emergency response team has been notified. Help is on the way.', 'outbound', 'System', true, NOW() - INTERVAL '9 minutes'),
(1, '27824537125', 'system', 'I am stuck in the lift, please hurry!', 'inbound', NULL, false, NOW() - INTERVAL '5 minutes'),

-- Messages for ticket 2 (open maintenance)
(2, '27720266440', 'system', 'Lift needs maintenance check', 'inbound', NULL, false, NOW() - INTERVAL '30 minutes'),
(2, 'system', '27720266440', 'Maintenance request received. Technician will visit within 24 hours.', 'outbound', 'System', true, NOW() - INTERVAL '29 minutes'),

-- Messages for ticket 3 (closed)
(3, '27783333555', 'system', 'Emergency in Building A', 'inbound', NULL, true, NOW() - INTERVAL '2 hours'),
(3, 'system', '27783333555', 'Emergency response dispatched', 'outbound', 'System', true, NOW() - INTERVAL '1 hour 55 minutes'),
(3, '27783333555', 'system', 'Thank you, I am safe now', 'inbound', NULL, true, NOW() - INTERVAL '1 hour 50 minutes'),
(3, 'system', '27783333555', 'Ticket closed. Stay safe!', 'outbound', 'System', true, NOW() - INTERVAL '1 hour 45 minutes'),

-- Messages for ticket 4 (open emergency)
(4, '27788517152', 'system', 'Lift stuck between floors', 'inbound', NULL, false, NOW() - INTERVAL '45 minutes'),
(4, 'system', '27788517152', 'Emergency response team notified', 'outbound', 'System', true, NOW() - INTERVAL '44 minutes');

-- Update resolved_at for closed ticket
UPDATE tickets SET resolved_at = NOW() - INTERVAL '1 hour 45 minutes' WHERE id = 3;

-- Show summary
SELECT 'SAMPLE TICKETS CREATED' as status;

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
ORDER BY t.agent_requested DESC, t.created_at DESC;
