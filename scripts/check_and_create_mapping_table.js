#!/usr/bin/env node
/**
 * Check if twilio_ultravox_calls table exists and create it if needed
 */
const {supabase} = require('../lib/supabase');

async function checkAndCreateTable() {
  try {
    console.log('Checking if twilio_ultravox_calls table exists...');

    // Try to query the table
    const {data, error} = await supabase
      .from('twilio_ultravox_calls')
      .select('id')
      .limit(1);

    if (error) {
      if (error.code === '42P01') {
        // Table doesn't exist
        console.log('❌ Table does not exist');
        console.log('\nTo create the table, run the migration:');
        console.log('cd /Users/jeremygreven/git-projects/Jambonz/jambonz-ws-service');
        console.log('psql $DATABASE_URL < migrations/create_twilio_ultravox_calls_mapping.sql');
        process.exit(1);
      } else {
        console.error('Error checking table:', error);
        process.exit(1);
      }
    }

    console.log('✅ Table exists!');
    console.log('Sample data:', data);

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkAndCreateTable();
