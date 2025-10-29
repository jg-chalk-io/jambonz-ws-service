# VetWise AI Triage System Architecture

## Overview

VetWise is a multi-tenant veterinary AI triage system that routes incoming calls through Twilio to Ultravox AI agents, with intelligent call handling, human transfer capabilities, and database-driven configuration.

## System Architecture

### High-Level Call Flow

```
Incoming Call → Twilio → Ultravox AI Agent → HTTP Tools → Backend Services
                  ↓                              ↓
            TwiML <Stream>              Database (Supabase)
```

### Component Stack

1. **Twilio** - Telephony provider
   - Handles incoming calls
   - Provisions phone numbers
   - Streams audio via TwiML `<Stream>` element
   - Manages call control (transfer, hangup)

2. **Ultravox** - AI Voice Agent Platform
   - Real-time voice AI conversations
   - Built-in speech-to-text and text-to-speech
   - Durable HTTP tools for actions
   - RAG corpus for knowledge retrieval
   - WebSocket streaming protocol

3. **Railway** - Hosting Platform
   - Hosts Node.js backend service
   - Provides HTTPS endpoints for tools
   - Auto-deploys from GitHub
   - Environment: `jambonz-ws-service-production.up.railway.app`

4. **Supabase** - PostgreSQL Database
   - Client configurations
   - Call logs and analytics
   - Phone number mappings
   - Voicemail recordings
   - Call ID mappings (Twilio ↔ Ultravox)

## Detailed Architecture

### 1. Call Initiation Flow

```
1. Caller dials VetWise number (e.g., 289-473-0151)
2. Twilio receives call, looks up webhook URL
3. Twilio makes POST to /twilio/incoming (Railway)
4. Backend:
   a. Looks up client by phone number (Supabase)
   b. Loads client-specific system prompt from DB
   c. Interpolates template variables (office_name, etc.)
   d. Creates Ultravox call with configuration
   e. Stores mapping: ultravox_call_id → twilio_call_sid
5. Backend responds with TwiML <Stream> element
6. Twilio establishes WebSocket with Ultravox
7. Audio streams bidirectionally:
   - Caller → Twilio → Ultravox (speech-to-text)
   - Ultravox → Twilio → Caller (text-to-speech)
```

### 2. Ultravox Call Configuration

**Created via API when call starts:**

```javascript
{
  systemPrompt: "<interpolated agent prompt>",
  voice: "jessica",
  temperature: 0.3,
  selectedTools: [
    "transferFromAiTriageWithMetadata",  // Durable tool IDs
    "collectNameNumberConcernPetName"
    // Note: Use Ultravox's built-in endCall tool instead of custom hangUp
  ],
  corpusIds: ["95d3ce86-4bfd-45e9-8e13-4b9d6748f949"], // Pet breeds knowledge
  medium: {
    twilio: {
      callSid: "<twilio_call_sid>",
      accountSid: "<twilio_account_sid>",
      authToken: "<twilio_auth_token>"
    }
  }
}
```

### 3. Durable Tools Architecture

**HTTP Tools** (created once, reused across calls):

#### Tool 1: `transferFromAiTriageWithMetadata`
- **Purpose**: Transfer urgent cases to live vet
- **Endpoint**: `POST https://jambonz-ws-service-production.up.railway.app/twilio/transferToOnCall`
- **Parameters**:
  - `urgency_reason` (required): Description of emergency
  - `first_name` (required): Caller's first name
  - `last_name` (optional): Caller's last name (optional for critical emergencies)
  - `callback_number` (required): Phone number
  - `pet_name`, `species`, `breed`, `age` (optional): Pet details
- **Tool ID**: `9d718770-d609-4223-bfe0-a5a8f30d582b`

#### Tool 2: `collectNameNumberConcernPetName`
- **Purpose**: Collect non-urgent callback information
- **Endpoint**: `POST https://jambonz-ws-service-production.up.railway.app/twilio/collectCallerInfo`
- **Parameters**:
  - `callback_number` (required)
  - `first_name` (required): Caller's first name
  - `last_name` (required): Caller's last name
  - `concern_description` (required)
  - `pet_name` (optional)
