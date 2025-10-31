#!/usr/bin/env python3
"""
Sync Ultravox agent templates from Supabase clients table

Usage:
  python sync-ultravox-agents.py                    # Sync all agents
  python sync-ultravox-agents.py --agent-id abc123  # Sync specific agent
  python sync-ultravox-agents.py --client-name "Humber Vet"  # Sync by client name
  python sync-ultravox-agents.py --dry-run          # Preview changes without applying
"""
import os
import sys
import json
import argparse
import requests
from datetime import datetime
from supabase import create_client, Client
import dotenv

dotenv.load_dotenv()

# Load environment variables
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
ULTRAVOX_API_KEY = os.environ.get('ULTRAVOX_API_KEY')
BASE_URL = os.environ.get('BASE_URL', 'https://jambonz-ws-service-production.up.railway.app')

if not all([SUPABASE_URL, SUPABASE_SERVICE_KEY, ULTRAVOX_API_KEY]):
    print("ERROR: Missing required environment variables")
    print("  SUPABASE_URL, SUPABASE_SERVICE_KEY, ULTRAVOX_API_KEY")
    sys.exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_standard_tools():
    """Get standard tools that all agents should have"""
    return [
        {
            "temporaryTool": {
                "modelToolName": "transferToOnCall",
                "description": "Transfer the call to the on-call emergency team when the caller has an emergency or urgent situation that requires immediate veterinary attention. Use this when the situation cannot wait.",
                "dynamicParameters": [
                    {
                        "name": "conversation_summary",
                        "location": "PARAMETER_LOCATION_BODY",
                        "schema": {
                            "description": "Brief summary of the conversation and reason for transfer",
                            "type": "string"
                        },
                        "required": True
                    }
                ],
                "http": {
                    "baseUrlPattern": f"{BASE_URL}/twilio/transferToOnCall",
                    "httpMethod": "POST"
                }
            }
        }
    ]


