require('dotenv').config();

const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;

const toolUpdates = [
  {
    toolId: '4eb7546a-5696-47d6-9d70-c2f33ebbed65',
    name: 'transferFromAiTriageWithMetadata',
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
        name: 'first_name',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'Caller\'s first name'
        },
        required: true
      },
      {
        name: 'last_name',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'Caller\'s last name (optional for critical emergencies)'
        },
        required: false
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
    ]
  },
  {
    toolId: '0f7dd80d-e921-426d-8e9d-74557e40afc0',
    name: 'collectNameNumberConcernPetName',
    dynamicParameters: [
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
        name: 'first_name',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'Caller\'s first name'
        },
        required: true
      },
      {
        name: 'last_name',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'Caller\'s last name'
        },
        required: true
      },
      {
        name: 'concern_description',
        location: 'PARAMETER_LOCATION_BODY',
        schema: {
          type: 'string',
          description: 'A summary of the caller\'s non-urgent issue'
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
      }
    ]
  }
];

async function updateTool(toolUpdate) {
  console.log(`Updating tool: ${toolUpdate.name} (${toolUpdate.toolId})`);

  const response = await fetch(`https://api.ultravox.ai/api/tools/${toolUpdate.toolId}`, {
    method: 'PATCH',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      definition: {
        dynamicParameters: toolUpdate.dynamicParameters
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update ${toolUpdate.name}: ${response.status} ${error}`);
  }

  const result = await response.json();
  console.log(`✓ Updated ${toolUpdate.name}`);
  console.log(`  Parameters: ${result.definition.dynamicParameters.map(p => p.name).join(', ')}`);
  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Updating Ultravox Tools: Separate First/Last Name');
  console.log('='.repeat(60));
  console.log();

  for (const toolUpdate of toolUpdates) {
    await updateTool(toolUpdate);
    console.log();
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
  }

  console.log('='.repeat(60));
  console.log('All tools updated successfully!');
  console.log('='.repeat(60));
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