- **Tool ID**: `4e0b0313-df50-4c18-aba1-bbf4acbfff88`

#### Built-in Tool: `endCall`
- **Purpose**: End call gracefully
- **Type**: Ultravox built-in tool (automatic, no configuration needed)
- **Parameters**: None
- **Note**: Use this instead of custom hangUp tool. The custom `hangUp` durable tool (ID: `4c5e41ef-b351-4346-9665-3d950a1e5d96`) is redundant and should not be used in new implementations

**Tool Invocation Flow:**

```
1. AI decides to use tool based on conversation
2. Ultravox makes HTTP POST to tool endpoint
3. Request includes:
   - Headers: X-Ultravox-Call-Token (ultravox call ID)
   - Body: Tool parameters from AI
4. Backend:
   a. Extracts ultravox_call_id from header
   b. Looks up twilio_call_sid from database
   c. Uses Twilio API to control call
   d. Stores action in database
5. Backend responds with success/failure
6. AI continues conversation based on result
```

### 4. Knowledge Corpus (RAG)

**Pet Breeds Corpus:**
- **Name**: `popularPetsCorpus`
- **ID**: `95d3ce86-4bfd-45e9-8e13-4b9d6748f949`
- **Contents**: 200 pet breeds with:
  - Species (Dog, Cat, Rabbit, Bird, etc.)
  - Breed names
  - Common alternative names
  - Size categories
  - Species categorization
- **Format**: Markdown document organized by species
- **Usage**: AI uses built-in `queryCorpus` tool to look up breed info

**Corpus Usage in Conversation:**
```
User: "My dog is a Lab"
AI: queryCorpus(query="Lab")
Corpus Returns: "Labrador Retriever - Dog, Large, Common Names: Lab, Labrador"
AI: "Okay, so that's a Labrador Retriever, is that correct?"
```

### 5. Database Schema (Supabase)

#### Table: `clients`
```sql
id                  BIGSERIAL PRIMARY KEY
name                VARCHAR(255)
office_name         VARCHAR(255)
office_phone        VARCHAR(20)
vetwise_phone       VARCHAR(20) UNIQUE  -- VetWise-provisioned number (routing key)
office_hours        TEXT
system_prompt       TEXT                 -- Agent prompt template
business_hours_config JSONB
ultravox_agent_id   VARCHAR(100)
created_at          TIMESTAMP
```

#### Table: `twilio_ultravox_calls`
```sql
id                  BIGSERIAL PRIMARY KEY
twilio_call_sid     VARCHAR(34) NOT NULL UNIQUE
ultravox_call_id    VARCHAR(100) NOT NULL UNIQUE
from_number         VARCHAR(20)
to_number           VARCHAR(20)
created_at          TIMESTAMP WITH TIME ZONE
completed_at        TIMESTAMP WITH TIME ZONE
```

**Purpose**: Maps Ultravox call IDs to Twilio call SIDs, enabling durable tools to control the correct Twilio call.

#### Table: `call_logs`
```sql
id                  BIGSERIAL PRIMARY KEY
client_id           BIGINT REFERENCES clients(id)
call_sid            VARCHAR(34)
from_number         VARCHAR(20)
to_number           VARCHAR(20)
duration_seconds    INTEGER
transferred_to_human BOOLEAN
voicemail_recorded  BOOLEAN
created_at          TIMESTAMP
```

### 6. System Prompt Architecture

**Template Variables** (replaced dynamically per call):

- `{{office_name}}` - From `clients.office_name`
- `{{agent_name}}` - Default: "Jessica"
- `{{office_hours}}` - From `clients.office_hours`
- `{{caller_phone_last4}}` - Last 4 digits of caller's number
- `{{clinic_open}}` / `{{clinic_closed}}` - Business hours status

**Template Storage:**
- Database: `clients.system_prompt` (per-client customization)
- Fallback: `/ai-agent-definitions/humber_vet_ultravox_compliant.md`

**Interpolation Location:**
`shared/agent-config.js:loadAgentDefinition()`

### 7. Call Control with Twilio API

**Tool Endpoints Control Calls Via Twilio REST API:**

