-- Add system_prompt and vetwise_phone columns to clients table
-- system_prompt: allows storing agent prompts per client in the database
-- vetwise_phone: the phone number VetWise provisions for this client (for routing lookup)

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS system_prompt TEXT,
ADD COLUMN IF NOT EXISTS vetwise_phone VARCHAR(20) UNIQUE;

COMMENT ON COLUMN clients.system_prompt IS 'Ultravox agent system prompt - supports {{variable}} interpolation for office_name, agent_name, office_hours, etc.';
COMMENT ON COLUMN clients.vetwise_phone IS 'VetWise-provisioned phone number for this client (used for routing lookup). Different from office_phone which is the client''s actual business number.';
