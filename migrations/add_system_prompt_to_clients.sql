-- Add system_prompt column to clients table
-- This allows storing agent prompts per client in the database
-- instead of requiring code deployments for prompt updates

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS system_prompt TEXT;

COMMENT ON COLUMN clients.system_prompt IS 'Ultravox agent system prompt - supports {{variable}} interpolation for office_name, agent_name, office_hours, etc.';