```javascript
// Example: Transfer call
const client = twilio(accountSid, authToken);
await client.calls(callSid).update({
  twiml: `
    <Response>
      <Dial>
        <Number>${onCallNumber}</Number>
      </Dial>
    </Response>
  `
});
```

**Available Twilio Actions:**
- Update call with new TwiML (transfer)
- Hangup call
- Play audio
- Send to voicemail
- Conference calls

## Key Files and Locations

### Backend Service (Railway)

```
jambonz-ws-service/
├── handlers/
│   └── twilio-handler.js         # Main Twilio webhook handler
├── shared/
│   ├── agent-config.js            # System prompt loading/interpolation
│   └── tool-handlers.js           # HTTP tool endpoint logic
├── scripts/
│   ├── create_ultravox_tools.js   # Create durable tools in Ultravox
│   └── create_pet_breeds_corpus.js # Upload corpus to Ultravox
├── migrations/
│   ├── create_twilio_ultravox_calls_mapping.sql
│   └── add_system_prompt_to_clients.sql
└── ai-agent-definitions/
    ├── humber_vet_ultravox_compliant.md  # Default prompt template
    └── popularPetsCorpus.json            # Pet breeds data
```

### Database Migrations

```
migrations/
├── create_twilio_ultravox_calls_mapping.sql  # Call ID mapping table
└── add_system_prompt_to_clients.sql          # Add prompt fields to clients
```

### Scripts

```
scripts/
├── create_ultravox_tools.js       # Creates durable tools via Ultravox API
├── create_pet_breeds_corpus.js    # Uploads corpus to Ultravox
└── rename_corpus.js                # Updates corpus metadata
```

## Environment Variables

### Required (Railway)

```bash
# Ultravox
ULTRAVOX_API_KEY=<api_key>

# Twilio
TWILIO_ACCOUNT_SID=<account_sid>
TWILIO_AUTH_TOKEN=<auth_token>

# Supabase
SUPABASE_URL=<project_url>
SUPABASE_SERVICE_KEY=<service_key>

# Backend
BASE_URL=https://jambonz-ws-service-production.up.railway.app
PORT=3000
```

## API Endpoints

### Twilio Webhooks (Railway)

```
POST /twilio/incoming            # Incoming call handler (returns TwiML <Stream>)
POST /twilio/transferToOnCall    # Transfer tool endpoint
POST /twilio/collectCallerInfo   # Callback info collection
POST /twilio/hangUp              # Hang up tool endpoint
GET  /health                     # Health check
```

### Ultravox API (External)

```
POST https://api.ultravox.ai/api/calls           # Create call
POST https://api.ultravox.ai/api/tools           # Create durable tool
POST https://api.ultravox.ai/api/corpora         # Create corpus
PATCH https://api.ultravox.ai/api/corpora/{id}   # Update corpus
```

## Data Flow Examples

### Example 1: Emergency Transfer

```
1. Caller: "My dog ate chocolate!"
2. AI recognizes urgency, decides to transfer
3. AI invokes: transferFromAiTriageWithMetadata(
     urgency_reason="Dog ingested chocolate",
     caller_name="John Smith",
     callback_number="5551234567",
     pet_name="Max",
     species="Dog",
     breed="Labrador Retriever"
   )
4. Ultravox POST to /twilio/transferToOnCall
5. Backend extracts ultravox_call_id from X-Ultravox-Call-Token header
6. Backend queries: SELECT twilio_call_sid WHERE ultravox_call_id = ?
7. Backend calls Twilio API: client.calls(twilio_call_sid).update({twiml: <Dial>...})
8. Twilio transfers call to on-call vet
9. Backend stores transfer details in call_logs
10. Backend responds 200 OK to Ultravox
11. AI: "I'm transferring you now..."
```

### Example 2: Pet Breed Lookup

```
1. AI: "What kind of pet is Max?"
2. Caller: "He's a golden retriever"
3. AI invokes: queryCorpus(query="golden retriever")
4. Ultravox searches corpus ID 95d3ce86-4bfd-45e9-8e13-4b9d6748f949
5. Returns: "Golden Retriever - Dog, Large, Common Names: Golden"
6. AI: "Okay, so that's a Golden Retriever, is that correct?"
7. Caller: "Yes"
8. AI proceeds with breed confirmed
```

