-- Tool Call Logs Table
-- Logs all tool invocations from Ultravox for reliability and callback retry
-- Allows backend retry system if tool fails or frontend posting fails

CREATE TABLE IF NOT EXISTS tool_call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Call identification
    ultravox_call_id TEXT,
    twilio_call_sid TEXT,
    call_log_id INTEGER REFERENCES call_logs(id),

    -- Tool information
    tool_name TEXT NOT NULL,
    tool_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Execution status
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, success, failed, retrying
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,

    -- Callback/contact information
    callback_number TEXT,
    caller_name TEXT,
    urgency_level TEXT,  -- normal, urgent, critical

    -- Tool-specific data
    tool_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Result tracking
    result JSONB,
    processed_at TIMESTAMPTZ,

    -- Indexes for common queries
    CHECK (status IN ('pending', 'success', 'failed', 'retrying'))
);

-- Indexes for performance
CREATE INDEX idx_tool_call_logs_status ON tool_call_logs(status);
CREATE INDEX idx_tool_call_logs_created_at ON tool_call_logs(created_at DESC);
CREATE INDEX idx_tool_call_logs_ultravox_call_id ON tool_call_logs(ultravox_call_id);
CREATE INDEX idx_tool_call_logs_twilio_call_sid ON tool_call_logs(twilio_call_sid);
CREATE INDEX idx_tool_call_logs_tool_name ON tool_call_logs(tool_name);
CREATE INDEX idx_tool_call_logs_callback_number ON tool_call_logs(callback_number) WHERE callback_number IS NOT NULL;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_tool_call_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_tool_call_logs_updated_at
    BEFORE UPDATE ON tool_call_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_tool_call_logs_updated_at();

-- Comments
COMMENT ON TABLE tool_call_logs IS 'Logs all tool calls from Ultravox for reliability, retry, and callback purposes';
COMMENT ON COLUMN tool_call_logs.status IS 'Current status: pending (not processed), success, failed, retrying';
COMMENT ON COLUMN tool_call_logs.urgency_level IS 'Used to prioritize callback retries: normal, urgent, critical';
COMMENT ON COLUMN tool_call_logs.tool_data IS 'Complete tool invocation data for retry purposes';
COMMENT ON COLUMN tool_call_logs.result IS 'Result from tool execution (success or error details)';
