-- Migration: Add Ultravox sync tracking and trigger
-- Purpose: Automatically mark agents for sync when system_prompt or agent_voice changes

-- 1. Add sync tracking columns to clients table
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS prompt_needs_sync BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS prompt_last_synced TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS prompt_sync_error TEXT;

-- 2. Create function to mark agent for sync when prompt changes
CREATE OR REPLACE FUNCTION mark_agent_for_sync()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if system_prompt or agent_voice changed
  IF (NEW.system_prompt IS DISTINCT FROM OLD.system_prompt) OR 
     (NEW.agent_voice IS DISTINCT FROM OLD.agent_voice) THEN
    
    NEW.prompt_needs_sync = TRUE;
    NEW.prompt_sync_error = NULL;  -- Clear previous errors
    
    -- Log the change
    RAISE NOTICE 'Agent sync needed for client %: prompt or voice changed', NEW.name;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger on clients table
DROP TRIGGER IF EXISTS on_agent_config_change ON clients;

CREATE TRIGGER on_agent_config_change
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION mark_agent_for_sync();

-- Migration: Add Ultravox sync tracking and trigger
-- Purpose: Automatically mark agents for sync when system_prompt or agent_voice changes

-- 1. Add sync tracking columns to clients table
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS prompt_needs_sync BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS prompt_last_synced TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS prompt_sync_error TEXT;

-- 2. Create function to mark agent for sync when prompt changes
CREATE OR REPLACE FUNCTION mark_agent_for_sync()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if system_prompt or agent_voice changed
  IF (NEW.system_prompt IS DISTINCT FROM OLD.system_prompt) OR 
     (NEW.agent_voice IS DISTINCT FROM OLD.agent_voice) THEN
    
    NEW.prompt_needs_sync = TRUE;
    NEW.prompt_sync_error = NULL;  -- Clear previous errors
    
    -- Log the change
    RAISE NOTICE 'Agent sync needed for client %: prompt or voice changed', NEW.name;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger on clients table
DROP TRIGGER IF EXISTS on_agent_config_change ON clients;

CREATE TRIGGER on_agent_config_change
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION mark_agent_for_sync();

-- 4. Create function to manually mark client for sync (useful for admin tools)
CREATE OR REPLACE FUNCTION request_agent_sync(client_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE clients 
  SET prompt_needs_sync = TRUE,
      prompt_sync_error = NULL
  WHERE id = client_id_param;
END;
$$ LANGUAGE plpgsql;

-- 5. Create function to mark sync complete (called by sync script)
CREATE OR REPLACE FUNCTION mark_agent_synced(
  client_id_param UUID,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF success THEN
    UPDATE clients 
    SET prompt_needs_sync = FALSE,
        prompt_last_synced = NOW(),
        prompt_sync_error = NULL
    WHERE id = client_id_param;
  ELSE
    UPDATE clients 
    SET prompt_sync_error = error_message
    WHERE id = client_id_param;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Create view for agents needing sync
CREATE OR REPLACE VIEW agents_needing_sync AS
SELECT 
  id,
  name,
  ultravox_agent_id,
  system_prompt,
  agent_voice,
  prompt_needs_sync,
  prompt_last_synced,
  prompt_sync_error,
  updated_at
FROM clients
WHERE prompt_needs_sync = TRUE
  AND ultravox_agent_id IS NOT NULL
  AND system_prompt IS NOT NULL
ORDER BY updated_at DESC;

-- 7. Add helpful comments
COMMENT ON COLUMN clients.prompt_needs_sync IS 'TRUE when system_prompt or agent_voice changed and needs sync to Ultravox';
COMMENT ON COLUMN clients.prompt_last_synced IS 'Timestamp of last successful sync to Ultravox';
COMMENT ON COLUMN clients.prompt_sync_error IS 'Error message from last sync attempt (NULL if successful)';
COMMENT ON FUNCTION mark_agent_for_sync() IS 'Trigger function: marks agent for sync when prompt/voice changes';
COMMENT ON FUNCTION request_agent_sync(UUID) IS 'Manually request sync for a specific client';
COMMENT ON FUNCTION mark_agent_synced(UUID, BOOLEAN, TEXT) IS 'Mark agent as synced (called by sync script)';
COMMENT ON VIEW agents_needing_sync IS 'View of all agents that need syncing to Ultravox';