## Deployment

### CI/CD Pipeline

```
1. Developer pushes to GitHub (main branch)
2. Railway detects push
3. Railway builds Docker image
4. Railway deploys to production
5. Health check confirms service is up
6. Old instance is terminated
```

**Important**: Deploy via `git push`, NOT `railway up`

### Deployment Commands

```bash
# Commit changes
git add .
git commit -m "Your commit message"

# Deploy to production (triggers Railway CI/CD)
git push origin main

# Monitor deployment
railway logs --service jambonz-ws-service
```

## Monitoring and Debugging

### Railway Logs

```bash
# Real-time logs
railway logs --service jambonz-ws-service

# Filter for specific events
railway logs | grep "Creating Ultravox call"
railway logs | grep "transferToOnCall"
railway logs | grep "ERROR"
```

### Key Log Patterns

```
✓ Good:
- "Creating Ultravox call for client: Humber Veterinary Clinic"
- "Received transferToOnCall tool call"
- "Successfully updated Twilio call"
- "HTTP routes ready"

⚠ Issues:
- "Failed to create Ultravox call"
- "Could not find twilio_call_sid for ultravox_call_id"
- "Twilio API error"
- "Database query failed"
```

### Ultravox Dashboard

View at `ultravox.ai/dashboard`:
- Call transcripts
- Tool invocations
- Call duration
- Corpus queries
- Error logs

### Supabase Dashboard

View at `supabase.com`:
- Table editor (clients, call_logs, twilio_ultravox_calls)
- SQL editor for queries
- Real-time subscriptions
- Database logs

## Testing

### Test Call Flow

1. Call (289) 473-0151
2. Verify AI answers with greeting
3. Test pet breed lookup: "I have a German Shepherd"
4. Verify AI uses queryCorpus and confirms breed
5. Test transfer: "It's an emergency"
6. Verify call transfers to on-call number

### Test Tools Directly

```bash
# Test transfer endpoint
curl -X POST https://jambonz-ws-service-production.up.railway.app/twilio/transferToOnCall \
  -H "Content-Type: application/json" \
  -H "X-Ultravox-Call-Token: test-call-id" \
  -d '{
    "urgency_reason": "Test emergency",
    "caller_name": "Test User",
    "callback_number": "5551234567"
  }'
```

## Troubleshooting

### Common Issues

**Issue**: AI doesn't answer call
- Check Railway logs for Ultravox call creation
- Verify ULTRAVOX_API_KEY is valid
- Check Twilio webhook URL configuration

**Issue**: Transfer doesn't work
- Verify twilio_ultravox_calls mapping exists
- Check TWILIO_AUTH_TOKEN is valid
- Ensure on-call number is correct

**Issue**: Corpus not working
- Verify corpusIds in call config
- Check corpus ID is correct
- Ensure corpus has documents uploaded

**Issue**: Tool not found
- Check tool names match exactly
- Verify tools were created with create_ultravox_tools.js
- Check Ultravox dashboard for tool list

## Security Considerations

1. **API Keys**: Store in Railway environment variables
2. **Webhook Security**: Validate X-Ultravox-Call-Token header
3. **Database**: Use service key only on backend
4. **HTTPS**: All endpoints must use HTTPS
5. **Call Recording**: Ensure compliance with recording laws

## Future Enhancements

- [ ] Multi-language support
- [ ] Voicemail transcription with AI
- [ ] Analytics dashboard
- [ ] Business hours automation
- [ ] SMS notifications
- [ ] Call recording analysis
- [ ] Custom vocabulary per client
- [ ] Integration with practice management systems

## Resources

- **Ultravox API Docs**: https://docs.ultravox.ai
- **Twilio Docs**: https://www.twilio.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **Railway Docs**: https://docs.railway.app

## Support

For questions or issues:
1. Check Railway logs first
2. Review Ultravox dashboard
3. Query Supabase database
4. Check GitHub issues
5. Contact VetWise support

---

**Last Updated**: 2025-01-29
**Architecture Version**: 2.0 (Direct Twilio→Ultravox)
**Production Status**: Active
