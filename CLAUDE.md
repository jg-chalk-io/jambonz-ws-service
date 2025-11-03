# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

#DOCUMENTATION#
Do not create .md summary documents unless I ask you to.

<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Project Overview

Multi-tenant cloud PBX system routing calls through Jambonz to Ultravox AI agents with human transfer, business hours routing, voicemail, and billing tracking. Supports hundreds of clients on a single deployment.

**Call Flow:**
```
Phone → Twilio/SIP → Jambonz ⟷ WebSocket Service (Node.js)
                           ↓
                      Ultravox AI
                           ↓
                   Human Transfer / Voicemail
                           ↓
              Webhook Service (Flask) processes events
```

## Dual-Service Architecture

This project uses TWO services that work together:

### 1. jambonz-ws-service (Node.js - WebSocket) ⭐ PRIMARY

**Purpose**: Handles Jambonz LLM calls with proper multi-tenant tool routing

**Why WebSocket?** Jambonz's HTTP `toolHook` webhooks send minimal payloads without `call_sid` or `account_sid`, making multi-tenant routing impossible. The WebSocket SDK provides session objects with full call context.

**Handles**:
- Incoming call setup via WebSocket
- LLM session management with Ultravox
- Tool calls (transfer, collect info, hang up) with full session context
- Multi-tenant routing via session.account_sid
- Business hours checking and routing

**Repository**: Currently in this monorepo at `jambonz-ws-service/`

**Deployment**: Railway (auto-deploy from git push)
- URL: `https://jambonz-ws-service-production.up.railway.app`
- WebSocket: `wss://jambonz-ws-service-production.up.railway.app/ws`

**Key Files**:
```
jambonz-ws-service/
├── simple-transfer.js        # Main entry (simple transfers) - CURRENT
├── twilio-handler.js         # Twilio-specific handler
├── handlers/                 # Event handlers (incoming-call, tool-call, etc.)
├── models/                   # Client.js, CallLog.js - DB models
├── lib/                      # supabase.js, business-hours.js
└── scripts/                  # Setup and configuration scripts
```

### 2. pbx-service (Flask - HTTP Webhooks)

**Purpose**: Handles Ultravox webhooks and non-LLM integrations

**Handles**:
- Ultravox webhook events (call.started, call.joined, call.ended)
- Voicemail processing
- Call status tracking
- Other HTTP-only integrations
- Admin scripts and utilities

**Repository**: Separate repo at `voice-backend-coordination`

**Deployment**: Railway (auto-deploy from git push)
- URL: `https://voice-backend-coordination-production.up.railway.app`

**Key Files**:
```
pbx-service/
├── app.py                    # Flask routes and webhook endpoints
├── config.py                 # Environment configuration
├── models/                   # Supabase database models
├── services/                 # Business logic handlers
│   ├── jambonz_handler.py    # Legacy Jambonz webhook processing
│   ├── ultravox_client.py    # Ultravox API client
│   ├── ultravox_webhook_handler.py  # Ultravox event processing
│   └── business_hours.py     # Timezone-aware hours checking
├── utils/                    # Authentication and security
└── scripts/                  # Admin and troubleshooting scripts
```

### Service Coordination

- **Both services** connect to the same Supabase database
- **WebSocket service** handles real-time call flow and LLM interactions
- **Flask service** handles asynchronous webhook events and background processing
- **No direct communication** between services - coordination via database

### Which Service Should You Modify?

**Modify jambonz-ws-service when:**
- Changing call flow or routing logic
- Adding/modifying tools available to AI
- Updating business hours routing
- Changing how transfers work
- Modifying Jambonz WebSocket integration

**Modify pbx-service when:**
- Processing Ultravox webhook events
- Handling voicemail recordings
- Background data processing
- Admin utilities and scripts
- Changing system prompt templates (if not in DB)

## Architecture Components

### Database (Supabase)

**clients** - Tenant configurations with template variables
- Each client has unique `ultravox_agent_id` and `business_hours_config` (JSONB)
- Template variables: `office_name`, `office_hours`, `office_phone`, `office_website`, etc.
- System prompts can be stored per-client or templated
- `jambonz_account_sid` used for routing in WebSocket service

**phone_numbers** - Maps DIDs to clients

**call_logs** - Complete call tracking with billing data
- Fields: `duration_seconds`, `transferred_to_human`, `voicemail_recorded`
- Created by WebSocket service on call start
- Updated throughout call lifecycle

**voicemails** - Recording URLs, transcriptions, and read status

**ultravox_calls** - Ultravox call session tracking
- Links Ultravox call IDs to call_logs
- Tracks call state and events

**ultravox_events** - Detailed event log from Ultravox webhooks

### Key Patterns

**Template-Based Personalization:**
- System prompts interpolate client-specific variables: `{{office_name}}`, `{{office_hours}}`, dynamic caller info
- After-hours prompts differ from business hours (voicemail-focused)
- Clients can have custom system prompts stored in database

**Business Hours Routing:**
- JSONB config per client with timezone, hours per weekday, special closures
- `BusinessHoursChecker.is_open()` determines routing behavior
- Implemented in both services (Node.js and Python versions)

**Multi-Destination Transfers:**
- AI can transfer to: primary (main office), secondary (backup), voicemail
- Whisper announcements provide caller context to human agents before connection

### Ultravox Agent Configuration

**CRITICAL: API Structure Requirements**

When updating Ultravox agents via API, ALL configuration fields MUST be wrapped in a `callTemplate` object:

