require('dotenv').config();
// Using native fetch (Node.js 18+)

const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;

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
        caller_name: {
          type: 'string',
          description: 'The caller\'s full name, spelled out for accuracy'
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
      required: ['urgency_reason', 'caller_name', 'callback_number']
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
        caller_name: {
          type: 'string',
          description: 'The caller\'s full name, spelled out for accuracy'
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
      required: ['callback_number', 'caller_name', 'concern_description']
    },
    http: {
      baseUrlPattern: `${BASE_URL}/twilio/collectCallerInfo`,
      httpMethod: 'POST'
    }
  },
  {
    name: 'hangUp',
    description: 'Ends the call after confirming the conversation is complete',
    parameters: {
      type: 'object',
      properties: {}
    },
    http: {
      baseUrlPattern: `${BASE_URL}/twilio/hangUp`,
      httpMethod: 'POST'
    }
  }
];

async function createTool(tool) {
  console.log(`Creating durable tool: ${tool.name}`);

  const definition = {
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
  };

  // Add staticParameters if they exist
  if (tool.staticParameters) {
    definition.staticParameters = Object.entries(tool.staticParameters).map(([name, config]) => ({
      name,
      location: 'PARAMETER_LOCATION_BODY',
      value: config.value
    }));
  }

  const response = await fetch('https://api.ultravox.ai/api/tools', {
    method: 'POST',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: tool.name,
      definition
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
  console.log('Creating Ultravox durable tools...\n');

  const results = [];
  for (const tool of tools) {
    const result = await createTool(tool);
    if (result) {
      results.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
  }

  console.log('\n' + '='.repeat(60));
  console.log('All tools created successfully!');
  console.log('='.repeat(60));

  console.log('\nTool Names (use these in selectedTools):');
  results.forEach(tool => {
    console.log(`  - ${tool.name || tool.toolId}`);
  });

  console.log('\nNext steps:');
  console.log('1. Update simple-transfer.js to reference these durable tools by name');
  console.log('2. Example: selectedTools: ["transferFromAiTriageWithMetadata", "collectNameNumberConcernPetName"]');
  console.log('3. Note: Use Ultravox\'s built-in endCall tool instead of custom hangUp');
  console.log('4. Test with a call to verify tools are working');
}

main().catch(console.error);
