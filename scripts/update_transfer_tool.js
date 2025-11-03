require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const TRANSFER_TOOL_ID = '9d718770-d609-4223-bfe0-a5a8f30d582b';

async function updateTransferTool() {
  console.log('Updating transferFromAiTriageWithMetadata tool...\n');

  const definition = {
    modelToolName: 'transferFromAiTriageWithMetadata',
    description: 'Transfers the caller to a Live Agent for immediate medical assistance',
    dynamicParameters: [
      {
        name: 'urgency_reason',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'A brief description of the urgent medical issue'
        },
        required: true
      },
      {
        name: 'caller_name',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'The caller\'s full name, spelled out for accuracy'
        },
        required: true
      },
      {
        name: 'callback_number',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'The confirmed callback phone number'
        },
        required: true
      },
      {
        name: 'pet_name',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'The pet\'s name'
        },
        required: false
      },
      {
        name: 'species',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'The pet\'s species (e.g., "dog," "cat")'
        },
        required: false
      },
      {
        name: 'breed',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'The pet\'s breed'
        },
        required: false
      },
      {
        name: 'age',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'The pet\'s age'
        },
        required: false
      }
    ],
    // NO staticParameters - we'll look up call_sid from mapping table
    http: {
      baseUrlPattern: `${BASE_URL}/twilio/transferToOnCall`,
      httpMethod: 'POST'
    }
  };

  const response = await fetch(`https://api.ultravox.ai/api/tools/${TRANSFER_TOOL_ID}`, {
    method: 'PATCH',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      definition
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to update tool:`, error);
    process.exit(1);
  }

  const result = await response.json();
  console.log('✓ Updated transferFromAiTriageWithMetadata tool');
  console.log('\nChanges:');
  console.log('  - Removed staticParameters (call_sid template variable)');
  console.log('  - Webhook will now look up call_sid from twilio_ultravox_calls mapping table');
  console.log('\nTool ID:', TRANSFER_TOOL_ID);
}

updateTransferTool().catch(console.error);
