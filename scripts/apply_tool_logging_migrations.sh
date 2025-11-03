#!/bin/bash
# Apply tool call logging migrations to Supabase

set -e

echo "=========================================="
echo "Applying Tool Call Logging Migrations"
echo "=========================================="
echo ""

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable not set"
    echo "Please set it to your Supabase database connection string"
    exit 1
fi

echo "📋 Applying migrations..."
echo ""

# Apply tool_call_logs table
echo "1. Creating tool_call_logs table..."
psql "$DATABASE_URL" < migrations/create_tool_call_logs.sql
echo "✅ tool_call_logs table created"
echo ""

# Apply callback_requests table
echo "2. Creating callback_requests table..."
psql "$DATABASE_URL" < migrations/create_callback_requests.sql
echo "✅ callback_requests table created"
echo ""

echo "=========================================="
echo "✅ All migrations applied successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Test tool calls to verify logging works"
echo "2. Set up backend worker to process callback_requests"
echo "3. Implement retry mechanism for failed postings"
