-- Woosh Lifts Complete Database Schema
-- Run this to set up a fresh database

-- Core tables
CREATE TABLE IF NOT EXISTS lifts (
    id SERIAL PRIMARY KEY,
    msisdn VARCHAR(20) UNIQUE NOT NULL,
    site_name VARCHAR(255),
    building VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(255),
    primary_msisdn VARCHAR(20),
    email VARCHAR(255),
    role VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(primary_msisdn),
    UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS lift_contacts (
    lift_id INTEGER REFERENCES lifts(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    relation VARCHAR(32) DEFAULT 'tenant',
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (lift_id, contact_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    lift_id INTEGER REFERENCES lifts(id),
    msisdn VARCHAR(20),
    direction VARCHAR(20) DEFAULT 'inbound',
    type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'received',
    body TEXT,
    meta JSONB,
    wa_id VARCHAR(255),
    current_status VARCHAR(50),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_id);
CREATE INDEX IF NOT EXISTS idx_messages_lift_id ON messages(lift_id);

CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    lift_id INTEGER NOT NULL REFERENCES lifts(id),
    sms_id VARCHAR(128) NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    button_clicked VARCHAR(50),
    responded_by UUID REFERENCES contacts(id),
    resolved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    reminder_count INTEGER DEFAULT 0,
    last_reminder_at TIMESTAMPTZ,
    closure_note TEXT,
    ticket_reference VARCHAR(100),
    message_id VARCHAR(255),
    agent_requested BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tickets_lift_id ON tickets(lift_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_sms_id ON tickets(sms_id);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id),
    message_id VARCHAR(255) UNIQUE,
    message_kind VARCHAR(50),
    current_status VARCHAR(50) DEFAULT 'sent',
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_message_id ON ticket_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS event_log (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    ticket_id INTEGER REFERENCES tickets(id),
    lift_id INTEGER REFERENCES lifts(id),
    contact_id UUID REFERENCES contacts(id),
    metadata JSONB,
    request_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at);
CREATE INDEX IF NOT EXISTS idx_event_log_ticket_id ON event_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_event_log_event_type ON event_log(event_type);

CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_number VARCHAR(50),
    to_number VARCHAR(50),
    message TEXT NOT NULL,
    direction VARCHAR(20) NOT NULL,
    agent_name VARCHAR(100),
    read_by_agent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_ticket_id ON chat_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_direction ON chat_messages(direction);

-- Legacy tables (if needed)
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50),
    lift_id INTEGER REFERENCES lifts(id),
    contact_id UUID REFERENCES contacts(id),
    data JSONB,
    ts TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consents (
    id SERIAL PRIMARY KEY,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    channel VARCHAR(20),
    status VARCHAR(20),
    source VARCHAR(255),
    ts TIMESTAMPTZ DEFAULT now(),
    UNIQUE(contact_id, channel)
);
