# Architecture Overview

## Problem Statement

Jambonz's HTTP webhook `toolHook` for LLM verbs sends minimal payloads containing only:
- `tool_call_id` - Unique identifier for the tool invocation
- `name` - Tool name (e.g., "transferToOnCall")
- `args` - Tool parameters

**Critically missing:**
- `call_sid` - Call identifier
- `account_sid` - Account identifier
- Any session context

This makes multi-tenant routing impossible with HTTP webhooks, as there's no way to identify which client/tenant the tool call belongs to.

## Solution: WebSocket with Session Objects

The Jambonz Node.js WebSocket SDK provides **session objects** that maintain full call context throughout the call lifecycle.

### Session Object Structure

```javascript
{
  call_sid: 'uuid-string',           // Call identifier
  account_sid: 'uuid-string',        // Jambonz account
  from: '+15551234567',              // Caller number
  to: '+15559876543',                // Called number
  direction: 'inbound',              // Call direction
  locals: {                          // Custom application data
    logger: pinoLogger,
    client: {...},                   // Our client/tenant object
    // ... any other app-specific data
  }
}
```

### How Tool Calls Work

1. **Call Initiated**: Jambonz establishes WebSocket connection
2. **Session Created**: `session:new` event fired with full context
3. **Handlers Registered**: Tool handlers bound to session
   ```javascript
   session.on('/toolCall', handleToolCall.bind(null, session))
   ```
4. **Tool Invoked**: When AI calls a tool, handler receives BOTH:
   - `session` - Full call context
   - `evt` - Tool call event (`{name, args, tool_call_id}`)
5. **Client Lookup**: Use `session.locals.client` (stored on incoming call)
6. **Execute Action**: Transfer, log, etc. with full context

## Architecture Diagram

```
┌─────────────────┐
│   Phone Call    │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────────────┐
│            Jambonz Platform                 │
│  ┌─────────────────────────────────────┐   │
│  │  WebSocket Connection (Persistent)  │   │
│  └──────────────┬──────────────────────┘   │
└─────────────────┼──────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│      jambonz-ws-service (Node.js)           │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │   Session Manager                    │  │
│  │   - Maintains call context           │  │
│  │   - Routes events to handlers        │  │
│  └─────────┬────────────────────────────┘  │
│            │                                 │
│   ┌────────┴────────┐                       │
│   │                 │                       │
│   ↓                 ↓                       │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ Incoming Call│  │  Tool Call   │        │
│  │   Handler    │  │   Handler    │        │
│  └───────┬──────┘  └──────┬───────┘        │
│          │                 │                 │
│          ↓                 ↓                 │
│  ┌─────────────────────────────────────┐   │
│  │       Session with Context           │   │
│  │  {call_sid, account_sid, client}    │   │
│  └─────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │   Supabase DB       │
         │  - clients          │
         │  - call_logs        │
         └─────────────────────┘
```

## Key Components

### 1. WebSocket Server (`index.js`)
- Creates HTTP server with WebSocket endpoint
- Listens on `/ws` path
- Handles `session:new` events for incoming calls
- Manages graceful shutdown

### 2. Session Handlers

#### `handlers/incoming-call.js`
- First handler when call arrives
- Looks up client by `account_sid`
- Stores client in `session.locals.client`
- Generates personalized system prompt
- Initiates LLM session with Ultravox

#### `handlers/tool-call.js`
- Receives `(session, evt)` parameters
- Accesses client from `session.locals.client`
- Routes to specific tool implementation
- Has full context for database operations

#### `handlers/llm-complete.js`
- Handles LLM session completion
- Updates call logs

#### `handlers/call-status.js`
- Processes call status updates
- Tracks call duration

### 3. Data Models

#### `models/Client.js`
- `getByAccountSid()` - Primary lookup method
- `getByPhoneNumber()` - For DID-based routing
- `getDefaultClient()` - Fallback for single-tenant

#### `models/CallLog.js`
- `create()` - Log call initiation
- `updateStatus()` - Track call progression
- `markTransferred()` - Record transfers

### 4. Business Logic

