require('dotenv').config();

const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const HANGUP_TOOL_ID = '4c5e41ef-b351-4346-9665-3d950a1e5d96';

async function deleteTool() {
  console.log('Deleting redundant hangUp tool...');
  console.log(`Tool ID: ${HANGUP_TOOL_ID}`);
  console.log();
  console.log('Reason: This tool is redundant with Ultravox\'s built-in endCall tool.');
  console.log('Our custom implementation doesn\'t actually hang up the call - it just returns success.');
  console.log();

  const response = await fetch(`https://api.ultravox.ai/api/tools/${HANGUP_TOOL_ID}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': ULTRAVOX_API_KEY
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete tool: ${response.status} ${error}`);
  }

  // DELETE typically returns 204 No Content on success
  console.log('✓ Tool deleted successfully!');
  console.log();
  console.log('Next steps:');
  console.log('1. Remove "hangUp" from selectedTools arrays in code');
  console.log('2. Update agent prompts to reference Ultravox\'s built-in endCall instead');
  console.log('3. The AI will automatically have access to endCall without configuration');
}

deleteTool().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
