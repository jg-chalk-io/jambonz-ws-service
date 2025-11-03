#!/usr/bin/env node

/**
 * Update the transferFromAiTriageWithMetadata tool to include automaticParameters
 * that send the Ultravox call ID in the X-Ultravox-Call-Id header
 */

const https = require('https');
require('dotenv').config();

const TOOL_ID = 'c5835b78-7e5f-4515-a9fa-1d91c61fceea';
const API_KEY = process.env.ULTRAVOX_API_KEY;

if (!API_KEY) {
  console.error('❌ ULTRAVOX_API_KEY not found in environment');
  process.exit(1);
}

function getTool() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/tools/${TOOL_ID}`,
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY
      }
    };

    console.log(`📥 Fetching current tool configuration...`);

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}`));
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

function updateTool(toolConfig) {
  // Add automaticParameters to the existing definition
  if (!toolConfig.definition.automaticParameters) {
    toolConfig.definition.automaticParameters = [];
  }

  // Check if X-Ultravox-Call-Id already exists
  const existingParam = toolConfig.definition.automaticParameters.find(
    p => p.name === 'X-Ultravox-Call-Id'
  );

  if (!existingParam) {
    toolConfig.definition.automaticParameters.push({
      name: 'X-Ultravox-Call-Id',
      location: 'PARAMETER_LOCATION_HEADER',
      knownValue: 'KNOWN_PARAM_CALL_ID'
    });
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(toolConfig);

    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/tools/${TOOL_ID}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-API-Key': API_KEY
      }
    };

    console.log(`📝 Updating tool ${TOOL_ID}...`);

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

function verifyTool() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/tools/${TOOL_ID}`,
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY
      }
    };

    console.log(`\n🔍 Verifying tool configuration...`);

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}`));
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

async function main() {
  try {
    // Get current tool configuration
    const currentTool = await getTool();
    console.log('✅ Retrieved current tool configuration');

    // Update the tool
    const updateResult = await updateTool(currentTool);
    console.log('✅ Tool updated successfully');

    // Verify the update
    const tool = await verifyTool();

    console.log('\n📋 Tool Configuration:');
    console.log('  Tool ID:', tool.toolId);
    console.log('  Name:', tool.definition?.name);
    console.log('  HTTP URL:', tool.definition?.http?.baseUrlPattern);

    if (tool.definition?.automaticParameters) {
      console.log('\n✅ Automatic Parameters:');
      tool.definition.automaticParameters.forEach((param, idx) => {
        console.log(`  ${idx + 1}. ${param.name} (${param.location}): ${param.knownValue}`);
      });
    } else {
      console.log('\n⚠️  WARNING: No automaticParameters found in tool configuration!');
    }

    if (tool.definition?.dynamicParameters) {
      console.log('\n📝 Dynamic Parameters:');
      tool.definition.dynamicParameters.forEach((param, idx) => {
        console.log(`  ${idx + 1}. ${param.name} (${param.required ? 'required' : 'optional'})`);
      });
    }

    console.log('\n✅ Update complete!');
    console.log('\n📌 Next steps:');
    console.log('  1. Make a test call to trigger the transfer tool');
    console.log('  2. Check Railway logs for "X-Ultravox-Call-Id" header');
    console.log('  3. Verify ultravox_call_id is found in the lookup');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
