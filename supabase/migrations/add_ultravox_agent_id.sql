-- Add ultravox_agent_id column to clients table
-- This column stores the Ultravox Agent Template ID for each client
-- Templates are reusable configurations shared across multiple calls

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS ultravox_agent_id TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_clients_ultravox_agent_id
ON clients(ultravox_agent_id);

-- Add comment explaining usage
COMMENT ON COLUMN clients.ultravox_agent_id IS
'Ultravox Agent Template ID - reusable agent configuration. Each call creates a new instance with templateContext values.';

-- Show current state
SELECT id, name, ultravox_agent_id, system_prompt IS NOT NULL as has_prompt
FROM clients
ORDER BY name;
