-- Migration: Clean up transfer routing schema after learning Elastic SIP trunk behavior
-- Purpose: Simplify schema now that we understand Elastic SIP trunks route via number association
-- Date: 2025-01-03

-- What we learned:
-- 1. Elastic SIP trunks (TK prefix) route automatically when destination number is associated with trunk
-- 2. No need for separate "aircall_sip_number" - just use primary_transfer_number
-- 3. No need for "twilio_aircall_trunk_sid" - trunk routing is handled by Twilio based on number association
-- 4. "primary_transfer_type" can be simplified - only need to distinguish SIP URIs from regular numbers

-- Drop unnecessary columns added in previous migration
ALTER TABLE clients
DROP COLUMN IF EXISTS aircall_sip_number,
DROP COLUMN IF EXISTS twilio_aircall_trunk_sid;

-- Update primary_transfer_type to reflect actual routing logic:
-- - 'sip_uri': For sip:user@domain (future Jambonz routing)
-- - 'phone': For regular phone numbers (PSTN or Elastic SIP trunk routing)
-- Update existing data
UPDATE clients
SET primary_transfer_type = CASE
  WHEN primary_transfer_number LIKE 'sip:%' OR primary_transfer_number LIKE 'sips:%' THEN 'sip_uri'
  ELSE 'phone'
END
WHERE primary_transfer_type IS NOT NULL;

-- Update column comment to reflect new simplified logic
COMMENT ON COLUMN clients.primary_transfer_type IS 'Transfer routing type: phone (PSTN or Elastic SIP trunk via number association) or sip_uri (for future Jambonz routing)';

-- Update call_logs transfer_type values to match new naming
UPDATE call_logs
SET transfer_type = 'phone'
WHERE transfer_type IN ('aircall_sip', 'pstn');

UPDATE call_logs
SET transfer_type = 'sip_uri'
WHERE transfer_type = 'other_sip';

-- Update column comments for call_logs
COMMENT ON COLUMN call_logs.transfer_type IS 'Type of transfer: phone (regular phone number) or sip_uri (SIP URI for Jambonz routing)';
COMMENT ON COLUMN call_logs.transfer_method IS 'Method used: twilio_phone (PSTN or Elastic SIP trunk) or jambonz (for SIP URIs)';

-- Summary of simplified schema:
--
-- clients.primary_transfer_number: The destination to dial (phone number or SIP URI)
-- clients.primary_transfer_type: 'phone' or 'sip_uri'
--
-- Routing logic:
-- - If primary_transfer_number starts with 'sip:' → Route via Jambonz (future)
-- - Otherwise → Dial normally via Twilio (PSTN or Elastic SIP trunk auto-routing)
