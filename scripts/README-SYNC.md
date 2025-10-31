# Ultravox Agent Sync

This directory contains tools for syncing agent templates from Supabase to Ultravox.

## Quick Start

### Option 1: Manual Sync Script (Immediate Use)

```bash
# Sync all agents
python scripts/sync-ultravox-agents.py

# Sync specific agent by ID
python scripts/sync-ultravox-agents.py --agent-id abc123

# Sync by client name
python scripts/sync-ultravox-agents.py --client-name "Humber Veterinary Clinic"

# Preview changes without applying (dry run)
python scripts/sync-ultravox-agents.py --dry-run
```

### Option 2: Database Trigger (Automated)

1. **Apply the migration:**
```bash
# Via psql
psql $DATABASE_URL -f supabase/migrations/add_ultravox_sync_trigger.sql

# Or via Supabase CLI
supabase db push
```

2. **The trigger automatically marks agents for sync when you update:**
```sql
UPDATE clients 
SET system_prompt = 'New prompt with {{variables}}'
WHERE name = 'Humber Vet';
-- This sets prompt_needs_sync = TRUE automatically
```

3. **Run sync script to process marked agents:**
```bash
# Only syncs agents where prompt_needs_sync = TRUE
python scripts/sync-ultravox-agents.py
```

---

## Architecture

### Database Trigger Approach (Recommended)

**How it works:**
1. Admin updates `system_prompt` or `agent_voice` in Supabase
2. Trigger automatically sets `prompt_needs_sync = TRUE`
3. Background job (cron) runs every 5-15 minutes
4. Script syncs all agents where `prompt_needs_sync = TRUE`
5. Script calls `mark_agent_synced()` to clear the flag

**New Database Columns:**
- `prompt_needs_sync` - Boolean flag indicating sync needed
- `prompt_last_synced` - Timestamp of last successful sync
- `prompt_sync_error` - Error message from last sync attempt

**New Database Functions:**
- `mark_agent_for_sync()` - Trigger function
- `request_agent_sync(client_id)` - Manually request sync
- `mark_agent_synced(client_id, success, error)` - Mark sync complete

**New Database View:**
```sql
SELECT * FROM agents_needing_sync;
-- Shows all agents where prompt_needs_sync = TRUE
```

---

## Usage Examples

### Check which agents need syncing
```sql
SELECT name, ultravox_agent_id, prompt_needs_sync, prompt_last_synced 
FROM clients 
WHERE prompt_needs_sync = TRUE;
```

### Manually mark an agent for sync
```sql
SELECT request_agent_sync('client-uuid-here');
```

### View sync status for all clients
```sql
SELECT 
  name,
  ultravox_agent_id IS NOT NULL AS has_agent,
  prompt_needs_sync,
  prompt_last_synced,
  prompt_sync_error
FROM clients
ORDER BY name;
```

---

## Python Script Reference

### Command-Line Arguments

```
--agent-id AGENT_ID       Sync specific agent by ultravox_agent_id
--client-name NAME        Sync specific client by name  
--client-id UUID          Sync specific client by database ID
--dry-run                 Preview changes without applying
```

### Exit Codes

- `0` - Success (all agents synced or already in sync)
- `1` - Errors occurred during sync

### Script Output

```
============================================================
Ultravox Agent Sync Script
============================================================
Syncing ALL agents

Found 3 client(s) to sync

Syncing Humber Veterinary Clinic...
  Agent ID: abc123
  Voice: Jessica
  Prompt length: 1250 chars
  📝 Prompt changed (1180 → 1250 chars)
  ✅ Successfully synced

Syncing Downtown Vet...
  Agent ID: def456
  Voice: Jessica  
  Prompt length: 1100 chars
  ✓ Already in sync

⚠️  City Vet: No system_prompt in database

============================================================
SUMMARY
============================================================
✅ Successfully synced: 1
✓  Already in sync: 1
⚠️  Skipped: 1
```

---

## Integration with Sync Script

