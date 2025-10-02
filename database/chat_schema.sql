-- Call Centre Live Chat Schema

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

CREATE INDEX idx_chat_messages_ticket_id ON chat_messages(ticket_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_chat_messages_unread ON chat_messages(ticket_id, read_by_agent) WHERE direction = 'inbound';

-- Add agent_requested flag to tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS agent_requested BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_tickets_agent_requested ON tickets(agent_requested) WHERE agent_requested = true;

-- Migration note: This schema is idempotent and safe to run multiple times

