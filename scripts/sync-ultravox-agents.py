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

# Durable tool IDs from Ultravox
# Map of tool names (as referenced in prompts) to their tool IDs
ULTRAVOX_TOOLS = {
    'transferFromAiTriageWithMetadata': 'c5835b78-7e5f-4515-a9fa-1d91c61fceea',
    'coldTransfer': '2fff509d-273f-414e-91ff-aa933435a545',
    'collectNameNumberConcernPetName': '4e0b0313-df50-4c18-aba1-bbf4acbfff88',
    'leaveVoicemail': '8721c74d-af3f-4dfa-a736-3bc170ef917c',
    'queryCorpus': '84a31bac-5c1b-41c3-9058-f81acb7ffaa7',
    'playDtmfSounds': '3e9489b1-25de-4032-bb3d-f7b84765ec93',
    'hangUp': '56294126-5a7d-4948-b67d-3b7e13d55ea7'
}

# Core tools that should ALWAYS be included (regardless of prompt content)
# These are essential tools that every agent should have access to
CORE_TOOLS = [
    'transferFromAiTriageWithMetadata',  # Transfer to human agent
    'hangUp'  # End call gracefully
]

# Commonly referenced tools that should be auto-enabled if in prompt
# (These are detected automatically, no need to add to CORE_TOOLS unless they should ALWAYS be enabled)


def detect_tools_from_prompt(system_prompt):
    """
    Scan the system prompt to detect which tools are referenced.
    Returns a set of tool names that should be enabled.
    """
    detected_tools = set()

    for tool_name in ULTRAVOX_TOOLS.keys():
        if tool_name in system_prompt:
            detected_tools.add(tool_name)

    return detected_tools


def get_tools_for_client(client_data):
    """
    Get tools that should be configured for this client.
    Automatically detects tools from system prompt and adds corpus tool if configured.

    Returns list of tool configurations for Ultravox API.
    """
    system_prompt = client_data.get('system_prompt', '')

    # Start with core tools (always included)
    enabled_tools = set(CORE_TOOLS)

    # Auto-detect tools from system prompt
    detected_tools = detect_tools_from_prompt(system_prompt)
    enabled_tools.update(detected_tools)

    # Build tool configurations
    tools = []

    for tool_name in enabled_tools:
        if tool_name not in ULTRAVOX_TOOLS:
            print(f"  ⚠️  Unknown tool referenced: {tool_name}")
            continue

        tool_id = ULTRAVOX_TOOLS[tool_name]

        # Special handling for queryCorpus - needs corpus_id parameter
        if tool_name == 'queryCorpus':
            corpus_id = client_data.get('corpus_id')
            if not corpus_id:
                print(f"  ⚠️  queryCorpus referenced in prompt but no corpus_id configured")
                continue

            print(f"  📚 Adding queryCorpus tool with corpus_id: {corpus_id}")
            tools.append({
                "toolId": tool_id,
                "parameterOverrides": {
                    "corpus_id": corpus_id,
                    "max_results": int(client_data.get('corpus_max_results', 5))
                }
            })
        else:
            # Standard tool - no parameters needed
            if tool_name in detected_tools and tool_name not in CORE_TOOLS:
                print(f"  🔧 Auto-detected tool from prompt: {tool_name}")
            tools.append({"toolId": tool_id})

    return tools


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

    # CRITICAL: All fields must be wrapped in callTemplate object
    call_template = {
        'systemPrompt': system_prompt
    }

    if voice:
        call_template['voice'] = voice

    if tools is not None:
        call_template['selectedTools'] = tools

    payload = {
        'callTemplate': call_template
    }

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

        # Get tools for this client (auto-detected from prompt + corpus if configured)
        standard_tools = get_tools_for_client(client_data)

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
