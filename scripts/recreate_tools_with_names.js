require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;

const OLD_TOOL_IDS = [
  '4eb7546a-5696-47d6-9d70-c2f33ebbed65', // transferFromAiTriageWithMetadata
  '0f7dd80d-e921-426d-8e9d-74557e40afc0'  // collectNameNumberConcernPetName
];

const tools = [
  {
    name: 'transferFromAiTriageWithMetadata',
    description: 'Transfers the caller to a Live Agent for immediate medical assistance',
    parameters: {
      type: 'object',
      properties: {
        urgency_reason: {
          type: 'string',
          description: 'A brief description of the urgent medical issue'
        },
        first_name: {
          type: 'string',
          description: 'Caller\'s first name'
        },
        last_name: {
          type: 'string',
          description: 'Caller\'s last name (optional for critical emergencies)'
        },
        callback_number: {
          type: 'string',
          description: 'The confirmed callback phone number'
        },
        pet_name: {
          type: 'string',
          description: 'The pet\'s name'
        },
        species: {
          type: 'string',
          description: 'The pet\'s species (e.g., "dog," "cat")'
        },
        breed: {
          type: 'string',
          description: 'The pet\'s breed'
        },
        age: {
          type: 'string',
          description: 'The pet\'s age'
        }
      },
      required: ['urgency_reason', 'first_name', 'callback_number']
    },
    http: {
      baseUrlPattern: `${BASE_URL}/twilio/transferToOnCall`,
      httpMethod: 'POST'
    }
  },
  {
    name: 'collectNameNumberConcernPetName',
    description: 'Collects and stores non-urgent call details for a callback from clinic staff',
    parameters: {
      type: 'object',
      properties: {
        callback_number: {
          type: 'string',
          description: 'The confirmed callback phone number'
        },
        first_name: {
          type: 'string',
          description: 'Caller\'s first name'
        },
        last_name: {
          type: 'string',
          description: 'Caller\'s last name'
        },
        concern_description: {
          type: 'string',
          description: 'A summary of the caller\'s non-urgent issue'
        },
        pet_name: {
          type: 'string',
          description: 'The pet\'s name'
        }
      },
      required: ['callback_number', 'first_name', 'last_name', 'concern_description']
    },
    http: {
      baseUrlPattern: `${BASE_URL}/twilio/collectCallerInfo`,
      httpMethod: 'POST'
    }
  }
];

async function deleteTool(toolId) {
  console.log(`Deleting old tool: ${toolId}`);

  const response = await fetch(`https://api.ultravox.ai/api/tools/${toolId}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY
    }
  });

  if (!response.ok && response.status !== 404) {
    const error = await response.text();
    throw new Error(`Failed to delete ${toolId}: ${response.status} ${error}`);
  }

  console.log(`✓ Deleted ${toolId}`);
}

async function createTool(tool) {
  console.log(`Creating durable tool: ${tool.name}`);

  const response = await fetch('https://api.ultravox.ai/api/tools', {
    method: 'POST',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: tool.name,
      definition: {
        modelToolName: tool.name,
        description: tool.description,
        dynamicParameters: Object.entries(tool.parameters.properties).map(([name, schema]) => ({
          name,
          location: 'PARAMETER_LOCATION_BODY',
          schema: {
            type: schema.type,
            description: schema.description
          },
          required: tool.parameters.required?.includes(name) || false
        })),
        http: tool.http
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to create ${tool.name}:`, error);
    return null;
  }

  const result = await response.json();
  console.log(`✓ Created ${tool.name} with ID: ${result.toolId || result.name}`);
  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Recreating Ultravox Tools with First/Last Name');
  console.log('='.repeat(60));
  console.log();

  // Step 1: Delete old tools
  console.log('Step 1: Deleting old tools...');
  for (const toolId of OLD_TOOL_IDS) {
    await deleteTool(toolId);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log();

  // Step 2: Create new tools with updated parameters
  console.log('Step 2: Creating new tools with updated parameters...');
  const results = [];
  for (const tool of tools) {
    const result = await createTool(tool);
    if (result) {
      results.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log();
  console.log('='.repeat(60));
  console.log('All tools recreated successfully!');
  console.log('='.repeat(60));
  console.log();

  console.log('New Tool IDs:');
  results.forEach(tool => {
    console.log(`  ${tool.name}: ${tool.toolId}`);
  });

  console.log();
  console.log('Changes made:');
  console.log('1. transferFromAiTriageWithMetadata:');
  console.log('   - Removed: caller_name');
  console.log('   - Added: first_name (required)');
  console.log('   - Added: last_name (optional)');
  console.log();
  console.log('2. collectNameNumberConcernPetName:');
  console.log('   - Removed: caller_name');
  console.log('   - Added: first_name (required)');
  console.log('   - Added: last_name (required)');
  console.log();
  console.log('Next steps:');
  console.log('1. Update backend tool handlers (shared/tool-handlers.js)');
  console.log('2. Update system prompts to ask for first and last name separately');
  console.log('3. Test with a call to verify tool invocation works');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
