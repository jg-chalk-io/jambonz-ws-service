-- Migration: Add transfer routing configuration to clients and call_logs
-- Purpose: Support intelligent routing for Aircall SIP, other SIP, and PSTN transfers
-- Date: 2025-01-03

-- Add transfer routing fields to clients table
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS primary_transfer_type VARCHAR(20) DEFAULT 'pstn',
ADD COLUMN IF NOT EXISTS aircall_sip_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS twilio_aircall_trunk_sid VARCHAR(34) DEFAULT 'TK9e454ef3135d17201fc935de6cda56ec';

COMMENT ON COLUMN clients.primary_transfer_type IS 'Transfer routing type: aircall_sip, other_sip, or pstn';
COMMENT ON COLUMN clients.aircall_sip_number IS 'E.164 format phone number for Aircall SIP transfer (e.g., +13652972501)';
COMMENT ON COLUMN clients.twilio_aircall_trunk_sid IS 'Twilio SIP trunk ID for Aircall routing (default: TK9e454ef3135d17201fc935de6cda56ec)';

-- Add transfer tracking fields to call_logs table
ALTER TABLE call_logs
ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS transfer_method VARCHAR(20);

COMMENT ON COLUMN call_logs.transfer_type IS 'Type of transfer: aircall_sip, other_sip, or pstn';
COMMENT ON COLUMN call_logs.transfer_method IS 'Method used: twilio_sip, jambonz, or twilio_pstn';

-- Create index for transfer analytics
CREATE INDEX IF NOT EXISTS idx_call_logs_transfer_type ON call_logs(transfer_type);
CREATE INDEX IF NOT EXISTS idx_call_logs_transfer_method ON call_logs(transfer_method);
