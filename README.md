# Woosh Lifts - Replit Edition

A simplified version of the Woosh Lifts SMS and WhatsApp messaging service, optimized for Replit deployment.

## 🚀 Quick Start

### 1. Fork this Repository
Click the "Fork" button to create your own copy of this repository.

### 2. Create a New Replit Project
1. Go to [Replit](https://replit.com)
2. Click "Create Repl"
3. Choose "Import from GitHub"
4. Paste your forked repository URL
5. Click "Import"

### 3. Set Up Database (Choose One Option)

#### Option A: Neon (Recommended - Free PostgreSQL)
1. Go to [Neon](https://neon.tech)
2. Create a free account
3. Create a new database
4. Copy the connection string

#### Option B: Supabase (Free PostgreSQL)
1. Go to [Supabase](https://supabase.com)
2. Create a new project
3. Go to Settings > Database
4. Copy the connection string

#### Option C: Railway (Free PostgreSQL)
1. Go to [Railway](https://railway.app)
2. Create a new PostgreSQL service
3. Copy the connection string

### 4. Configure Environment Variables

In your Replit project:
1. Go to the "Secrets" tab (lock icon in the sidebar)
2. Add the following secrets:

```
DATABASE_URL=postgresql://username:password@host:port/database
BRIDGE_API_KEY=your_whatsapp_bridge_api_key
BRIDGE_TEMPLATE_NAME=growthpoint_testv1
BRIDGE_TEMPLATE_LANG=en
SMSPORTAL_HMAC_SECRET=your_hmac_secret
```

### 5. Run the Application
Click the "Run" button in Replit. The application will:
- Install dependencies automatically
- Start the server on port 8080
- Display the public URL

## 📋 Available Endpoints

### Health & Status
- `GET /` - Root endpoint (returns "woosh-lifts: ok")
- `GET /healthz` - Health check
- `GET /__debug` - Debug information
- `GET /admin/status` - Comprehensive system status

### SMS & Messaging
- `POST /sms/direct` - Direct SMS processing
- `POST /sms/inbound` - Inbound SMS webhook
- `POST /sms/plain` - Simple SMS endpoint
- `POST /send` - Send messages

### Admin
- `POST /admin/ping-bridge` - Test WhatsApp bridge
- `POST /admin/registry/reload` - Reload registry
- `GET /api/inbound/latest` - Get latest inbound message

## 🗄️ Database Setup

The application expects these tables (create them manually or use a migration tool):

```sql
-- Core tables
CREATE TABLE lifts (
    id SERIAL PRIMARY KEY,
    msisdn VARCHAR(20) UNIQUE NOT NULL,
    site_name VARCHAR(255),
    building VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contacts (
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

CREATE TABLE lift_contacts (
    lift_id INTEGER REFERENCES lifts(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    relation VARCHAR(32) DEFAULT 'tenant',
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (lift_id, contact_id)
);

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    lift_id INTEGER REFERENCES lifts(id),
    msisdn VARCHAR(20),
    direction VARCHAR(20) DEFAULT 'inbound',
    type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'received',
    body TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50),
    lift_id INTEGER REFERENCES lifts(id),
    contact_id UUID REFERENCES contacts(id),
    data JSONB,
    ts TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE consents (
    id SERIAL PRIMARY KEY,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    channel VARCHAR(20),
    status VARCHAR(20),
    source VARCHAR(255),
    ts TIMESTAMPTZ DEFAULT now(),
    UNIQUE(contact_id, channel)
);
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `BRIDGE_API_KEY` | WhatsApp bridge API key | Required |
| `BRIDGE_BASE_URL` | WhatsApp bridge base URL | `https://wa.woosh.ai` |
| `BRIDGE_TEMPLATE_NAME` | Template name for messages | `growthpoint_testv1` |
| `BRIDGE_TEMPLATE_LANG` | Template language | `en` |
| `SMSPORTAL_HMAC_SECRET` | HMAC secret for SMS verification | Required |
| `PORT` | Server port | `8080` |
| `ENV` | Environment (dev/prod) | `dev` |

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check your `DATABASE_URL` in Secrets
   - Ensure your database is accessible from Replit
   - Verify database tables exist

2. **WhatsApp Bridge Errors**
   - Verify `BRIDGE_API_KEY` is correct
   - Check `BRIDGE_BASE_URL` is accessible
   - Ensure template name exists in your bridge account

3. **Port Issues**
   - Replit automatically exposes port 8080
   - Check the console for the public URL
   - Ensure no firewall blocks the connection

### Logs
- All logs are written to the Replit console
- Use `console.log()` statements for debugging
- Check the browser developer tools for client-side errors

## 🔄 Differences from Cloud Run Version

This Replit version has been simplified:
- ✅ Removed Google Cloud Pub/Sub dependencies
- ✅ Simplified database connection (standard PostgreSQL)
- ✅ Removed Cloud SQL specific configurations
- ✅ Direct message processing (no message queuing)
- ✅ Standard Express.js startup (no migration runner)
- ✅ Replit-optimized configuration

## 📞 Support

If you encounter issues:
1. Check the Replit console logs
2. Verify all environment variables are set
3. Test endpoints individually
4. Ensure database tables exist

## 🎯 Next Steps

1. Set up your database provider
2. Configure environment variables
3. Test the health endpoints
4. Set up your SMS/WhatsApp integrations
5. Deploy to production if needed

Happy coding! 🚀
