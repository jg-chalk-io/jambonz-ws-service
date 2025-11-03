-- Add call_log_id to twilio_ultravox_calls mapping table
-- This allows direct linking from mapping to call_logs

ALTER TABLE twilio_ultravox_calls
ADD COLUMN IF NOT EXISTS call_log_id INTEGER REFERENCES call_logs(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_twilio_ultravox_calls_call_log_id
ON twilio_ultravox_calls(call_log_id);

-- Comment
COMMENT ON COLUMN twilio_ultravox_calls.call_log_id IS 'Link to call_logs table for complete call tracking';
