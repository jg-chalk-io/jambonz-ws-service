const {Client} = require('../models/Client');
const {CallLog} = require('../models/CallLog');
const {BusinessHoursChecker} = require('../lib/business-hours');

/**
 * Handle incoming call - initial call setup
 */
async function handleIncomingCall(session) {
  const {call_sid, account_sid, from, to, direction} = session;
  const {logger} = session.locals;

  logger.info({from, to, account_sid}, 'Processing incoming call');

  // Get client configuration
  const client = await Client.getByAccountSid(account_sid);
  if (!client) {
    logger.error({account_sid}, 'No client found for account_sid');
    session
      .say({text: 'No route found'})
      .hangup()
      .reply();
    return;
  }

  // Store client in session for tool calls
  session.locals.client = client;

  // Log the call
  try {
    await CallLog.create(client.id, call_sid, from, to, direction);
  } catch (err) {
    logger.error({err}, 'Error creating call log');
  }

  // Check if client has Ultravox agent configured
  if (!client.ultravox_agent_id) {
    logger.error({client: client.name}, 'No ultravox_agent_id configured');
    session
      .say({text: 'Sorry, this service is not yet configured. Please call back later.'})
      .hangup()
      .reply();
    return;
  }

  // Check business hours
  const isOpen = BusinessHoursChecker.isOpen(client);
  const systemPrompt = generateSystemPrompt(client, isOpen, from);

  logger.info({isOpen, clientName: client.name}, 'Initiating Ultravox LLM session');

  // Build LLM verb with Ultravox
  // Using client: {} pattern from jambonz/ultravox-transfer-call-example
  session
    .pause({length: 0.5})
    .llm({
      vendor: 'ultravox',
      model: 'fixie-ai/ultravox',
      auth: {
        apiKey: process.env.ULTRAVOX_API_KEY
      },
      actionHook: '/llmComplete',
      eventHook: '/llmEvent',
      toolHook: '/toolCall',
      llmOptions: {
        systemPrompt,
        firstSpeaker: 'FIRST_SPEAKER_AGENT',
        initialMessages: [{
          medium: 'MESSAGE_MEDIUM_VOICE',
          role: 'MESSAGE_ROLE_USER'
        }],
        model: 'fixie-ai/ultravox',
        voice: client.agent_voice || 'Jessica',
        transcriptOptional: true,
        // Include call metadata - all values must be strings for Ultravox
        metadata: {
          call_sid,
          client_id: String(client.id),
          client_name: client.name
        },
        selectedTools: [
          {
            temporaryTool: {
              modelToolName: 'transferToOnCall',
              description: 'Transfer the caller when they ask',
              dynamicParameters: [
                {
                  name: 'conversation_summary',
                  location: 'PARAMETER_LOCATION_BODY',
                  schema: {
                    type: 'string',
                    description: 'Brief summary of the conversation'
                  },
                  required: true
                }
              ]
            }
          }
        ]
      }
    })
    .hangup()
    .reply();
}

/**
 * Generate system prompt with client-specific variables
 */
function generateSystemPrompt(client, isAfterHours, callerNumber) {
  const template = isAfterHours ? getAfterHoursPrompt() : getBusinessHoursPrompt();

  // Get last 4 digits of caller number
  const callerLast4 = callerNumber ? callerNumber.slice(-4) : '****';

  // Current time info
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: client.business_hours_config?.timezone || 'America/Toronto',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const currentTime = formatter.format(now);

  return template
    .replace(/\{\{office_name\}\}/g, client.office_name || client.name)
    .replace(/\{\{office_hours\}\}/g, client.office_hours || 'Please check our website')
    .replace(/\{\{office_phone\}\}/g, client.office_phone || '')
    .replace(/\{\{office_website\}\}/g, client.office_website || '')
    .replace(/\{\{caller_phone_last4\}\}/g, callerLast4)
    .replace(/\{\{current_time\}\}/g, currentTime)
    .replace(/\{\{day_of_week\}\}/g, now.toLocaleDateString('en-US', {weekday: 'long'}));
}

function getBusinessHoursPrompt() {
  return `You are a friendly AI assistant for a dental office.

CRITICAL INSTRUCTIONS:
1. Greet the caller briefly
2. When they ask to transfer or speak to someone, you MUST:
   - FIRST: Call the transferToOnCall tool with a brief conversation summary
   - THEN: Tell them you're transferring them
   - NEVER say you transferred them without actually calling the tool

Example: "Let me transfer you now" then CALL THE TOOL.

DO NOT say "you have been transferred" - just say "let me transfer you" and USE THE TOOL.`;
}

function getAfterHoursPrompt() {
  return `You are the after-hours answering service for {{office_name}}. The office is currently closed.

CURRENT CONTEXT:
- Office: {{office_name}}
- Office Hours: {{office_hours}}
- Current time: {{current_time}} ({{day_of_week}})
- Caller ID: ending in {{caller_phone_last4}}

OFFICE IS CLOSED - YOUR RESPONSIBILITIES:
1. **True Emergencies ONLY**: If this is a life-threatening emergency, use transferToOnCall
2. **Non-Emergency After Hours**: For all other calls, politely inform them the office is closed and use collectCallerInfo
3. **After Collection**: Once handled, use hangUp

IMPORTANT:
- Be sympathetic but firm about office hours
- Only transfer TRUE emergencies (life/death situations)
- For routine matters, assure them someone will call back during business hours
- Suggest they call back during {{office_hours}} for non-urgent matters

TOOLS:
- transferToOnCall: ONLY for life-threatening emergencies
- collectCallerInfo: For all other after-hours callers
- hangUp: End the call after handling`;
}

module.exports = {handleIncomingCall};