```python
# ❌ WRONG - Will fail silently
payload = {
    'systemPrompt': prompt,
    'voice': voice,
    'selectedTools': tools
}

# ✅ CORRECT - All fields in callTemplate
payload = {
    'callTemplate': {
        'systemPrompt': prompt,
        'voice': voice,
        'selectedTools': tools
    }
}
```

**Durable Tools vs Temporary Tools**

Always use durable tools (referenced by toolId) instead of temporaryTool definitions:

```python
# ❌ WRONG - Inline temporaryTool definition
{
    "temporaryTool": {
        "modelToolName": "transfer",
        "description": "...",
        "http": {...}
    }
}

# ✅ CORRECT - Reference durable tool by ID
{
    "toolId": "9d718770-d609-4223-bfe0-a5a8f30d582b"
}
```

**Benefits of Durable Tools:**
- Centralized tool management - define once, use everywhere
- Consistent behavior across all agents
- Easier updates - change tool definition in one place
- Proper separation of concerns

**Available Durable Tools:**
Query available tools: `GET https://api.ultravox.ai/api/tools`

Current tools:
- `transferFromAiTriageWithMetadata` (c5835b78-7e5f-4515-a9fa-1d91c61fceea) - Transfer with caller metadata **[UPDATED WITH automaticParameters]**
- `coldTransfer` (2fff509d-273f-414e-91ff-aa933435a545) - Basic transfer
- `collectNameNumberConcernPetName` (4e0b0313-df50-4c18-aba1-bbf4acbfff88) - Info collection
- `leaveVoicemail` (8721c74d-af3f-4dfa-a736-3bc170ef917c) - Voicemail recording
- `queryCorpus` (84a31bac-5c1b-41c3-9058-f81acb7ffaa7) - RAG/knowledge base queries
- `playDtmfSounds` (3e9489b1-25de-4032-bb3d-f7b84765ec93) - DTMF tones
- `hangUp` (56294126-5a7d-4948-b67d-3b7e13d55ea7) - End call

**Silent Failures:**
- Ultravox does NOT error when tools are missing from agent configuration
- Tool invocations are silently ignored if the tool isn't in selectedTools
- ALWAYS verify tool configuration after syncing: check `callTemplate.selectedTools`

**CRITICAL: Automatic Parameters for HTTP Tools**

Ultravox does NOT automatically send call context (like call IDs) with HTTP tool requests. You MUST explicitly configure `automaticParameters` in the tool definition:

```python
# Add automaticParameters to send call ID in header
{
  "definition": {
    "automaticParameters": [
      {
        "name": "X-Ultravox-Call-Id",
        "location": "PARAMETER_LOCATION_HEADER",
        "knownValue": "KNOWN_PARAM_CALL_ID"
      }
    ]
  }
}
```

**Available Automatic Parameters:**
- `KNOWN_PARAM_CALL_ID` - Ultravox call ID (essential for tracking)
- `KNOWN_PARAM_CONVERSATION_HISTORY` - Full conversation transcript
- `KNOWN_PARAM_OUTPUT_SAMPLE_RATE` - Audio sample rate
- `KNOWN_PARAM_CALL_STATE` - Current call state

**Parameter Locations:**
- `PARAMETER_LOCATION_HEADER` - HTTP header (recommended for call IDs)
- `PARAMETER_LOCATION_BODY` - Request body
- `PARAMETER_LOCATION_QUERY` - Query string
- `PARAMETER_LOCATION_PATH` - URL path parameter

