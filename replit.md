# Woosh Lifts - SMS and WhatsApp Messaging Service

## Overview

Woosh Lifts is a messaging service designed to manage lift maintenance communications via SMS and WhatsApp. The system tracks lift locations, tenant contacts, and message history while integrating with external messaging providers (SMS Portal and Woosh Bridge for WhatsApp). It's optimized for deployment on Replit with support for free PostgreSQL database providers like Neon, Supabase, or Railway.

## User Preferences

Preferred communication style: Simple, everyday language.

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

**Authentication Strategy**:
- Admin routes protected by token-based authentication (`X-Admin-Token` or `Authorization: Bearer`)
- Admin token configured via `ADMIN_TOKEN` environment variable
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

**Query Patterns**:
- Cursor-based pagination for message history (base64 encoded cursors with last_id and last_ts)
- Auto-resolution of lifts by MSISDN (creates if not found)
- Transaction support via `withTxn` helper for atomic operations

### External Dependencies

**WhatsApp Messaging - Woosh Bridge**:
- Base URL: `https://wa.woosh.ai` (configurable via `BRIDGE_BASE_URL`)
- Authentication: API key via `X-Api-Key` header
- WhatsApp Business Number: +27 69 023 2755 (Growthpoint)
- Template-based messaging using `growthpoint_lift_emergency` template (configurable)
- Follow-up template: `growthpoint_entrapment_confirmed`
- Webhook callbacks for interactive button responses
- Button click payload structure: `entry[0].changes[0].value.messages[0].interactive.button_reply.id`

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
1. Woosh Bridge webhook → `/webhooks/whatsapp`
2. Parse button click from nested JSON structure
3. Extract button ID and user identifier
4. Process business logic based on button action

**Outbound Messaging**:
1. Admin/system triggers send request
2. Route to appropriate service (SMS Portal or Woosh Bridge)
3. Template-based formatting for WhatsApp
4. Plain text for SMS
5. Error handling with retry logic (30-second timeout)