#!/usr/bin/env python3
"""
Apply transfer routing migration to Supabase
Uses REST API approach as per CLAUDE.md guidelines
"""

import os
from supabase import create_client, Client

# Load environment variables
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("Applying transfer routing migration...")

# Read the migration SQL file
migration_path = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    'migrations',
    'add_transfer_routing.sql'
)

with open(migration_path, 'r') as f:
    sql_content = f.read()

# Execute SQL using Supabase RPC
try:
    # Use supabase.postgrest to execute raw SQL
    result = supabase.rpc('exec_sql', {'sql': sql_content}).execute()
    print("✅ Migration applied successfully!")
    print(f"Result: {result.data}")
except Exception as e:
    print(f"❌ Migration failed: {e}")
    print("\nTrying alternative approach with individual column tests...")

    # Test column existence by attempting update on dummy record
    # This follows the progressive fallback pattern from CLAUDE.md
    try:
        # Test if primary_transfer_type column exists
        test_result = supabase.table("clients").select("primary_transfer_type").limit(1).execute()
        print("✅ primary_transfer_type column already exists")
    except Exception:
        print("⚠️ primary_transfer_type column needs to be added manually")
        print("   SQL: ALTER TABLE clients ADD COLUMN primary_transfer_type VARCHAR(20) DEFAULT 'pstn';")

    try:
        # Test if aircall_sip_number column exists
        test_result = supabase.table("clients").select("aircall_sip_number").limit(1).execute()
        print("✅ aircall_sip_number column already exists")
    except Exception:
        print("⚠️ aircall_sip_number column needs to be added manually")
        print("   SQL: ALTER TABLE clients ADD COLUMN aircall_sip_number VARCHAR(50);")

    try:
        # Test if transfer_type column exists in call_logs
        test_result = supabase.table("call_logs").select("transfer_type").limit(1).execute()
        print("✅ transfer_type column already exists")
    except Exception:
        print("⚠️ transfer_type column needs to be added manually")
        print("   SQL: ALTER TABLE call_logs ADD COLUMN transfer_type VARCHAR(20);")

    print("\n📋 Please apply the migration SQL manually via Supabase Dashboard:")
    print("   Dashboard → SQL Editor → New query → Paste migration SQL")
