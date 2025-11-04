-- Add transfer_call_sid to track outbound bridging call
-- Used when we end the Ultravox stream and initiate a new outbound call to reconnect customer

ALTER TABLE call_logs
ADD COLUMN IF NOT EXISTS transfer_call_sid TEXT;

-- Index for looking up transfer calls
CREATE INDEX IF NOT EXISTS idx_call_logs_transfer_call_sid
ON call_logs(transfer_call_sid)
WHERE transfer_call_sid IS NOT NULL;

-- Comment
COMMENT ON COLUMN call_logs.transfer_call_sid IS 'Twilio call SID for the outbound bridging call (when Ultravox stream is ended and customer is reconnected)';
