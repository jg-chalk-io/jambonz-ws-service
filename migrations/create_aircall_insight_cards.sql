-- Aircall Insight Cards Tracking
-- Logs all insight cards sent when calls are transferred to Aircall
-- Uses Ring-to (via API) widget to get call_id before routing

CREATE TABLE IF NOT EXISTS aircall_insight_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Aircall identifiers (from Ring-to API request)
    aircall_call_id TEXT NOT NULL,
    caller_number TEXT NOT NULL,
    target_number TEXT,

    -- Our system linkage
    tool_call_log_id UUID REFERENCES tool_call_logs(id),
    ultravox_call_id TEXT,
    twilio_call_sid TEXT,
    call_log_id INTEGER REFERENCES call_logs(id),

    -- Insight card data (denormalized for easy querying)
    caller_name TEXT,
    caller_concern TEXT,
    pet_name TEXT,
    urgency_level TEXT,
    card_content JSONB NOT NULL,

    -- Routing decision
    routed_to_type TEXT,  -- 'team', 'user', 'number'
    routed_to_id TEXT,

    -- Status tracking
    card_sent_at TIMESTAMPTZ,
    card_status TEXT NOT NULL DEFAULT 'pending',  -- pending, success, failed, no_match, skipped
    aircall_response JSONB,
    error_message TEXT,

    -- Performance tracking (must be <3000ms for Aircall)
    processing_time_ms INTEGER,

    CHECK (card_status IN ('pending', 'success', 'failed', 'no_match', 'skipped'))
);

-- Indexes for common queries
CREATE INDEX idx_aircall_insights_call_id ON aircall_insight_cards(aircall_call_id);
CREATE INDEX idx_aircall_insights_caller_number ON aircall_insight_cards(caller_number);
CREATE INDEX idx_aircall_insights_tool_call_log ON aircall_insight_cards(tool_call_log_id);
CREATE INDEX idx_aircall_insights_created_at ON aircall_insight_cards(created_at DESC);
CREATE INDEX idx_aircall_insights_status ON aircall_insight_cards(card_status);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_aircall_insight_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_aircall_insight_cards_updated_at
    BEFORE UPDATE ON aircall_insight_cards
    FOR EACH ROW
    EXECUTE FUNCTION update_aircall_insight_cards_updated_at();

-- Comments
COMMENT ON TABLE aircall_insight_cards IS 'Tracks insight cards sent to Aircall agents for transferred calls via Ring-to API widget';
COMMENT ON COLUMN aircall_insight_cards.aircall_call_id IS 'Aircall call ID from Ring-to API request';
COMMENT ON COLUMN aircall_insight_cards.caller_number IS 'Caller phone number (normalized to E.164)';
COMMENT ON COLUMN aircall_insight_cards.card_status IS 'Status: pending, success, failed, no_match (no transfer found), skipped';
COMMENT ON COLUMN aircall_insight_cards.processing_time_ms IS 'Time from Ring-to request to response (must be <3000ms for Aircall timeout)';
COMMENT ON COLUMN aircall_insight_cards.card_content IS 'Full insight card content sent to Aircall API';
COMMENT ON COLUMN aircall_insight_cards.routed_to_type IS 'Routing target type returned to Aircall: team, user, or number';
