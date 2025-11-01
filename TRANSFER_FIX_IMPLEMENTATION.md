# Transfer Fix Implementation Summary

## Problem
Transfer functionality failing because `call_sid` parameter is missing from tool invocations. The error was: "Missing call_sid in tool data".

## Root Cause
We were trying to pass `call_sid` through Ultravox's parameter system using:
1. Automatic parameters (failed - only accepts predefined enums)
2. Static parameters with template variable overrides (failed - parameter not overrideable)
3. Tool parameter overrides (failed - parameter doesn't exist in tool definition)

## Correct Solution
Instead of passing `call_sid` as a tool parameter, we should:
1. Store the mapping of `ultravox_call_id` → `twilio_call_sid` when creating calls
2. Extract the `X-Ultravox-Call-Token` header from HTTP tool requests
3. Look up the `twilio_call_sid` from the database using the Ultravox call ID

## Implementation Steps

### 1. Create Database Table (Migration Already Exists)
File: `/migrations/create_twilio_ultravox_calls_mapping.sql`
- Creates `twilio_ultravox_calls` table mapping ultravox_call_id → twilio_call_sid
- Uses `CREATE TABLE IF NOT EXISTS` so safe to run multiple times

### 2. Store Mapping When Creating Calls
In `twilio-handler.js` after creating Ultravox call (around line 326):
```javascript
const ultravoxResponse = await createUltravoxCallWithAgent(clientData.ultravox_agent_id, callConfig);
logger.info({callSid, ultravoxResponse}, 'Got Ultravox joinUrl');

// NEW: Store mapping
const {supabase} = require('./lib/supabase');
await supabase.from('twilio_ultravox_calls').insert({
  twilio_call_sid: callSid,
  ultravox_call_id: ultravoxResponse.callId,
  from_number: from,
  to_number: to
});
logger.info({callSid, ultravoxCallId: ultravoxResponse.callId}, 'Stored call mapping');
```

### 3. Modify Transfer Endpoint to Lookup call_sid
In `twilio-handler.js` in `handleTwilioTransfer` function (around line 342):
```javascript
async function handleTwilioTransfer(toolData, req, res) {
  try {
    // Extract Ultravox call ID from request header
    const ultravoxCallId = req.headers['x-ultravox-call-token'];

    if (!ultravoxCallId) {
      throw new Error('Missing X-Ultravox-Call-Token header');
    }

    // Look up Twilio call_sid from database
    const {supabase} = require('./lib/supabase');
    const {data: mapping, error: mappingError} = await supabase
      .from('twilio_ultravox_calls')
      .select('twilio_call_sid')
      .eq('ultravox_call_id', ultravoxCallId)
      .single();

    if (mappingError || !mapping) {
      throw new Error(`Could not find twilio_call_sid for ultravox_call_id: ${ultravoxCallId}`);
    }

    const call_sid = mapping.twilio_call_sid;
    const {to_phone_number, conversation_summary} = toolData;

    logger.info({
      ultravoxCallId,
      call_sid,
      to_phone_number,
      conversation_summary
    }, 'Handling Twilio transfer via REST API');

    // Rest of transfer logic continues...
```

### 4. Remove call_sid from Tool Parameters
The transfer tool no longer needs `call_sid` as a parameter. Update:
- `create_ultravox_tools.js` - Remove `call_sid` from staticParameters
- `sync-ultravox-agents.py` - Remove special handling for call_sid parameter override

### 5. Update Endpoint Route Handler
Ensure the transfer endpoint handler passes the `req` object:
```javascript
app.post('/twilio/transferToOnCall', async (req, res) => {
  await handleTwilioTransfer(req.body, req, res);  // Pass req object
});
```

## Benefits
1. **Simpler**: No fighting with Ultravox's parameter system
2. **Reliable**: Uses standard HTTP headers that Ultravox always sends
3. **Maintainable**: Clear separation of concerns
4. **Correct**: This is the intended pattern per claude-desktop.md documentation

## Testing
1. Ensure migration has been run
2. Make a test call
3. Request transfer during the call
4. Verify transfer works without "Missing call_sid" error
5. Check logs to confirm mapping is stored and lookup succeeds

## Files to Modify
1. `/migrations/create_twilio_ultravox_calls_mapping.sql` - Run migration
2. `twilio-handler.js` - Add mapping storage and lookup logic
3. `index.js` or route handler - Ensure `req` object is passed to transfer handler