#### `lib/business-hours.js`
- `isOpen(client)` - Check if client is currently open
- Handles timezones, special closures
- Returns appropriate system prompts

#### `lib/supabase.js`
- Singleton Supabase client
- Used by all models

## Data Flow: Transfer Tool Call

```
1. User says "I need to speak with someone now"
   ↓
2. Ultravox AI recognizes urgency
   ↓
3. AI invokes transferToOnCall tool
   ↓
4. Jambonz sends toolHook event to /toolCall
   ↓
5. handleToolCall(session, evt) called
   ├─ session: {call_sid, locals: {client: {...}}}
   └─ evt: {name: "transferToOnCall", args: {}, tool_call_id}
   ↓
6. Extract client from session.locals.client
   ↓
7. Get transfer number from client.transfer_primary_phone
   ↓
8. Update call_logs: transferred_to_human = true
   ↓
9. Execute session.dial() with transfer parameters
   ↓
10. Call transferred with whisper announcement
```

## Comparison: HTTP vs WebSocket

### HTTP Webhooks (Previous - Flask)

**Incoming Call:**
```python
POST /incoming-call
{
  "call_sid": "abc123",
  "account_sid": "def456",
  "from": "+15551234567"
}
# Has context ✅
```

**Tool Call:**
```python
POST /tool-call
{
  "tool_call_id": "xyz789",
  "name": "transferToOnCall",
  "args": {}
}
# NO context ❌
# Can't identify client!
```

### WebSocket (New - Node.js)

**Incoming Call:**
```javascript
session:new event
session = {
  call_sid: "abc123",
  account_sid: "def456",
  from: "+15551234567"
}
// Has context ✅
// Store client in session.locals
```

**Tool Call:**
```javascript
session.on('/toolCall', (session, evt) => {
  // session has FULL context ✅
  const client = session.locals.client;
  // Can route correctly!
})
```

## Benefits of WebSocket Architecture

1. **Stateful Sessions**
   - Context persists throughout call
   - No need for external caching
   - Simpler application logic

2. **Multi-Tenant Support**
   - Each session knows its client
   - Tool calls have full routing context
   - Scales to unlimited tenants

3. **Real-Time Communication**
   - Bidirectional communication
   - Can send updates to Jambonz anytime
   - Lower latency than HTTP

4. **Cleaner Code**
   - No session cache management
   - No fallback strategies needed
   - Event-driven architecture

5. **Production Ready**
   - Used by Jambonz official examples
   - Recommended pattern for LLM apps
   - Battle-tested SDK

## Migration Strategy

### Phase 1: Deploy WebSocket Service (Done)
- ✅ Build Node.js WebSocket service
- ✅ Port all tool handlers
- ✅ Add deployment configurations
- ✅ Create documentation

### Phase 2: Deploy to Railway (Next)
- Create GitHub repository
- Deploy to Railway
- Configure environment variables
- Test health endpoint

### Phase 3: Switch Jambonz Config (After Testing)
- Update Jambonz application to WebSocket mode
- Point to new WebSocket URL
- Test with real calls
- Monitor for issues

### Phase 4: Cleanup (Optional)
- Keep Flask service for Ultravox webhooks
- Remove HTTP tool call endpoints from Flask
- Or migrate remaining webhooks to Node

## Performance Considerations

### Scalability
- Each connection uses ~10-20MB RAM
- Can handle 100+ concurrent calls per instance
- Railway auto-scales as needed

### Monitoring
- Log all tool calls with session context
- Track transfer success rates
- Monitor WebSocket connection health

### Error Handling
- Graceful degradation on database errors
- Automatic reconnection on WebSocket drops
- Comprehensive error logging

## Future Enhancements

1. **Redis Session Store**
   - Share sessions across multiple instances
   - Enable horizontal scaling

2. **Metrics Dashboard**
   - Real-time call volume
   - Transfer success rates
   - Client usage statistics

3. **Advanced Routing**
   - Dynamic client selection
   - Load balancing across agents
   - Priority routing

4. **WebRTC Integration**
   - Direct browser-to-Jambonz calls
   - Screen sharing during calls
   - Video support
