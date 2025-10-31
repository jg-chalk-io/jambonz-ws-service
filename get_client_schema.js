#!/usr/bin/env node
require('dotenv').config();
const {supabase} = require('./lib/supabase');

async function getClientSchema() {
  // Get a sample client to see all fields
  const {data, error} = await supabase
    .from('clients')
    .select('*')
    .limit(1)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('=== CLIENT SCHEMA (all available fields) ===\n');
  console.log(JSON.stringify(data, null, 2));
  console.log('\n=== FIELD NAMES ===');
  Object.keys(data).sort().forEach(key => {
    const value = data[key];
    const type = typeof value;
    const preview = type === 'string' && value.length > 50 ? value.substring(0, 50) + '...' : value;
    console.log(`- ${key}: ${type} = ${JSON.stringify(preview)}`);
  });
}

getClientSchema().then(() => process.exit(0));