**Why This Matters:**
- Without `automaticParameters`, your webhook handler won't know which call the request belongs to
- Tool `c5835b78-7e5f-4515-a9fa-1d91c61fceea` (transferFromAiTriageWithMetadata) is configured with `X-Ultravox-Call-Id` header
- Backend code looks for this header to map Ultravox calls to Twilio calls
- See [twilio-handler.js:443](jambonz-ws-service/twilio-handler.js#L443) for header extraction logic

**Agent Sync Workflow:**
1. Query available durable tools to get tool IDs
2. Update agent with `callTemplate` wrapper and tool IDs
3. Verify tools are configured: `GET /api/agents/{agentId}`
4. Check `agent.callTemplate.selectedTools` contains expected tool IDs
5. **CRITICAL:** Verify HTTP tools have `automaticParameters` configured for call tracking

## Development Commands

### WebSocket Service (Node.js)

```bash
# Navigate to service
cd jambonz-ws-service

# Install dependencies
npm install

# Development with auto-reload
npm run dev                   # Runs simple-transfer.js with nodemon
npm run dev:twilio           # Runs twilio-handler.js with nodemon

# Production
npm start                     # Runs twilio-handler.js
npm run start:jambonz        # Runs simple-transfer.js
npm run start:twilio         # Runs twilio-handler.js

# Configuration
npm run configure:twilio     # Configure Twilio number

# Test locally with ngrok
ngrok http 3000
# Update Jambonz application to use: wss://[ngrok-url]/ws
```

### Flask Service (Python)

```bash
# Navigate to service
cd pbx-service

# Install dependencies
pip install -r requirements.txt

# Run Flask app locally (port 8080)
python app.py

# Test webhook locally with ngrok
ngrok http 8080
```

### Database Operations

```bash
# Run initial schema setup (Flask service)
psql $DATABASE_URL < pbx-service/scripts/setup_database.sql

# Apply migration (Flask service)
psql $DATABASE_URL < pbx-service/migrations/add_ultravox_events.sql

# Apply migration (WebSocket service)
psql $DATABASE_URL < jambonz-ws-service/migrations/add_system_prompt_to_clients.sql
```

### Testing Scripts

```bash
# Flask service scripts
python pbx-service/test-webhook.py
python pbx-service/scripts/troubleshoot_call.py <call_sid>
python pbx-service/scripts/sync_ultravox_agents.py

# WebSocket service scripts
node jambonz-ws-service/scripts/configure-twilio-number.js
node jambonz-ws-service/test-simple-transfer.js
```

### Deployment (Railway)

```bash
# Login to Railway
railway login

# Check logs (from service directory)
cd jambonz-ws-service
railway logs                  # Real-time logs for current service
railway logs --follow         # Follow mode

cd ../pbx-service
railway logs                  # Flask service logs

# View deployment status
railway status
```

**IMPORTANT: Deployment is via Git CI/CD, NOT `railway up`**
```bash
# Correct deployment workflow:
git add <files>
git commit -m "message"
git push origin main
# Railway automatically deploys from GitHub push

# DO NOT use:
railway up  # This is not our deployment method
```

### OpenSpec Commands

```bash
# List active changes and specifications
openspec list
openspec list --specs

# Show details of change or spec
openspec show <item>

# Validate changes before implementation
openspec validate <change-id> --strict

# View spec differences
openspec diff <change-id>

# Archive completed changes (after deployment)
openspec archive <change-id> --yes
```

## Configuration Requirements

### WebSocket Service Environment Variables

Required:
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key for database access
- `ULTRAVOX_API_KEY` - Ultravox API authentication
- `PORT` - Server port (default: 3000)

Optional:
- `TWILIO_ACCOUNT_SID` - For Twilio integration
- `TWILIO_AUTH_TOKEN` - For Twilio integration
- `NODE_ENV` - development or production

See `jambonz-ws-service/.env.example` for complete template.

### Flask Service Environment Variables

Required:
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key for database access
- `ULTRAVOX_API_KEY` - Ultravox API authentication
- `JAMBONZ_WEBHOOK_SECRET` - OR (`JAMBONZ_WEBHOOK_USERNAME` + `JAMBONZ_WEBHOOK_PASSWORD`)

Optional:
- `ULTRAVOX_WEBHOOK_SECRET` - Webhook signature verification (recommended)
- `JAMBONZ_ACCOUNT_SID`, `JAMBONZ_API_KEY` - For Jambonz API operations
- `PORT` - Server port (default: 8080)
- `FLASK_ENV` - development or production

See `pbx-service/.env.example` for complete template.

## Important Endpoints

### WebSocket Service (Jambonz Integration)

**WebSocket Endpoint:**
- `wss://[domain]/ws` - Jambonz application WebSocket connection

**HTTP Endpoints:**
- `GET /health` - Service health check

**WebSocket Event Handlers:**
- `session:new` - Incoming call setup
- `/toolCall` - Tool invocations from AI (client-side tools)
- `/dialComplete` - Transfer completion
- Custom action hooks as configured

### Flask Service (HTTP Webhooks)

**Jambonz Webhooks (Legacy/Non-LLM):**
- `POST /incoming-call` - Route incoming calls (if not using WebSocket)
- `POST /call-status` - Call status updates
- `POST /voicemail-complete` - Voicemail recording completion

**Ultravox Webhooks:**
- `POST /ultravox/webhook` - All Ultravox events
  - call.started, call.joined, call.ended
  - agent.left, agent.timeout
  - Tool invocations and results

**Health Check:**
- `GET /health` - Returns `{"status": "healthy"}`

## Critical Implementation Notes

### System Prompt Interpolation

- System prompts can be stored per-client in database (`clients.system_prompt`)
- OR use template-based interpolation with variables
- Static variables: `{{office_name}}`, `{{office_hours}}`, `{{office_phone}}`, etc.
- Dynamic variables: `{{current_time}}`, `{{caller_phone_last4}}`, `{{day_of_week}}`

### Business Hours Logic

- Always check `client['business_hours_enabled']` before applying hours logic
- JSONB structure: `{timezone, hours: {monday: {open, close}, ...}, special_closures: []}`
- Use `pytz` (Python) or `moment-timezone` (Node.js) for timezone conversions
- After-hours routing sends different system prompt to AI

### Webhook Security

**Flask Service:**
- `verify_jambonz_signature()` validates Jambonz webhooks
- `verify_ultravox_signature()` validates Ultravox webhooks
- Returns 401 if signature invalid
- Supports both Basic Auth and HMAC signature methods

**WebSocket Service:**
- WebSocket connections are authenticated by Jambonz
- Session context provides secure routing via account_sid

### Call Logging

- Create log entry immediately on incoming call (WebSocket service)
- Update with duration, transfer status, voicemail status on completion
- Both services can update call_logs via Supabase
- Essential for billing queries

### Transfer Tool Troubleshooting

**Issue: "Cannot determine Ultravox call ID" or transfer fails with no call mapping**

**Root Cause:** The `X-Ultravox-Call-Id` header is not being sent by Ultravox.

**Solution:**
1. Verify tool has `automaticParameters` configured:
```bash
curl "https://api.ultravox.ai/api/tools/c5835b78-7e5f-4515-a9fa-1d91c61fceea" \
  -H "X-API-Key: $ULTRAVOX_API_KEY" | jq '.definition.automaticParameters'
```

2. Should return:
```json
[
  {
    "name": "X-Ultravox-Call-Id",
    "location": "PARAMETER_LOCATION_HEADER",
    "knownValue": "KNOWN_PARAM_CALL_ID"
  }
]
```

3. If missing, update tool using [update_transfer_tool_with_call_id.js](jambonz-ws-service/scripts/update_transfer_tool_with_call_id.js)

**Issue: "username is required" when calling Twilio API**

**Root Cause:** Missing `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN` environment variables.

**Solution:**
```bash
railway variables --set "TWILIO_ACCOUNT_SID=AC..." --set "TWILIO_AUTH_TOKEN=..."
```

**Verification Checklist:**
- [ ] `X-Ultravox-Call-Id` header present in Railway logs
- [ ] `twilio_ultravox_calls` table has mapping entry
- [ ] `call_logs` table has entry with `ultravox_call_id`
- [ ] `tool_call_logs` table shows transfer attempt with status='success'
- [ ] Tool definition includes `automaticParameters`

See verification script: [verify_transfer_data.js](jambonz-ws-service/verify_transfer_data.js)

## Ultravox + Jambonz Integration Patterns

### Tool Types: HTTP vs Client-Side

**Client-Side Tools (WebSocket) - CURRENT IMPLEMENTATION:**
```javascript
selectedTools: [{
  temporaryTool: {
    modelToolName: 'transfer',
    description: 'Transfer the call to a specialist',
    dynamicParameters: [],
    client: {}  // ← Makes it a CLIENT-SIDE tool via WebSocket
  }
}]
```
- Tool invocations arrive via `/toolCall` WebSocket event
- Handler responds immediately with `sendToolOutput()`
- Then uses `sendCommand('redirect')` to change call flow
- **Used in simple-transfer.js** - works reliably for basic transfers

**HTTP Tools (Server-Side) - ADVANCED:**
```javascript
selectedTools: [{
  temporaryTool: {
    modelToolName: 'transferToOnCall',
    http: {  // ← Makes it a server-side HTTP tool
      url: `${process.env.BASE_URL}/transferToOnCall`,
      method: 'POST'
    }
  }
}]
```
- Ultravox calls your HTTP endpoint directly
- Respond immediately → AI session ends (saves time/money)
- Requires separate HTTP endpoint to handle tool calls
- **Better for production** - but more complex setup

### Transfer Patterns: Simple vs Warm Transfer

**Simple Transfer (CURRENT - WORKING):**
```javascript
// Client-side tool handler
session.on('/toolCall', (evt) => {
  // 1. Send tool output immediately
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Transfer initiated'
  });

  // 2. Redirect to dial verb
  session.sendCommand('redirect', [
    {verb: 'say', text: 'Please wait while I connect you'},
    {
      verb: 'dial',
      actionHook: '/dialComplete',
      callerId: session.from,
      target: [{
        type: 'phone',
        number: transferNumber,
        trunk: 'voip.ms-jambonz'
      }]
    }
  ]);
});
```

**Why simple transfer works:**
- Uses redirect → dial pattern from official Jambonz example
- No queue management needed
- Specialist answers, calls are bridged automatically
- Perfect for basic transfers without warm transfer/briefing

**Warm Transfer with Briefing (ADVANCED):**
```javascript
// 1. Put caller in queue with hold music
session
  .say({text: 'Please hold while I transfer you.'})
  .enqueue({
    name: call_sid,  // Queue identifier
    actionHook: '/consultationDone',
    waitHook: '/wait-music'  // Play hold music
  })
  .reply();

// 2. Dial specialist on SEPARATE call leg
const wsUri = `wss://${BASE_URL}/dial-specialist`;
session.sendCommand('dial', [{
  target: [{type: 'phone', number: transferNumber, trunk: 'voip.ms-jambonz'}],
  wsUri,  // Routes specialist call to separate WebSocket endpoint
  answerOnBridge: true,
  customerData: {  // Pass context to specialist
    'X-Original-Caller': session.from,
    'X-Transfer-Reason': conversation_summary,
    'X-Queue': call_sid
  }
}]);

// 3. Specialist WebSocket endpoint handles bridging
specialistSvc.on('session:new', async (session) => {
  const queueName = session.customerData?.['X-Queue'];
  const summary = session.customerData?.['X-Transfer-Reason'];

  // Brief specialist, then bridge calls
  session
    .say({text: `You have a transfer. ${summary}. Connecting...`})
    .dequeue({
      name: queueName,  // Bridge to caller in queue
      beep: true,
      timeout: 2
    })
    .reply();
});
```

**Why warm transfer is better for production:**
- Caller stays on hold with music (not disconnected)
- Specialist call is **separate WebSocket session**
- `dequeue()` bridges the two calls together
- Specialist gets briefed before connection
- More complex but provides better user experience

**Reference Implementation:**
- See `https://github.com/jambonz/ultravox-warm-transfer`
- Simple transfer: `jambonz-ws-service/simple-transfer.js` (CURRENT)
- Warm transfer: `jambonz-ws-service/index.js` (FUTURE)

### WebSocket Event Handlers

**With client-side tools:**
- Events use `/toolCall` for tool invocations
- Custom paths like `/dialComplete` for action hooks

**With HTTP tools:**
- Events use custom hook paths matching your `actionHook` values
- NOT `verb:hook` - those are for client-side tools only

```javascript
session
  .on('/consultationDone', (evt) => {
    // Queue operation completed
  })
  .on('/wait-music', (evt) => {
    // Provide hold music
    session.reply([{verb: 'play', url: 'https://...', loop: true}]);
  })
  .on('/dequeue', (evt) => {
    // Dequeue result (success or timeout)
    if (evt.dequeueResult === 'timeout') {
      session.say({text: 'Caller hung up'}).hangup().reply();
    }
  });
```

## Accessing Logs

### Railway Logs

**WebSocket Service:**
```bash
cd jambonz-ws-service
railway logs                  # Real-time logs
railway logs --follow         # Follow mode
```

**Flask Service:**
```bash
cd pbx-service
railway logs                  # Real-time logs
railway logs --follow         # Follow mode
```

**What to look for:**

*WebSocket Service:*
- `Starting Container` - New deployment starting
- `Simple transfer service listening on port 3000` - Service ready
- `WebSocket endpoint created at /ws` - Endpoint configured
- `New call - simple transfer agent` - Call received
- `Tool invocation:` - Tool called by AI
- `Redirecting to dial verb` - Transfer initiated

*Flask Service:*
- `Ultravox webhook received:` - Webhook event
- `Processing call.started event` - Call tracking
- `Voicemail recorded:` - Voicemail processing

### Monitoring Railway Logs (Desktop Commander)

**BEST PRACTICE: Use Desktop Commander for real-time log monitoring**

Standard Bash with `railway logs` has issues with buffering and grep filtering. Desktop Commander's process tools work reliably:

```bash
# Start log monitoring process
mcp__desktop-commander__start_process(
  command: "railway logs --service jambonz-ws-service 2>&1",
  timeout_ms: 5000
)
# Returns PID for querying

# Read log output
mcp__desktop-commander__read_process_output(
  pid: <process_id>,
  timeout_ms: 5000
)

# When done, terminate
mcp__desktop-commander__force_terminate(pid: <process_id>)
```

**Why this works better:**
- Desktop Commander handles TTY/buffering correctly
- Can query same process multiple times
- Doesn't get stuck on grep filters
- Shows real-time updates reliably

### VoIP.ms Logs (SIP Provider)

**CDR Logs via API:**
```bash
# Query recent calls
curl "https://voip.ms/api/v1/rest.php" \
  -d "api_username=jeremy.greven@getvetwise.com" \
  -d "api_password=$VOIPMS_API_PASSWORD" \
  -d "method=getCDR" \
  -d "date_from=$(date -v-1d +%Y-%m-%d)" \
  -d "date_to=$(date +%Y-%m-%d)" \
  -d "timezone=-5"
```

**Web Portal:**
1. Login to portal.voip.ms
2. Main Menu → CDR → Search
3. Filter by: DID (2894730151), Date Range, Call Type (Incoming/Outgoing)

**What to look for:**
- Incoming calls: Status "ANSWERED", Duration > 0
- Outbound calls: Destination shows transfer number (3654001512)
- Failed calls: Status "CONGESTION", "UNREACHABLE", "BUSY"
- Call flow: Inbound call ANSWERED → Outbound call ANSWERED (successful transfer)

### Ultravox Logs (AI Agent)

**API Access:**
```bash
# List recent calls
curl "https://api.ultravox.ai/api/calls" \
  -H "X-API-Key: $ULTRAVOX_API_KEY" \
  -H "Content-Type: application/json"

# Get specific call details
curl "https://api.ultravox.ai/api/calls/{call_id}" \
  -H "X-API-Key: $ULTRAVOX_API_KEY"
```

**Web Dashboard:**
1. Go to ultravox.ai dashboard
2. Calls → Recent Calls
3. Click call to see: transcript, tool invocations, events, duration

**What to look for:**
- Transcript showing "transfer" request
- Tool invocations: `transfer` with parameters
- Call duration (should continue during transfer with client-side tools)
- Any errors or failed tool calls

### Jambonz Logs (Platform)

**Portal Access:**
1. Login to jambonz.cloud
2. Recent Calls → Search by call_sid or phone number
3. View: call flow, verbs executed, errors, recordings

**API Access:**
```bash
# Get recent calls
curl "https://api.jambonz.cloud/v1/Accounts/$JAMBONZ_ACCOUNT_SID/Calls" \
  -H "Authorization: Bearer $JAMBONZ_API_KEY"

# Get specific call
curl "https://api.jambonz.cloud/v1/Accounts/$JAMBONZ_ACCOUNT_SID/Calls/{call_sid}" \
  -H "Authorization: Bearer $JAMBONZ_API_KEY"
```

**What to look for:**
- Call status: in-progress, completed, failed
- Verbs executed: llm → dial (simple transfer) OR llm → enqueue → dial → dequeue (warm transfer)
- SIP trunk used: voip.ms-jambonz
- Call legs: parent call (caller) + child call (specialist)
- Errors: 403 Forbidden (trunk config), 404 Not Found (routing)

### Debugging Transfer Issues

**Complete Log Flow (Successful Simple Transfer):**

1. **Railway (WebSocket)**: `New call - simple transfer agent` → `Tool invocation: transfer`
2. **Ultravox**: Transcript shows transfer request → Tool invoked
3. **Railway (WebSocket)**: `Redirecting to dial verb` → `Dial target: +1365...`
4. **VoIP.ms**: Inbound ANSWERED (caller) → Outbound ANSWERED (specialist)
5. **Jambonz**: Two call legs, both completed

**Common Failure Patterns:**

**Pattern 1: "Call hangs up immediately after answering"**
- Cause: Jambonz Application Call Hook URL doesn't match WebSocket endpoint
- Fix: Verify `wss://[railway-url]/ws` exactly matches endpoint in code
- Logs: No WebSocket connection logs in Railway

**Pattern 2: "AI doesn't speak"**
- Cause: WebSocket connection failed or endpoint path mismatch
- Fix: Check Railway logs for `WebSocket endpoint created at /ws`
- Logs: WebSocket service shows no incoming connection

**Pattern 3: "Tool never invoked"**
- Cause: System prompt doesn't instruct AI to use tool, or tool definition wrong
- Fix: Check client.system_prompt includes transfer instructions
- Logs: Ultravox transcript shows no tool invocation

**Pattern 4: "Transfer dials but no audio"**
- Cause: Trunk not configured, wrong trunk name, or SIP registration issue
- Fix: Check Jambonz trunk config, verify registration status
- Logs: Jambonz shows dial attempt but SIP error

**Pattern 5: "Which service is handling what?"**
- Check WebSocket service logs first for call flow and transfers
- Check Flask service logs for Ultravox webhook events
- Check database call_logs table for complete call history
- If tool calls aren't working, it's a WebSocket service issue
- If Ultravox events aren't being recorded, it's a Flask service issue

## Common Tasks

### Adding a New Client

1. Insert row into `clients` table:
```sql
INSERT INTO clients (
    name, jambonz_account_sid, ultravox_agent_id,
    office_name, office_hours, office_phone, office_website,
    primary_transfer_number, business_hours_enabled, business_hours_config
) VALUES (
    'New Client',
    'acct_jambonz_sid',
    'agent_ultravox_id',
    'Office Name',
    'Monday-Friday 9am-5pm',
    '+18005551234',
    'https://example.com',
    '+14165559999',
    TRUE,
    '{"timezone": "America/Toronto", "hours": {...}}'::jsonb
);
```

2. Add phone number mapping:
```sql
INSERT INTO phone_numbers (phone_number, client_id)
VALUES ('+12894730151', 'client-uuid');
```

3. Test call flow with provisioned DID

### Modifying System Prompts

**Option 1: Database-stored prompts (per-client)**
```sql
UPDATE clients
SET system_prompt = 'Your custom prompt here...'
WHERE id = 'client-uuid';
```

**Option 2: Template-based (shared across clients)**
1. Update template in `jambonz-ws-service/shared/prompts.js`
2. Ensure template variables match client database schema
3. Deploy changes via git push

### Debugging Call Issues

1. **Determine which service is involved:**
   - Call not connecting? → WebSocket service
   - AI not speaking? → WebSocket service + Ultravox
   - Transfer not working? → WebSocket service + Jambonz trunk
   - Ultravox events not recorded? → Flask service

2. **Check appropriate logs:**
   - WebSocket: `cd jambonz-ws-service && railway logs`
   - Flask: `cd pbx-service && railway logs`
   - Jambonz: Portal → Recent Calls
   - Ultravox: Dashboard → Recent Calls

3. **Verify configuration:**
   - Jambonz application uses WebSocket mode
   - WebSocket URL: `wss://jambonz-ws-service-production.up.railway.app/ws`
   - Client has `ultravox_agent_id` configured
   - Phone number mapped to client in database

4. **Database checks:**
```sql
-- Find client by phone number
SELECT c.* FROM clients c
JOIN phone_numbers p ON p.client_id = c.id
WHERE p.phone_number = '+12894730151';

-- Check recent call logs
SELECT * FROM call_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### Production Deployment

**Railway Configuration:**

*WebSocket Service:*
- Runs `npm start` (twilio-handler.js) via package.json
- Port: 3000 (configurable via PORT env var)
- WebSocket endpoint: /ws
- Supports 100+ concurrent calls

*Flask Service:*
- Gunicorn runs with 4 workers (see `Procfile`)
- Port: 8080
- HTTP webhooks only
- Processes background events

**Both Services:**
- HTTPS/WSS required for all connections
- Database backups configured in Supabase
- Monitor with Railway alerts
- Deploy via git push to main branch

### Testing the Implementation

1. Call (289) 473-0151
2. AI answers with personalized greeting
3. Have conversation with AI
4. Say: "I need to speak with someone" or "transfer me"
5. Tool invocation triggers
6. Hear: "Please wait while I connect you"
7. Call transfers to configured number
8. When answered, calls are bridged
9. Verify in logs:
   - WebSocket service: Tool invocation + redirect
   - VoIP.ms: Two call legs (inbound + outbound)
   - Jambonz: Call completed successfully
   - Database: call_logs updated with transfer status

## Simple Transfer Implementation (CURRENT - WORKING)

**File:** [jambonz-ws-service/simple-transfer.js](jambonz-ws-service/simple-transfer.js)

This is a minimal, working transfer implementation based on the official Jambonz ultravox-transfer-call-example. **Successfully tested and deployed.**

### Critical Configuration Requirements

**1. Jambonz Application Setup:**
- **Call Hook Type**: WebSocket
- **Call Hook URL**: `wss://jambonz-ws-service-production.up.railway.app/ws`
- The `/ws` endpoint path MUST match the WebSocket endpoint in your code

**2. Railway Deployment:**
- URL: `https://jambonz-ws-service-production.up.railway.app`
- WebSocket: `wss://jambonz-ws-service-production.up.railway.app/ws`
- Deploy via: `git push origin main` (CI/CD, NOT `railway up`)

### Key Implementation Details

**WebSocket Endpoint:**
```javascript
const svc = makeService({path: '/ws'});  // MUST match Jambonz config
```

**Transfer Tool Configuration (CLIENT-SIDE):**
```javascript
selectedTools: [{
  temporaryTool: {
    modelToolName: 'transfer',
    description: 'Transfer the call to a specialist',
    dynamicParameters: [],
    client: {}  // CLIENT-SIDE tool - handled via WebSocket event
  }
}]
```

**Tool Handler Pattern:**
```javascript
session.on('/toolCall', (evt) => handleTransferTool(session, evt));

function handleTransferTool(session, evt) {
  // 1. Send tool output immediately
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Transfer initiated'
  });

  // 2. Redirect to dial verb (official pattern from jambonz/ultravox-transfer-call-example)
  session.sendCommand('redirect', [
    {verb: 'say', text: 'Please wait while I connect you'},
    {
      verb: 'dial',
      actionHook: '/dialComplete',
      callerId: session.from,
      target: [{
        type: 'phone',
        number: TRANSFER_NUMBER,
        trunk: TRANSFER_TRUNK
      }]
    }
  ]);
}
```

### Why This Works

**Client-Side Tool (WebSocket):**
- Tool invocations arrive via `/toolCall` WebSocket event
- Handler responds immediately with `sendToolOutput()`
- Then uses `sendCommand('redirect')` to change call flow
- Simple, direct, works reliably

**NO Enqueue/Dequeue Complexity:**
- Uses simple redirect → dial pattern from official example
- No queue management needed for basic transfer
- Specialist answers, calls are bridged automatically

### Common Issues and Solutions

**Issue: Call hangs up immediately**
- **Cause**: Jambonz Application Call Hook URL doesn't match WebSocket endpoint
- **Solution**: Verify `wss://[railway-url]/ws` exactly matches your endpoint path

**Issue: No logs in Railway when calling**
- **Cause**: Jambonz isn't connecting to your WebSocket endpoint at all
- **Solution**: Check Jambonz Application Call Hook URL configuration

**Issue: AI doesn't speak**
- **Cause**: WebSocket connection failed or endpoint path mismatch
- **Solution**: Check Railway logs for `WebSocket endpoint created at /ws` and verify Jambonz config

### Next Steps for Production

This minimal implementation is perfect for:
- Simple transfers without warm transfer/briefing
- Testing Ultravox + Jambonz integration
- Learning the WebSocket event flow
- Production use for basic call routing

For warm transfers with specialist briefing, see:
- `/tmp/ultravox-transfer-call-example/index.js` - enqueue/dequeue pattern
- CLAUDE.md section on "Transfer Patterns: Simple vs Warm Transfer"

## Twilio Elastic SIP Trunk Transfer Implementation

**File:** [jambonz-ws-service/twilio-handler.js](jambonz-ws-service/twilio-handler.js)

This implementation transfers calls from Twilio → Aircall via Elastic SIP Trunk.

### Key Learnings: Elastic SIP Trunks vs BYOC

**Elastic SIP Trunk (TK prefix):**
- Trunk SID: `TK9e454ef3135d17201fc935de6cda56ec`
- Routes calls via **phone number association**
- Just dial the number: `<Dial>+13652972501</Dial>`
- Twilio automatically routes through trunk if number is associated

**BYOC Trunk (BY prefix):**
- Different technology - requires `byoc` attribute
- Would use: `<Number byoc="BY...">+1234567890</Number>`
- NOT what we're using

### How Elastic SIP Trunk Routing Works

**Configuration in Twilio Console:**
1. Create Elastic SIP Trunk with Origination URI: `sip:aircall-custom.sip.us1.twilio.com`
2. Associate phone number `+13652972501` with trunk
3. No TwiML changes needed!

**TwiML Routing:**
```xml
<Dial callerId="+14168189171">+13652972501</Dial>
```

**What Happens:**
1. Twilio sees you're dialing `+13652972501`
2. Checks: Is this number associated with a SIP trunk?
3. YES → Routes call via trunk's Origination URI to Aircall
4. NO → Routes via standard PSTN

### Caller ID Pass-Through

**✅ What Works:**
```javascript
// Use original caller's phone number as caller ID
const callerIdAttr = originalCallerNumber ? `callerId="${originalCallerNumber}"` : '';

const twiml = `<Dial ${callerIdAttr}>+13652972501</Dial>`;
// Result: Aircall sees +14168189171 (original caller), NOT Twilio number
```

**❌ What Doesn't Work:**
```javascript
// SIP headers can ONLY be sent with <Sip> noun, NOT phone numbers
const twiml = `<Dial>+13652972501?X-Caller-Name=Jeremy&X-Urgency=Critical</Dial>`;
// ERROR: "An application error has occurred"
```

### Custom SIP Headers Limitation

**Why Headers Don't Work:**
- SIP headers (`?X-Header=value`) only work with `<Sip>` noun
- Elastic SIP trunk routing uses phone number association, not `<Sip>` URIs
- Cannot combine both approaches

**Example - Headers with <Sip> (works):**
```xml
<Dial>
  <Sip>sip:user@domain.com?X-Caller-Name=Jeremy&X-Urgency=Critical</Sip>
</Dial>
```

**Example - Headers with phone number (doesn't work):**
```xml
<Dial>+13652972501?X-Caller-Name=Jeremy</Dial>
<!-- ERROR: Invalid TwiML syntax -->
```

**Conclusion:**
- With Elastic SIP trunk phone number routing: **Caller ID only, no custom headers**
- For custom headers: Would need `<Sip>` noun with direct SIP URI (but that doesn't work with Elastic trunk number association)
- Trade-off: Simple routing vs. metadata pass-through

### Database Schema for Transfer Routing

**Simplified Schema (after learnings):**
```sql
-- clients table
primary_transfer_number VARCHAR(50)  -- Phone number or SIP URI to dial
primary_transfer_type VARCHAR(20)    -- 'phone' or 'sip_uri'

-- call_logs table
transfer_type VARCHAR(20)    -- 'phone' or 'sip_uri'
transfer_method VARCHAR(20)  -- 'twilio_phone' or 'jambonz'
```

**Routing Logic:**
```javascript
// Simple: Check if SIP URI or phone number
if (transferNumber.startsWith('sip:')) {
  return {type: 'sip_uri', method: 'jambonz'};  // Future: Route via Jambonz
}
return {type: 'phone', method: 'twilio_phone'}; // Dial via Twilio (PSTN or Elastic SIP auto-routing)
```

**Removed Complexity:**
- ❌ `aircall_sip_number` - Use `primary_transfer_number` instead
- ❌ `twilio_aircall_trunk_sid` - Twilio handles routing automatically
- ❌ Complex routing logic - Just check if SIP URI or phone number

### Testing Checklist

**Before Testing:**
1. ✅ Associate `+13652972501` with Elastic SIP trunk in Twilio Console
2. ✅ Trunk has Origination URI: `sip:aircall-custom.sip.us1.twilio.com`
3. ✅ Database: `clients.primary_transfer_number = '+13652972501'`

**Test Call Flow:**
1. Call (289) 473-0151
2. AI answers and collects caller info
3. Ask to be transferred
4. Check Aircall: Should see **original caller's number** (not Twilio number)

**What to See in Logs:**
```
routeType: "phone"
routeMethod: "twilio_phone"
originalCaller: "+14168189171"
destination: "+13652972501"
message: "Successfully initiated phone transfer with original caller ID"
```

**Common Errors:**
- Error 21300: Trying to use `byoc` attribute with Elastic SIP trunk (TK prefix)
- Error 32214: Trying to use `<Sip>` with external domain (not owned SIP domain)
- "Application error": Invalid TwiML syntax (e.g., headers on phone number)

### ⚠️ CRITICAL: Double Billing Issue with Elastic SIP Trunk

**The Problem:**
When you dial `+13652972501` (which is associated with Elastic SIP trunk), Twilio creates **TWO call legs**:

1. **Outgoing Dial (Phone)** - PSTN termination charge
2. **Trunking Originating (SIP)** - SIP trunk charge

**Why This Happens:**
- Elastic SIP trunks are designed for **ORIGINATION** (routing YOUR Twilio numbers INTO your PBX/Aircall)
- You're using it for **TERMINATION** (routing FROM Twilio TO Aircall)
- Twilio first routes via PSTN, then the number association triggers the SIP trunk route
- This creates double billing for the same call

**Attempted Solutions (All Failed):**

❌ **Using `<Sip>` noun directly:**
```xml
<Dial><Sip>sip:+13652972501@aircall-custom.sip.us1.twilio.com</Sip></Dial>
```
Result: Error 32214 - "Your TwiML can only Dial out to Twilio SIP Domains that your account owns"

❌ **Using `byoc` attribute:**
```xml
<Dial><Number byoc="TK9e454ef3135d17201fc935de6cda56ec">+13652972501</Number></Dial>
```
Result: Error 21300 - "Invalid BYOC trunk SID" (TK is Elastic, not BYOC)

**Why There's No Solution:**
- Cannot use `<Sip>` with external domains (Aircall's SIP domain)
- Cannot use `byoc` attribute with Elastic SIP trunk (TK prefix)
- Phone number dialing always creates PSTN leg first, then trunk routing

**Actual Solutions (Pick One):**

1. **Accept Double Billing** (Current Implementation)
   - Keep current setup: `<Dial callerId="+14168189171">+13652972501</Dial>`
   - Cost: PSTN charge + SIP trunk charge per transfer
   - Benefit: Caller ID pass-through works, simple implementation

2. **Use Different Aircall Number (PSTN Only)**
   - Get a separate Aircall number NOT associated with SIP trunk
   - Route via pure PSTN: `<Dial>+1365XXXXXXX</Dial>`
   - Cost: Single PSTN charge per transfer
   - Downside: Lose SIP trunk benefits if any

3. **Use Aircall API for Transfers** (Complete Redesign)
   - Instead of TwiML `<Dial>`, call Aircall's API to create transfer
   - Aircall initiates the call TO the Twilio call
   - Cost: Single API call charge (if any)
   - Complexity: Requires significant architectural changes

4. **Remove SIP Trunk Association**
   - Disassociate `+13652972501` from Elastic SIP trunk
   - Keep trunk for other purposes, use this number via PSTN
   - Cost: Single PSTN charge per transfer
   - Note: Loses SIP trunk routing for this number

**Recommendation:**
For now, **accept the double billing** as the cost of this integration pattern. The caller ID pass-through is working, transfers are functioning correctly, and changing the architecture would require significant effort for minimal cost savings (unless transfer volume is extremely high).

**Cost Analysis:**
- Estimate transfer volume: X calls/month
- PSTN charge: ~$0.01-0.02/min
- SIP trunk charge: Varies by provider
- Alternative (Aircall API): Development time >> monthly charges for typical volumes

### Alternatives for Metadata Pass-Through

If you need caller metadata in Aircall:
1. **Aircall API** - Add call notes via REST API before/after transfer
2. **Aircall Webhooks** - Send metadata when call starts
3. **Screen Pop Integration** - Use Aircall's screen pop API with caller details
4. **CRM Integration** - Sync caller info to CRM, Aircall pulls from CRM
