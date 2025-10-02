# Woosh Lifts - SMS and WhatsApp Messaging Service

## Overview
Woosh Lifts is a messaging service designed to manage lift maintenance communications via SMS and WhatsApp. It tracks lift locations, tenant contacts, and message history, integrating with external messaging providers (SMS Portal and Woosh Bridge for WhatsApp). The system supports deployment on Replit and is compatible with free PostgreSQL database providers. Key capabilities include:
- Real-time WhatsApp chat interface for call centre agents to assist technicians.
- Comprehensive message tracking and auditing for compliance.
- AI Troubleshooting API for read-only debugging and system diagnostics.
- Automated alert and reminder systems for emergency tickets and entrapment confirmations.

The project aims to streamline communication for lift maintenance, ensuring timely responses and comprehensive record-keeping, with a focus on auditability and efficient incident management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture
The system is built on **Express.js (Node.js)** with a RESTful API design. It utilizes middleware for logging, authentication, and error handling, with JSON-based request/response formats.

**Core Routing**:
- `/admin/*`: Administrative operations.
- `/sms/*`: Inbound SMS webhooks.
- `/send`: Outbound message sending.
- `/webhooks/whatsapp`: WhatsApp event callbacks.
- `/api/status/webhook`: WhatsApp message status updates.
- `/api/troubleshoot/*`: AI assistant troubleshooting API (read-only, authenticated).
- `/api/chat`, `/agent-chat.html`: Call Centre Live Chat system.

**Authentication**:
- Admin routes use token-based authentication (`X-Admin-Token`).
- AI troubleshooting routes accept `AI_ASSISTANT_TOKEN` or `ADMIN_TOKEN` for read-only access with rate limiting.
- SMS webhooks use HMAC signature verification.
- All AI access is logged for auditing.

**Error Handling**: Centralized middleware handles errors, mapping them to appropriate HTTP status codes and providing different logging verbosity for development and production.

### Data Storage
**Database**: PostgreSQL, designed to be provider-agnostic.

**Schema Design**:
- **lifts**: Tracks individual lift units (`msisdn`, `site_name`, `building`, `notes`).
- **contacts**: Stores tenant and building contact information (`display_name`, `role`).
- **lift_contacts**: Many-to-many relationship linking lifts and contacts.
- **messages**: General message audit log with delivery status (`direction`, `type`, `status`, `wa_id`, `meta` JSONB).
- **tickets**: Tracks emergency tickets (`status`, `responded_by`, `reminder_count`, `ticket_reference`, `message_id`).
- **ticket_messages**: WhatsApp message tracking for precise button click matching (`wa_id`, `message_kind`, `current_status`).
- **chat_messages**: Stores inbound/outbound chat messages for the Call Centre Live Chat.

**Query Patterns**: Includes cursor-based pagination and auto-resolution of lifts by MSISDN.

### Feature Specifications
- **Call Centre Live Chat**: Real-time WhatsApp chat interface for agents, including a dedicated `chat_messages` table, `agent_requested` flag on tickets, and an agent web UI (`/agent-chat.html`).
- **AI Troubleshooting API**: Provides read-only access to messages, tickets, lifts, contacts, diagnostics, and logs for AI assistants, secured with dual-token authentication and rate limiting.
- **Automated Reminder System**: Manages initial alert reminders for unanswered emergency messages (3 reminders before auto-closing) and entrapment confirmation reminders.
- **Full Message Tracking**: Every SMS and WhatsApp message is logged to the `messages` table for a complete audit trail, including `wa_id` for delivery/read receipt tracking.

### System Design Choices
- **Message Flow Architecture**:
  - **Inbound SMS**: Processed via `/sms/plain` webhook with HMAC verification.
  - **Inbound WhatsApp**: Interactive button clicks from Woosh Bridge webhooks are parsed, matched to tickets using `context.id` via `ticket_messages` for precise handling of multiple simultaneous emergencies.
  - **Outbound Messaging**: Routes messages to SMS Portal or Woosh Bridge, capturing `wa_id` for tracking and storing detailed message status in `ticket_messages`.

## External Dependencies

- **WhatsApp Messaging - Woosh Bridge**:
  - Base URL: `https://wa.woosh.ai`
  - Used for sending template-based and interactive WhatsApp messages.
  - Authentication: Tenant key via `x-tenant-key` or `X-Api-Key` headers.
  - Webhook callbacks for interactive button responses and message status updates (delivery/read receipts).
  - Uses specific templates like `growthpoint_lift_emergency_v2` and `growthpoint_entrapment_confirmed`.

- **SMS Messaging - SMS Portal**:
  - Used for inbound SMS via a webhook at `/sms/plain`.
  - Employs HMAC signature verification for webhook authentication.

- **Database Providers (PostgreSQL)**:
  - **Neon** (recommended)
  - **Supabase**
  - **Railway**
  - All use standard PostgreSQL connection strings (`DATABASE_URL`).

- **Environment Configuration**:
  - `DATABASE_URL`
  - `BRIDGE_API_KEY`
  - `BRIDGE_TEMPLATE_NAME`
  - `BRIDGE_TEMPLATE_LANG`
  - `SMSPORTAL_HMAC_SECRET`
  - `ADMIN_TOKEN`