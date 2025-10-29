-- Create table to map Ultravox calls to Twilio calls
-- This enables durable tools to retrieve the Twilio CallSid when invoked by Ultravox

CREATE TABLE IF NOT EXISTS twilio_ultravox_calls (
  id BIGSERIAL PRIMARY KEY,
  twilio_call_sid VARCHAR(34) NOT NULL UNIQUE,
  ultravox_call_id VARCHAR(100) NOT NULL UNIQUE,
  from_number VARCHAR(20),
  to_number VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_ultravox_call_id ON twilio_ultravox_calls(ultravox_call_id);
CREATE INDEX idx_twilio_call_sid ON twilio_ultravox_calls(twilio_call_sid);

COMMENT ON TABLE twilio_ultravox_calls IS 'Maps Ultravox call IDs to Twilio Call SIDs for durable tool invocations';
COMMENT ON COLUMN twilio_ultravox_calls.twilio_call_sid IS 'Twilio Call SID (unique identifier for the Twilio call)';
COMMENT ON COLUMN twilio_ultravox_calls.ultravox_call_id IS 'Ultravox call ID returned when creating the call';
COMMENT ON COLUMN twilio_ultravox_calls.from_number IS 'Caller phone number';
COMMENT ON COLUMN twilio_ultravox_calls.to_number IS 'Called number (VetWise number dialed)';
