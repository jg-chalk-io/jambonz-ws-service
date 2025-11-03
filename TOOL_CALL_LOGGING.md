# Tool Call Logging System

## Overview

Comprehensive tool call logging system that ensures **no customer callback is lost**, even if tools fail or frontend posting fails.

## Architecture

```
Ultravox Tool Call → Tool Handler → Database Logging → Backend Worker → Frontend API
                                          ↓                   ↓
                                    tool_call_logs    callback_requests
                                          ↓                   ↓
                                     Audit Trail        Retry Queue
```

## Database Schema

### `tool_call_logs` Table

**Purpose**: Complete audit trail of all tool invocations

**Fields**:
- `id` - UUID primary key
- `tool_name` - Name of invoked tool
- `tool_parameters` - JSONB of parameters passed
- `ultravox_call_id` - Ultravox call identifier
- `twilio_call_sid` - Twilio call SID (if available)
- `callback_number` - Customer phone number
- `caller_name` - Customer name
- `urgency_level` - normal, urgent, critical
- `status` - pending, success, failed, retrying
- `error_message` - Error details if failed
- `retry_count` / `max_retries` - Retry tracking
- `tool_data` - Complete tool invocation data for retry
- `result` - Tool execution result
- `processed_at` - When tool completed
- `created_at` / `updated_at` - Timestamps

**Indexes**:
- By status (for querying failures)
- By created_at (for time-based queries)
- By ultravox_call_id / twilio_call_sid (for call tracking)
- By callback_number (for customer lookup)

### `callback_requests` Table

**Purpose**: Queue for frontend posting with retry capability

**Fields**:
- `id` - UUID primary key
- `callback_number` - Customer phone number
- `caller_name` - Customer name
- `pet_name`, `species`, `concern_description` - Call details
- `urgency_level` - normal, urgent, critical
- `call_sid` - Associated call SID
- `tool_call_log_id` - Links to tool_call_logs
- `status` - pending, posted, failed, cancelled
- `posted_to_frontend_at` - When successfully posted
- `frontend_response` - Response from frontend API
- `error_message` - Error details if failed
- `retry_count` / `max_retries` - Retry tracking
- `next_retry_at` - Scheduled retry time (exponential backoff)
- `metadata` - Additional data
- `created_at` / `updated_at` - Timestamps

**Indexes**:
- By status (for pending/failed queries)
- By urgency_level (for priority sorting)
- By next_retry_at (for retry scheduling)
- By callback_number (for customer lookup)

## Tool Call Flow

### 1. Transfer Tool (`transferFromAiTriageWithMetadata`)

```javascript
// In twilio-handler.js
async function handleTwilioTransfer(toolData, req, res) {
  let logId = null;

  try {
    // 1. LOG IMMEDIATELY to database
    logId = await ToolCallLogger.logToolCall({
      toolName: 'transferFromAiTriageWithMetadata',
      toolParameters: toolData,
      callbackNumber: toolData.callback_number,
      callerName: toolData.caller_name,
      urgencyLevel: 'critical',  // Transfer = critical
      toolData: {...}
    });

    // 2. Execute transfer
    await performTransfer(call_sid, to_phone_number, toolData, res);

    // 3. Mark as successful
    await ToolCallLogger.logSuccess(logId, {
      transfer_completed_at: new Date().toISOString()
    });

  } catch (err) {
    // 4. Mark as failed - ENABLES CALLBACK
    await ToolCallLogger.logFailure(logId, err.message, {...});
  }
}
```

**Key Points**:
- Logs **before** executing transfer
- If transfer fails → logged with callback_number
- Enables customer callback for failed transfers

### 2. Collect Info Tool (`collectNameNumberConcernPetName`)

```javascript
// In shared/tool-handlers.js
async function handleCollectCallerInfo(data, res) {
  let logId = null;

  try {
    // 1. LOG tool call
    logId = await ToolCallLogger.logToolCall({
      toolName: 'collectNameNumberConcernPetName',
      toolParameters: data,
      callbackNumber: data.callback_number,
      callerName: data.caller_name,
      urgencyLevel: 'normal',  // Message = normal
      toolData: {...}
    });

    // 2. Store in callback_requests for backend processing
    await supabase.from('callback_requests').insert({
      callback_number: data.callback_number,
      caller_name: data.caller_name,
      concern_description: data.concern_description,
      urgency_level: 'normal',
      tool_call_log_id: logId,
      status: 'pending'  // Backend worker will process
    });

    // 3. Mark tool call as successful
    await ToolCallLogger.logSuccess(logId, {
      callback_request_stored: true
    });

  } catch (err) {
    // 4. Mark as failed
    await ToolCallLogger.logFailure(logId, err.message, {...});
  }
}
```

**Key Points**:
- Logs tool call for audit
- Stores callback request for **backend processing**
- Decouples tool execution from frontend posting
- If frontend posting fails → retry automatically

## Backend Worker

### Purpose

Process `callback_requests` table and post to frontend with retry

### Features

1. **Polling**: Checks for pending/failed requests every 30 seconds
2. **Priority Sorting**: Critical > Urgent > Normal, then oldest first
3. **Exponential Backoff**: 5min → 15min → 1hour retry delays
4. **Max Retries**: 3 attempts before permanent failure
5. **Batch Processing**: Process up to 10 requests per run
6. **Error Logging**: All attempts logged for debugging

### Usage

