# Woosh Lifts - SMS and WhatsApp Messaging Service

## Overview

Woosh Lifts is a messaging service designed to manage lift maintenance communications via SMS and WhatsApp. The system tracks lift locations, tenant contacts, and message history while integrating with external messaging providers (SMS Portal and Woosh Bridge for WhatsApp). It's optimized for deployment on Replit with support for free PostgreSQL database providers like Neon, Supabase, or Railway.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

**October 1, 2025**:
- Fixed admin UI dashboard navigation bugs (navigateTo function now handles event parameter)
- Fixed authentication for system status endpoint (now uses authFetch with X-Admin-Token)
- Fixed Active Tickets metric calculation (fetches all tickets with limit=1000, filters for open + entrapment_awaiting_confirmation)
- Implemented Messages Today count with proper endpoint structure handling
- **Fixed reminder count bug**: System was showing 4/3 reminders due to off-by-one error in auto-close logic. Now correctly caps at 3/3 when auto-closing tickets after 3 unanswered reminders (applies to both initial alerts and entrapment confirmation flows)
- **Added Linked Contacts visibility**: Lifts table now shows "Linked Contacts" column displaying all contacts linked to each lift (comma-separated names)
- **Fixed Recent Tickets display**: Dashboard now shows 5 most recent tickets regardless of status (sorted by creation date), not just open tickets
- **Implemented full message tracking and observability**: Every SMS and WhatsApp message now logged to messages table for complete audit trail:
  - Inbound SMS: Logged with direction='in', type='sms', status='received'
  - Outbound templates: Initial alerts and reminders logged with wa_id for status tracking
  - Outbound interactive: Entrapment follow-ups and reminders logged with wa_id
  - Outbound text: Confirmation and escalation messages logged via notifyAllContactsForLift
  - All messages include ticket_id in meta for ticket correlation
  - Messages table has wa_id column (indexed) for delivery/read receipt tracking via status webhook
- **Implemented AI Troubleshooting API** (`/api/troubleshoot`): Comprehensive read-only debugging endpoints with dual-token authentication (AI_ASSISTANT_TOKEN and ADMIN_TOKEN):
  - `/messages` endpoint with filtering by lift_id, ticket_id, direction, type, status, timestamp - returns full message history with wa_id, delivery status, and lift_name for complete communication audit trail
  - `/tickets`, `/lifts`, `/contacts` endpoints with pagination, search, and detailed views
  - `/diagnostics` endpoint for system health, counts, environment check, and recent activity
  - `/logs` and `/event-types` endpoints for event log analysis
  - Read-only enforcement via middleware (blocks POST/PUT/DELETE for AI tokens)
  - Rate limiting: 30 requests/minute for AI assistants
  - All AI access logged to event_log table for audit trail
  - Secured `/api/inbound/latest` endpoint with same authentication

## System Architecture

### Backend Architecture

**Framework**: Express.js (Node.js) with CommonJS modules
- RESTful API design with route-based organization
- Middleware chain for logging, authentication, and error handling
- JSON-based request/response format

**Core Routing Structure**:
- `/admin/*` - Administrative operations (lift/contact management, message history)
- `/sms/*` - Inbound SMS webhook handlers  
- `/send` - Outbound message sending
- `/webhooks/whatsapp` - WhatsApp event callbacks from Woosh Bridge
- `/api/status/webhook` - WhatsApp message delivery/read receipt status updates
- `/api/troubleshoot/*` - AI assistant troubleshooting API (read-only, authenticated)

**Authentication Strategy**:
- Admin routes protected by token-based authentication (`X-Admin-Token` or `Authorization: Bearer`)
- Admin token configured via `ADMIN_TOKEN` environment variable
- AI troubleshooting routes accept both `AI_ASSISTANT_TOKEN` and `ADMIN_TOKEN` via `X-AI-Token`, `X-Admin-Token`, or `Authorization: Bearer` headers
- AI tokens enforce read-only access (GET only) with rate limiting (30 req/min)
- All AI access logged to event_log for audit trail
- SMS webhooks use HMAC signature verification (`SMSPORTAL_HMAC_SECRET`)
- WhatsApp webhooks currently use IP allowlisting (no header authentication from Woosh Bridge)

