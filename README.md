# Jambonz WebSocket Service

Node.js WebSocket service for handling Jambonz LLM calls with proper session context for multi-tenant routing.

## Why WebSocket vs HTTP Webhooks?

Jambonz's `toolHook` for LLM verbs sends minimal payloads (`tool_call_id`, `name`, `args`) without `call_sid` or `account_sid`. With HTTP webhooks, this makes multi-tenant routing impossible.

The WebSocket SDK provides **session objects** that maintain full call context throughout the call lifecycle, solving the routing problem.

## Architecture

- **WebSocket Server**: Maintains persistent connections with Jambonz
- **Session Context**: Each call has a session object with `call_sid`, `account_sid`, and custom `locals`
- **Tool Handlers**: Receive both session and event data, enabling proper client lookups

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key
- `ULTRAVOX_API_KEY` - Ultravox API key
- `PORT` - Server port (default: 3000)

### 3. Run Locally

```bash
npm run dev  # Development with nodemon
npm start    # Production
```

### 4. Configure Jambonz

Update your Jambonz application to use WebSocket instead of HTTP webhook:

- **Application Type**: WebSocket
- **WebSocket URL**: `wss://your-domain.com/ws` (or `ws://localhost:3000/ws` for local)

## Deployment

### Railway

1. Create new project from this directory
2. Add environment variables
3. Deploy

The service will be available at: `wss://your-service.railway.app/ws`

### Health Check

```bash
curl http://localhost:3000/health
```

## Project Structure

```
jambonz-ws-service/
├── index.js                 # Main server and WebSocket setup
├── handlers/
│   ├── incoming-call.js     # Initial call handling
│   ├── tool-call.js         # Tool invocation handling
│   ├── llm-complete.js      # LLM session completion
│   └── call-status.js       # Call status updates
├── models/
│   ├── Client.js            # Client/tenant lookups
│   └── CallLog.js           # Call logging
└── lib/
    ├── supabase.js          # Supabase client
    └── business-hours.js    # Business hours logic
```

## Key Features

✅ **Multi-tenant routing** - Session context provides account_sid for client lookup
✅ **Tool calls work** - Transfer, collect info, hang up all have full context
✅ **Business hours** - Automatic after-hours handling
✅ **Call logging** - Complete call tracking in Supabase
✅ **Graceful shutdown** - Proper cleanup on SIGTERM/SIGINT

## Tool Handlers

### transferToOnCall
Transfers urgent calls to human agents with whisper announcements.

### collectCallerInfo
Collects caller name, callback number, and concern description.

### hangUp
Politely ends the call after handling.

## Troubleshooting

### WebSocket Connection Issues
- Verify Jambonz application configured for WebSocket mode
- Check that WebSocket URL is accessible (wss:// for production)
- Review logs for connection attempts

### Tool Calls Not Working
- Confirm session has client in locals (`session.locals.client`)
- Check that client has transfer numbers configured
- Review tool call logs for errors

### Database Issues
- Verify Supabase credentials are correct
- Check that tables exist (clients, call_logs)
- Review Supabase logs for query errors

## Migration from HTTP Webhooks

If migrating from the Flask HTTP webhook service:

1. Keep Flask service running for non-LLM endpoints
2. Deploy this WebSocket service
3. Update Jambonz application to use WebSocket URL
4. Test with a few calls before full cutover
5. Monitor logs to ensure tool calls work correctly

The Flask service can still handle:
- Ultravox webhooks
- Voicemail processing
- Any other HTTP-only integrations