```bash
# Run once (manual processing)
node scripts/process_callback_requests.js

# Run continuously (daemon mode)
node scripts/process_callback_requests.js --daemon

# With custom settings
CALLBACK_POLL_INTERVAL_MS=60000 \
CALLBACK_BATCH_SIZE=20 \
FRONTEND_CALLBACK_API_URL=https://your-frontend.com/api/callbacks \
FRONTEND_API_KEY=your-key \
node scripts/process_callback_requests.js --daemon
```

### Environment Variables

```bash
# Frontend API configuration
FRONTEND_CALLBACK_API_URL=https://your-frontend.com/api/callbacks
FRONTEND_API_KEY=your-api-key

# Worker configuration
CALLBACK_POLL_INTERVAL_MS=30000   # 30 seconds
CALLBACK_BATCH_SIZE=10             # Max requests per batch
```

### Deployment (Railway)

Add to `Procfile` or create separate Railway service:

```
worker: node scripts/process_callback_requests.js --daemon
```

## Setup Instructions

### 1. Apply Migrations

```bash
cd jambonz-ws-service

# Set DATABASE_URL to your Supabase connection string
export DATABASE_URL="postgresql://..."

# Apply migrations
chmod +x scripts/apply_tool_logging_migrations.sh
./scripts/apply_tool_logging_migrations.sh
```

### 2. Update Environment Variables

Add to Railway/local .env:

```bash
# Frontend API (required for worker)
FRONTEND_CALLBACK_API_URL=https://your-frontend.com/api/callbacks
FRONTEND_API_KEY=your-secret-key

# Worker settings (optional)
CALLBACK_POLL_INTERVAL_MS=30000
CALLBACK_BATCH_SIZE=10
```

### 3. Deploy Code

```bash
git add .
git commit -m "Add tool call logging system"
git push origin main
```

Railway will auto-deploy the updated handlers.

### 4. Start Backend Worker

**Option A: Local Development**
```bash
node scripts/process_callback_requests.js --daemon
```

**Option B: Separate Railway Service**
1. Create new Railway service
2. Link to same GitHub repo
3. Set Start Command: `node scripts/process_callback_requests.js --daemon`
4. Add environment variables

**Option C: Same Railway Service (if allowed)**
Add to `Procfile`:
```
web: node twilio-handler.js
worker: node scripts/process_callback_requests.js --daemon
```

## Monitoring and Debugging

### Query Failed Tool Calls

```sql
-- Get all failed tool calls with callback info
SELECT
  id,
  tool_name,
  caller_name,
  callback_number,
  urgency_level,
  error_message,
  retry_count,
  created_at
FROM tool_call_logs
WHERE status = 'failed'
ORDER BY urgency_level DESC, created_at ASC;
```

### Query Pending Callbacks

```sql
-- Get pending callback requests
SELECT
  id,
  caller_name,
  callback_number,
  concern_description,
  urgency_level,
  retry_count,
  next_retry_at,
  created_at
FROM callback_requests
WHERE status IN ('pending', 'failed')
ORDER BY urgency_level DESC, created_at ASC;
```

### Check Processing Stats

```sql
-- Tool call statistics
SELECT
  tool_name,
  status,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries
FROM tool_call_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY tool_name, status;

-- Callback request statistics
SELECT
  status,
  urgency_level,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries
FROM callback_requests
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status, urgency_level;
```

## Benefits

1. **No Lost Callbacks**: Every tool call logged, even if tool fails
2. **Automatic Retry**: Failed postings retry automatically with backoff
3. **Priority Handling**: Critical/urgent requests processed first
4. **Complete Audit Trail**: Full history of all tool invocations
5. **Decoupled Processing**: Tool execution independent of frontend posting
6. **Debugging**: Easy to identify and fix issues
7. **Manual Intervention**: Can manually retry or cancel failed requests

## Error Scenarios

### Scenario 1: Transfer Tool Fails

1. Transfer attempted, Twilio API returns error
2. Tool call logged with status=`failed`, callback_number stored
3. You can query `tool_call_logs` to find failed transfers
4. Manually call customer from dashboard

### Scenario 2: Frontend API Down

1. Callback request stored with status=`pending`
2. Worker tries to post to frontend → fails
3. Request marked status=`failed`, next_retry_at set
4. Worker retries after 5 minutes → succeeds
5. Request marked status=`posted`

### Scenario 3: Database Temporarily Down

1. Tool handler tries to log → fails silently (doesn't crash)
2. Tool continues executing
3. No log created (unfortunate but rare)
4. Application still works, just no audit trail

## Future Enhancements

1. **Admin Dashboard**: View/retry failed callbacks from UI
2. **SMS Notifications**: Alert staff when callbacks fail
3. **Priority Queue**: Separate queues for critical/urgent/normal
4. **Dead Letter Queue**: Permanent failures → manual review queue
5. **Metrics**: Grafana dashboard for tool call success rates
6. **Webhook Fallback**: If frontend down, post to backup webhook

## Questions?

Check logs in Railway:
```bash
cd jambonz-ws-service
railway logs --follow
```

Look for:
- `"Tool call logged to database"` - Successful logging
- `"Tool call marked as success"` - Tool completed
- `"Tool call marked as failed - callback needed"` - Tool failed, needs callback
- `"Successfully posted to frontend"` - Worker posted successfully
- `"Scheduling retry"` - Worker will retry later
