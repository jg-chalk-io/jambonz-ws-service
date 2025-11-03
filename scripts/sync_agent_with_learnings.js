#!/usr/bin/env node

/**
 * Update Ultravox agent configuration based on transfer tool learnings
 */

const https = require('https');
require('dotenv').config();

const AGENT_ID = '66a768d3-667a-46b9-b803-cd785c447232';
const TRANSFER_TOOL_ID = 'c5835b78-7e5f-4515-a9fa-1d91c61fceea';
const API_KEY = process.env.ULTRAVOX_API_KEY;

if (!API_KEY) {
  console.error('❌ ULTRAVOX_API_KEY not found in environment');
  process.exit(1);
}

function getAgent() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/agents/${AGENT_ID}`,
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY
      }
    };

    console.log(`📥 Fetching current agent configuration...`);

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}: ${responseData}`));
          return;
        }

        try {
          const result = JSON.parse(responseData);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function updateAgent(agentConfig) {
  return new Promise((resolve, reject) => {
    // Ensure transfer tool is in selectedTools using durable tool reference
    if (!agentConfig.selectedTools) {
      agentConfig.selectedTools = [];
    }

    // Check if transfer tool already exists
    const hasTransferTool = agentConfig.selectedTools.some(tool => 
      tool.toolId === TRANSFER_TOOL_ID
    );

    if (!hasTransferTool) {
      console.log('📝 Adding transfer tool to agent configuration...');
      agentConfig.selectedTools.push({
        toolId: TRANSFER_TOOL_ID
      });
    } else {
      console.log('✅ Transfer tool already configured');
    }

    const data = JSON.stringify(agentConfig);

    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/agents/${AGENT_ID}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-API-Key': API_KEY
      }
    };

    console.log(`📝 Updating agent ${AGENT_ID}...`);

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`❌ API returned status ${res.statusCode}`);
          console.error('Response:', responseData);
          reject(new Error(`API returned ${res.statusCode}: ${responseData}`));
          return;
        }

        try {
          const result = JSON.parse(responseData);
          resolve(result);
        } catch (err) {
          console.error('❌ Failed to parse response:', err.message);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Request failed:', err.message);
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    console.log('\n🔧 Syncing Ultravox Agent with Transfer Tool Learnings\n');
    console.log('='.repeat(60));

    // Get current agent configuration
    const currentAgent = await getAgent();
    console.log('✅ Retrieved current agent configuration');
    console.log(`  Agent: ${currentAgent.name || 'Unnamed'}`);
    console.log(`  Agent ID: ${currentAgent.agentId}`);

    console.log('\n📋 Current Tools:');
    if (currentAgent.selectedTools && currentAgent.selectedTools.length > 0) {
      currentAgent.selectedTools.forEach((tool, idx) => {
        if (tool.toolId) {
          console.log(`  ${idx + 1}. Durable Tool ID: ${tool.toolId}`);
        } else if (tool.temporaryTool) {
          console.log(`  ${idx + 1}. Temporary Tool: ${tool.temporaryTool.modelToolName}`);
        }
      });
    } else {
      console.log('  ⚠️  No tools configured');
    }

    // Update the agent
    const updatedAgent = await updateAgent(currentAgent);
    console.log('\n✅ Agent updated successfully');

    // Verify the update
    const verifiedAgent = await getAgent();

    console.log('\n📋 Updated Tools:');
    if (verifiedAgent.selectedTools && verifiedAgent.selectedTools.length > 0) {
      verifiedAgent.selectedTools.forEach((tool, idx) => {
        if (tool.toolId) {
          const isTransferTool = tool.toolId === TRANSFER_TOOL_ID;
          console.log(`  ${idx + 1}. ${isTransferTool ? '✅' : '📦'} Tool ID: ${tool.toolId}${isTransferTool ? ' (Transfer Tool - with X-Ultravox-Call-Id header)' : ''}`);
        } else if (tool.temporaryTool) {
          console.log(`  ${idx + 1}. ⚠️  Temporary Tool: ${tool.temporaryTool.modelToolName}`);
        }
      });
    }

    console.log('\n='.repeat(60));
    console.log('\n✅ SYNC COMPLETE!\n');
    console.log('📌 Key Learnings Applied:');
    console.log('  ✅ Using durable tool reference (toolId) instead of temporaryTool');
    console.log('  ✅ Transfer tool now sends X-Ultravox-Call-Id header automatically');
    console.log('  ✅ Tool configured with automaticParameters for call tracking');
    console.log('\n💡 What this means:');
    console.log('  - Every transfer request will include the Ultravox call ID');
    console.log('  - Backend can look up Twilio call SID via ultravox_call_id');
    console.log('  - Complete audit trail in tool_call_logs table');
    console.log('  - No need for callback_number fallback (unless header missing)');
    console.log('');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