Update the script to call `mark_agent_synced()` after successful sync:

```python
# In sync_agent() function, after successful update:
if not dry_run:
    updated_agent = update_ultravox_agent(agent_id, system_prompt, agent_voice)
    
    # Mark as synced in database
    supabase.rpc('mark_agent_synced', {
        'client_id_param': client_data['id'],
        'success': True
    }).execute()
    
    print(f"  ✅ Successfully synced")
    return {'status': 'success'}
```

---

## Scheduled Sync (Production)

### Option A: Cron Job (Linux/Mac)

```bash
# Edit crontab
crontab -e

# Add line to run every 5 minutes
*/5 * * * * cd /path/to/jambonz-ws-service && /usr/bin/python3 scripts/sync-ultravox-agents.py >> /var/log/ultravox-sync.log 2>&1
```

### Option B: systemd Timer (Linux)

```ini
# /etc/systemd/system/ultravox-sync.timer
[Unit]
Description=Ultravox Agent Sync Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

### Option C: Node.js Cron (In Application)

```javascript
const cron = require('node-cron');
const {exec} = require('child_process');

// Run every 5 minutes
cron.schedule('*/5 * * * *', () => {
  exec('python3 scripts/sync-ultravox-agents.py', (error, stdout, stderr) => {
    if (error) {
      console.error(`Sync error: ${error}`);
      return;
    }
    console.log(stdout);
  });
});
```

---

## Monitoring

### Check sync health
```sql
-- Agents that haven't synced successfully
SELECT name, prompt_sync_error, updated_at
FROM clients
WHERE prompt_sync_error IS NOT NULL;

-- Time since last sync
SELECT 
  name,
  prompt_last_synced,
  NOW() - prompt_last_synced AS time_since_sync
FROM clients
WHERE ultravox_agent_id IS NOT NULL
ORDER BY prompt_last_synced DESC NULLS LAST;
```

### Alert on sync failures
```sql
-- Agents with sync errors in last 24 hours
SELECT name, prompt_sync_error, updated_at
FROM clients
WHERE prompt_sync_error IS NOT NULL
  AND updated_at > NOW() - INTERVAL '24 hours';
```

---

## Troubleshooting

### Agent not syncing

1. **Check if marked for sync:**
```sql
SELECT prompt_needs_sync, prompt_sync_error 
FROM clients WHERE name = 'Client Name';
```

2. **Manually trigger sync:**
```bash
python scripts/sync-ultravox-agents.py --client-name "Client Name"
```

3. **Check agent exists in Ultravox:**
```bash
curl "https://api.ultravox.ai/api/agents/AGENT_ID" \
  -H "X-API-Key: $ULTRAVOX_API_KEY"
```

### Sync script errors

**Error: No ultravox_agent_id configured**
- Solution: Set `ultravox_agent_id` in clients table

**Error: No system_prompt in database**
- Solution: Add system_prompt to client record

**Error: Agent not found in Ultravox**
- Solution: Create agent in Ultravox dashboard first, then store ID

---

## Best Practices

1. **Always test with --dry-run first:**
```bash
python scripts/sync-ultravox-agents.py --dry-run
```

2. **Sync immediately after prompt changes:**
```bash
# In admin UI, after saving prompt:
python scripts/sync-ultravox-agents.py --client-id $CLIENT_ID
```

3. **Monitor sync errors regularly:**
```sql
SELECT * FROM agents_needing_sync WHERE prompt_sync_error IS NOT NULL;
```

4. **Keep database and Ultravox in sync:**
- Use trigger for automatic marking
- Run sync job frequently (every 5-15 min)
- Alert on persistent sync errors

---

## Migration Path

If you already have agents in Ultravox:

1. **Apply database migration** (adds columns and trigger)
2. **Do initial sync** to verify everything works:
```bash
python scripts/sync-ultravox-agents.py --dry-run
```
3. **Set up scheduled job** (cron or systemd timer)
4. **Monitor sync health** for first week
5. **Adjust sync frequency** based on update patterns