**Error Handling Architecture**:
- Centralized error handler middleware maps errors to appropriate HTTP status codes
- PostgreSQL constraint violations automatically translated to REST semantics (409 for duplicates, 404 for foreign key violations)
- Development vs production logging (stack traces only in dev mode)
- Request/response logging middleware for observability

### Data Storage

**Database**: PostgreSQL (provider-agnostic)
- Connection via standard `DATABASE_URL` connection string
- SSL support for production environments
- Connection pooling via `pg` library

**Schema Design**:

1. **lifts** - Core entity tracking individual lift units
   - Primary key: `id` (serial)
   - Unique identifier: `msisdn` (phone number)
   - Metadata: site_name, building, notes
   - Timestamps: created_at, updated_at

2. **contacts** - Tenant and building contact information
   - Primary key: `id` (UUID)
   - Unique constraints: primary_msisdn, email
   - Fields: display_name, role

3. **lift_contacts** - Many-to-many relationship table
   - Links lifts to contacts with relationship type (default: 'tenant')
   - Cascade delete on both foreign keys

4. **messages** - Message audit log
   - Foreign key to lifts
   - Direction tracking (inbound/outbound)
   - Message type and status fields
   - JSONB meta field for flexible metadata storage

5. **tickets** - Emergency ticket tracking
   - Primary key: `id` (serial)
   - Foreign key to lifts
   - Fields: sms_id, status, button_clicked, responded_by, reminder_count
   - Timestamps: created_at, updated_at, resolved_at, last_reminder_at
   - `ticket_reference` (VARCHAR 100): Human-readable ref like "BUILDING-TKT123"
   - `message_id` (VARCHAR 255): Backward compatibility, stores first wa_id

6. **ticket_messages** - WhatsApp message tracking for precise button click matching
   - Primary key: `id` (serial)
   - Foreign key to tickets
   - Foreign key to contacts
   - `message_id` (VARCHAR 255, UNIQUE): The wa_id from Woosh Bridge response
   - `message_kind` (VARCHAR 50): Type of message (initial, reminder, entrapment_followup, entrapment_reminder)
   - Status tracking: `delivered_at`, `read_at`, `current_status` (sent/delivered/read/failed)
   - Error tracking: `error_code`, `error_message`
   - Created timestamp
   - **Purpose**: Enables precise matching of button clicks to correct ticket even with multiple simultaneous emergencies, with full delivery/read receipt tracking

7. **messages** - General message audit log with delivery status
   - Primary key: `id` (serial)
   - Foreign key to lifts
   - Direction, type, status fields
   - `wa_id` (VARCHAR 255): WhatsApp message ID for status tracking
   - Status tracking: `delivered_at`, `read_at`, `current_status` (sent/delivered/read/failed)
   - Error tracking: `error_code`, `error_message`
   - JSONB meta field for flexible metadata storage

**Query Patterns**:
- Cursor-based pagination for message history (base64 encoded cursors with last_id and last_ts)
- Auto-resolution of lifts by MSISDN (creates if not found)
- Transaction support via `withTxn` helper for atomic operations

### External Dependencies

**WhatsApp Messaging - Woosh Bridge**:
- Base URL: `https://wa.woosh.ai` (configurable via `BRIDGE_BASE_URL`)
- API Endpoints:
  - `/v1/send` - Template and text messages (auth via `x-tenant-key`)
  - `/api/messages/send` - Interactive messages (auth via `X-Api-Key`)
- Authentication: Tenant key via headers (BRIDGE_API_KEY env var)
- WhatsApp Business Number: +27 69 023 2755 (Growthpoint)
- Template-based messaging using `growthpoint_lift_emergency_v2` template with 1 parameter (lift location)
- Template language: `en` (must match exact language code in WhatsApp Manager)
- Follow-up template: `growthpoint_entrapment_confirmed` (YES button only, no NO button)
- Webhook callbacks for interactive button responses and message status updates
- Button click payload structure: `entry[0].changes[0].value.messages[0].interactive.button_reply.id`
- **Status Updates**: Delivery and read receipts via `/api/status/webhook`
  - Status types: sent, delivered, read, failed
  - Includes timestamps and error details
  - Matched to messages via `wa_id` field

