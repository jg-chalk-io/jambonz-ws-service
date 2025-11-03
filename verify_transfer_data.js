const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function verifyData() {
  console.log('\n🔍 Verifying Transfer Success - Database Entries\n');
  console.log('='.repeat(60));

  // Get the most recent call
  const ultravoxCallId = '455bf8f4-520a-48b9-9973-8280c80c13f9';
  const twilioCallSid = 'CA6b716ded2a65582e656ee04582735fc7';

  console.log('\n📞 Call Details:');
  console.log(`  Ultravox Call ID: ${ultravoxCallId}`);
  console.log(`  Twilio Call SID:  ${twilioCallSid}`);

  // 1. Check call_logs
  console.log('\n1️⃣  call_logs Table:');
  console.log('-'.repeat(60));
  const {data: callLog, error: callLogError} = await supabase
    .from('call_logs')
    .select('*')
    .eq('call_sid', twilioCallSid)
    .single();

  if (callLogError) {
    console.log('  ❌ Error:', callLogError.message);
  } else if (callLog) {
    console.log(`  ✅ Call Log ID: ${callLog.id}`);
    console.log(`  📅 Created: ${callLog.created_at}`);
    console.log(`  📱 From: ${callLog.from_number}`);
    console.log(`  📱 To: ${callLog.to_number}`);
    console.log(`  📊 Status: ${callLog.status}`);
    console.log(`  🔗 Ultravox Call ID: ${callLog.ultravox_call_id}`);
    console.log(`  🏢 Client ID: ${callLog.client_id}`);
  } else {
    console.log('  ⚠️  No call log found');
  }

  // 2. Check twilio_ultravox_calls mapping
  console.log('\n2️⃣  twilio_ultravox_calls Mapping Table:');
  console.log('-'.repeat(60));
  const {data: mapping, error: mappingError} = await supabase
    .from('twilio_ultravox_calls')
    .select('*')
    .eq('ultravox_call_id', ultravoxCallId)
    .single();

  if (mappingError) {
    console.log('  ❌ Error:', mappingError.message);
  } else if (mapping) {
    console.log(`  ✅ Mapping ID: ${mapping.id}`);
    console.log(`  🔗 Twilio Call SID: ${mapping.twilio_call_sid}`);
    console.log(`  🔗 Ultravox Call ID: ${mapping.ultravox_call_id}`);
    console.log(`  📱 From: ${mapping.from_number}`);
    console.log(`  📱 To: ${mapping.to_number}`);
    console.log(`  🔗 Call Log ID: ${mapping.call_log_id}`);
    console.log(`  📅 Created: ${mapping.created_at}`);
  } else {
    console.log('  ⚠️  No mapping found');
  }

  // 3. Check tool_call_logs
  console.log('\n3️⃣  tool_call_logs Table (Transfer Tool):');
  console.log('-'.repeat(60));
  const {data: toolCalls, error: toolError} = await supabase
    .from('tool_call_logs')
    .select('*')
    .eq('ultravox_call_id', ultravoxCallId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (toolError) {
    console.log('  ❌ Error:', toolError.message);
  } else if (toolCalls && toolCalls.length > 0) {
    console.log(`  ✅ Found ${toolCalls.length} tool call(s):\n`);
    toolCalls.forEach((tool, idx) => {
      console.log(`  Tool Call #${idx + 1}:`);
      console.log(`    🆔 ID: ${tool.id}`);
      console.log(`    🔧 Tool Name: ${tool.tool_name}`);
      console.log(`    📊 Status: ${tool.status}`);
      console.log(`    📱 Callback Number: ${tool.callback_number}`);
      console.log(`    👤 Caller Name: ${tool.caller_name}`);
      console.log(`    🚨 Urgency: ${tool.urgency_level}`);
      console.log(`    📞 Twilio Call SID: ${tool.twilio_call_sid || 'N/A'}`);
      console.log(`    🔗 Call Log ID: ${tool.call_log_id || 'N/A'}`);
      console.log(`    📅 Created: ${tool.created_at}`);
      if (tool.error_message) {
        console.log(`    ❌ Error: ${tool.error_message}`);
      }
      console.log('');
    });
  } else {
    console.log('  ⚠️  No tool calls found');
  }

  // 4. Summary
  console.log('='.repeat(60));
  console.log('\n✅ VERIFICATION SUMMARY:\n');
  
  const checks = [
    { name: 'Call logged in call_logs', pass: !!callLog },
    { name: 'Twilio-Ultravox mapping created', pass: !!mapping },
    { name: 'Call log ID linked in mapping', pass: !!mapping?.call_log_id },
    { name: 'Tool call logged', pass: toolCalls && toolCalls.length > 0 },
    { name: 'Tool call successful', pass: toolCalls && toolCalls[0]?.status === 'success' },
    { name: 'Ultravox call ID present', pass: !!callLog?.ultravox_call_id }
  ];

  checks.forEach(check => {
    console.log(`  ${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  const allPassed = checks.every(c => c.pass);
  console.log(`\n${allPassed ? '🎉' : '⚠️'} Overall: ${allPassed ? 'ALL CHECKS PASSED' : 'Some checks failed'}\n`);
}

verifyData().catch(console.error);
