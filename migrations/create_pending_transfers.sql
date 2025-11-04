-- Create pending_transfers table for TwiML flow control
-- Used to store transfer details when HTTP tool is invoked
-- Picked up by statusCallback when stream ends

CREATE TABLE IF NOT EXISTS pending_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    call_sid TEXT NOT NULL UNIQUE,
    ultravox_call_id TEXT,

    destination_number TEXT NOT NULL,
    caller_number TEXT,
    caller_name TEXT,
    urgency_reason TEXT,

    transfer_type TEXT,
    transfer_method TEXT,
    is_aircall BOOLEAN DEFAULT FALSE,

    CHECK (transfer_type IN ('phone', 'sip_uri'))
);

-- Index for fast lookups during statusCallback
CREATE INDEX IF NOT EXISTS idx_pending_transfers_call_sid
ON pending_transfers(call_sid);

-- Index for cleanup queries (without WHERE clause to avoid immutability issue)
CREATE INDEX IF NOT EXISTS idx_pending_transfers_created_at
ON pending_transfers(created_at);

COMMENT ON TABLE pending_transfers IS 'Temporary storage for transfer details during TwiML flow control - stores transfer info when HTTP tool invoked, executed by statusCallback when stream ends';