**SMS Messaging - SMS Portal**:
- Inbound webhook at `/sms/plain`
- HMAC signature verification for webhook authentication
- Flexible payload parsing (supports both `phone`/`message` and `msisdn`/`text` formats)

**Database Providers** (choose one):
- **Neon** (recommended): Free PostgreSQL with connection string format
- **Supabase**: Free tier PostgreSQL 
- **Railway**: Free PostgreSQL service

All providers use standard PostgreSQL connection strings, making the system database-provider agnostic.

**Environment Configuration**:
```
DATABASE_URL - PostgreSQL connection string
BRIDGE_API_KEY - WhatsApp Bridge API authentication
BRIDGE_TEMPLATE_NAME - WhatsApp message template identifier
BRIDGE_TEMPLATE_LANG - Template language code (defaults to 'en')
SMSPORTAL_HMAC_SECRET - SMS webhook signature verification
ADMIN_TOKEN - Admin API authentication token
```

### Message Flow Architecture

**Inbound SMS**:
1. SMS Portal webhook → `/sms/plain`
2. HMAC verification (if configured)
3. Normalize payload (`phone`/`message` or `msisdn`/`text`)
4. Store in global buffer for debugging
5. Log and acknowledge

**Inbound WhatsApp** (Interactive Buttons):
1. Woosh Bridge webhook → `/webhooks/whatsapp` (authenticated via WEBHOOK_AUTH_TOKEN)
2. Parse button click from nested JSON structure
3. Extract `context.id` (original message ID) from webhook payload
4. Look up ticket via `ticket_messages` table WHERE `message_id = context.id`
5. Fallback: If not found, search recent open tickets for contact (within 6 hours)
6. Process business logic based on button action (Test/Maintenance/Entrapment/YES)
7. **Supports multiple simultaneous emergencies** via precise context.id matching

**Outbound Messaging**:
1. Admin/system triggers send request
2. Route to appropriate service (SMS Portal or Woosh Bridge)
3. Template-based formatting for WhatsApp (includes ticket reference like [BUILDING-TKT123])
4. Capture `wa_id` from Woosh Bridge response
5. Store `wa_id` in `ticket_messages` table with ticket_id, contact_id, and message_kind
6. **Every message tracked** for precise button click matching (initial alerts, reminders, follow-ups)
7. Error handling with retry logic (30-second timeout)

**Initial Alert Reminder System**:
1. SMS received → Ticket created → WhatsApp template sent with 3 buttons (Test/Maintenance/Entrapment)
2. Timer starts immediately upon ticket creation
3. If no button clicked within 1 minute (testing interval, will be 5 minutes in production):
   - Send reminder 1/3: Template resent to all contacts with all 3 buttons
   - Wait 1 minute, send reminder 2/3
   - Wait 1 minute, send reminder 3/3
   - After 3rd reminder with no response, auto-close ticket with critical escalation alert
   - Send to all contacts: "⚠️ CRITICAL ALERT: Emergency ticket auto-closed... NO RESPONSE received after 3 reminders. IMMEDIATE ACTION REQUIRED."
4. If any button clicked: Timer stops, ticket proceeds to appropriate flow

**Entrapment Flow with Auto-Reminders**:
1. User clicks "Entrapment" button on initial emergency alert (opens 24-hour WhatsApp session)
2. System sends interactive session message with YES button only: "Has the service provider been notified of the entrapment at [Location]?"
3. Ticket marked as `entrapment_awaiting_confirmation`, reminder timer starts automatically
4. If YES clicked: Send "We have received a "Yes" response. The service provider has been notified and this ticket has been closed." to all contacts, close ticket
5. If no response within 1 minute (testing interval, will be 5 minutes in production):
   - Send reminder 1/3 with interactive YES button: "⚠️ REMINDER 1/3: Please confirm that the service provider has been notified..."
   - Wait 1 minute, send reminder 2/3 with YES button
   - Wait 1 minute, send reminder 3/3 with YES button
   - After 3rd reminder with no response, auto-close ticket with note "Auto-closed: Service provider notification not confirmed after 3 reminders"
   - Send alert to all contacts: "⚠️ ALERT: Ticket auto-closed... Please follow up immediately."
6. Background job runs every 60 seconds to check for pending reminders (both initial alerts and entrapment confirmations)
7. All interactive messages use `/api/messages/send` endpoint within the 24-hour session window