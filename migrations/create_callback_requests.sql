-- Callback Requests Table
-- Stores callback/message requests for backend processing
-- Decouples tool execution from frontend posting for retry capability

CREATE TABLE IF NOT EXISTS callback_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Contact information
    callback_number TEXT NOT NULL,
    caller_name TEXT,
    pet_name TEXT,
    species TEXT,
    concern_description TEXT,

    -- Priority and routing
    urgency_level TEXT NOT NULL DEFAULT 'normal',  -- normal, urgent, critical
    call_sid TEXT,
    tool_call_log_id UUID REFERENCES tool_call_logs(id),

    -- Processing status
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, posted, failed, cancelled
    posted_to_frontend_at TIMESTAMPTZ,
    frontend_response JSONB,
    error_message TEXT,

    -- Retry tracking
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,

    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb,

    CHECK (status IN ('pending', 'posted', 'failed', 'cancelled')),
    CHECK (urgency_level IN ('normal', 'urgent', 'critical'))
);

-- Indexes for performance
CREATE INDEX idx_callback_requests_status ON callback_requests(status);
CREATE INDEX idx_callback_requests_created_at ON callback_requests(created_at DESC);
CREATE INDEX idx_callback_requests_urgency_level ON callback_requests(urgency_level);
CREATE INDEX idx_callback_requests_callback_number ON callback_requests(callback_number);
CREATE INDEX idx_callback_requests_next_retry_at ON callback_requests(next_retry_at) WHERE status = 'failed';

-- Update timestamp trigger
CREATE TRIGGER trigger_update_callback_requests_updated_at
    BEFORE UPDATE ON callback_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_tool_call_logs_updated_at();  -- Reuse existing function

-- Comments
COMMENT ON TABLE callback_requests IS 'Callback/message requests for backend processing and retry';
COMMENT ON COLUMN callback_requests.status IS 'Processing status: pending (not posted), posted (successfully sent to frontend), failed (posting failed), cancelled';
COMMENT ON COLUMN callback_requests.tool_call_log_id IS 'Links to tool_call_logs for complete audit trail';
COMMENT ON COLUMN callback_requests.next_retry_at IS 'When to retry posting if failed (exponential backoff)';