def get_ultravox_agent(agent_id):
    """Fetch current agent template from Ultravox"""
    url = f"https://api.ultravox.ai/api/agents/{agent_id}"
    headers = {
        'X-API-Key': ULTRAVOX_API_KEY,
        'Content-Type': 'application/json'
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        return response.json()
    elif response.status_code == 404:
        return None
    else:
        raise Exception(f"Failed to fetch agent {agent_id}: {response.status_code} {response.text}")


def update_ultravox_agent(agent_id, system_prompt, voice=None, tools=None):
    """Update Ultravox agent template"""
    url = f"https://api.ultravox.ai/api/agents/{agent_id}"
    headers = {
        'X-API-Key': ULTRAVOX_API_KEY,
        'Content-Type': 'application/json'
    }

    payload = {
        'systemPrompt': system_prompt
    }

    if voice:
        payload['voice'] = voice

    if tools is not None:
        payload['selectedTools'] = tools

    response = requests.patch(url, headers=headers, json=payload)

    if response.status_code in [200, 201]:
        return response.json()
    else:
        raise Exception(f"Failed to update agent {agent_id}: {response.status_code} {response.text}")


def sync_agent(client_data, dry_run=False):
    """Sync a single agent"""
    agent_id = client_data.get('ultravox_agent_id')
    client_name = client_data.get('name')
    system_prompt = client_data.get('system_prompt')
    agent_voice = client_data.get('agent_voice') or 'Jessica'
    
    if not agent_id:
        print(f"⚠️  {client_name}: No ultravox_agent_id configured")
        return {'status': 'skipped', 'reason': 'no_agent_id'}
    
    if not system_prompt:
        print(f"⚠️  {client_name}: No system_prompt in database")
        return {'status': 'skipped', 'reason': 'no_system_prompt'}
    
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Syncing {client_name}...")
    print(f"  Agent ID: {agent_id}")
    print(f"  Voice: {agent_voice}")
    print(f"  Prompt length: {len(system_prompt)} chars")
    
    try:
        # Fetch current Ultravox agent
        current_agent = get_ultravox_agent(agent_id)
        
        if not current_agent:
            print(f"  ❌ Agent {agent_id} not found in Ultravox")
            return {'status': 'error', 'reason': 'agent_not_found'}
        
        current_prompt = current_agent.get('systemPrompt', '')
        current_voice = current_agent.get('voice', '')
        current_tools = current_agent.get('callTemplate', {}).get('selectedTools', [])

        # Get standard tools
        standard_tools = get_standard_tools()

        # Check if update needed
        prompt_changed = current_prompt != system_prompt
        voice_changed = current_voice != agent_voice
        tools_changed = json.dumps(current_tools, sort_keys=True) != json.dumps(standard_tools, sort_keys=True)

        if not prompt_changed and not voice_changed and not tools_changed:
            print(f"  ✓ Already in sync")
            return {'status': 'already_synced'}

        if prompt_changed:
            print(f"  📝 Prompt changed ({len(current_prompt)} → {len(system_prompt)} chars)")
        if voice_changed:
            print(f"  🔊 Voice changed ({current_voice} → {agent_voice})")
        if tools_changed:
            print(f"  🔧 Tools changed ({len(current_tools)} → {len(standard_tools)} tools)")

        if dry_run:
            print(f"  [DRY RUN] Would update agent template")
            return {'status': 'would_update', 'dry_run': True}

        # Update Ultravox
        updated_agent = update_ultravox_agent(
            agent_id,
            system_prompt,
            agent_voice,
            tools=standard_tools if tools_changed else None
        )

        # Mark as synced in database
        client_id = client_data.get('id')
        if client_id:
            try:
                supabase.table('clients').update({
                    'prompt_needs_sync': False,
                    'prompt_last_synced': datetime.now().isoformat(),
                    'prompt_sync_error': None
                }).eq('id', client_id).execute()
                print(f"  ✅ Successfully synced and marked as synced in database")
            except Exception as db_err:
                print(f"  ⚠️  Synced to Ultravox but failed to update database: {str(db_err)}")

        return {'status': 'success', 'updated_at': datetime.now().isoformat()}
        
    except Exception as e:
        print(f"  ❌ Error: {str(e)}")
        return {'status': 'error', 'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description='Sync Ultravox agents from Supabase')
    parser.add_argument('--agent-id', help='Sync specific agent by ultravox_agent_id')
    parser.add_argument('--client-name', help='Sync specific client by name')
    parser.add_argument('--client-id', help='Sync specific client by ID')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Ultravox Agent Sync Script")
    print("=" * 60)
    
    if args.dry_run:
        print("\n🔍 DRY RUN MODE - No changes will be made\n")
    
    # Build query
    query = supabase.table('clients').select('*')
    
    if args.agent_id:
        query = query.eq('ultravox_agent_id', args.agent_id)
        print(f"Filtering by agent_id: {args.agent_id}")
    elif args.client_name:
        query = query.eq('name', args.client_name)
        print(f"Filtering by client name: {args.client_name}")
    elif args.client_id:
        query = query.eq('id', args.client_id)
        print(f"Filtering by client ID: {args.client_id}")
    else:
        print("Syncing ALL agents")
    
    # Fetch clients
    response = query.execute()
    clients = response.data
    
    if not clients:
        print("\n❌ No clients found matching criteria")
        sys.exit(1)
    
    print(f"\nFound {len(clients)} client(s) to sync")
    
    # Sync each client
    results = {
        'success': 0,
        'already_synced': 0,
        'skipped': 0,
        'errors': 0,
        'would_update': 0
    }
    
    for client in clients:
        result = sync_agent(client, dry_run=args.dry_run)
        
        if result['status'] == 'success':
            results['success'] += 1
        elif result['status'] == 'already_synced':
            results['already_synced'] += 1
        elif result['status'] == 'skipped':
            results['skipped'] += 1
        elif result['status'] == 'would_update':
            results['would_update'] += 1
        else:
            results['errors'] += 1
    
    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if args.dry_run:
        print(f"Would update: {results['would_update']}")
    else:
        print(f"✅ Successfully synced: {results['success']}")
    
    print(f"✓  Already in sync: {results['already_synced']}")
    print(f"⚠️  Skipped: {results['skipped']}")
    
    if results['errors'] > 0:
        print(f"❌ Errors: {results['errors']}")
    
    print()
    
    sys.exit(0 if results['errors'] == 0 else 1)


if __name__ == '__main__':
    main()
