-- Add Ultravox tracking fields to call_logs and twilio_ultravox_calls

-- Add ultravox_call_id to call_logs if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'call_logs' AND column_name = 'ultravox_call_id'
    ) THEN
        ALTER TABLE call_logs ADD COLUMN ultravox_call_id TEXT;
        CREATE INDEX idx_call_logs_ultravox_call_id ON call_logs(ultravox_call_id);
        COMMENT ON COLUMN call_logs.ultravox_call_id IS 'Ultravox call identifier for linking to Ultravox events';
    END IF;
END $$;

-- Add call_log_id to twilio_ultravox_calls if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'twilio_ultravox_calls' AND column_name = 'call_log_id'
    ) THEN
        ALTER TABLE twilio_ultravox_calls ADD COLUMN call_log_id INTEGER REFERENCES call_logs(id);
        CREATE INDEX idx_twilio_ultravox_calls_call_log_id ON twilio_ultravox_calls(call_log_id);
        COMMENT ON COLUMN twilio_ultravox_calls.call_log_id IS 'Links to call_logs table for complete call history';
    END IF;
END $$;

-- Add start_time to call_logs if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'call_logs' AND column_name = 'start_time'
    ) THEN
        ALTER TABLE call_logs ADD COLUMN start_time TIMESTAMPTZ DEFAULT NOW();
        CREATE INDEX idx_call_logs_start_time ON call_logs(start_time DESC);
        COMMENT ON COLUMN call_logs.start_time IS 'When the call started';
    END IF;
END $$;

-- Add end_time to call_logs if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'call_logs' AND column_name = 'end_time'
    ) THEN
        ALTER TABLE call_logs ADD COLUMN end_time TIMESTAMPTZ;
        COMMENT ON COLUMN call_logs.end_time IS 'When the call ended';
    END IF;
END $$;

-- Add status to call_logs if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'call_logs' AND column_name = 'status'
    ) THEN
        ALTER TABLE call_logs ADD COLUMN status TEXT DEFAULT 'initiated';
        CREATE INDEX idx_call_logs_status ON call_logs(status);
        COMMENT ON COLUMN call_logs.status IS 'Call status: initiated, in-progress, completed, failed, no-answer';
    END IF;
END $$;
