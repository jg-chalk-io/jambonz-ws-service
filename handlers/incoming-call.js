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
  // Using CLIENT-SIDE tools - Ultravox sends WebSocket message to handler
  // Tool calls are handled by /toolCall event registered in index.js
  // See handlers/tool-call.js for implementation

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
        temperature: 0.1,
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
              description: 'IMMEDIATELY transfer caller to live agent when they say: transfer, agent, speak to someone, person, representative, human, help, emergency, or ask to talk to anyone. MUST call this tool - do not just say you will transfer.',
              dynamicParameters: [
                {
                  name: 'transfer_reason',
                  location: 'PARAMETER_LOCATION_BODY',
                  schema: {
                    type: 'string',
                    enum: ['emergency', 'needs_help', 'wants_human', 'other'],
                    description: 'Why the caller needs to be transferred'
                  },
                  required: true
                }
              ],
              // HTTP tool - Ultravox recommended for telephony integration
              http: {
                baseUrlPattern: `${process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app'}/transferToOnCall`,
                httpMethod: 'POST'
              },
              staticParameters: [
                {
                  name: 'call_sid',
                  location: 'PARAMETER_LOCATION_BODY',
                  value: call_sid
                }
              ]
            }
          },
          {
            temporaryTool: {
              modelToolName: 'collectCallerInfo',
              description: 'Collect caller information when office is closed or caller cannot be transferred immediately.',
              dynamicParameters: [
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
                  name: 'callback_number',
                  location: 'PARAMETER_LOCATION_BODY',
                  schema: {
                    type: 'string',
                    description: 'Phone number to call back'
                  },
                  required: true
                },
                {
                  name: 'concern_description',
                  location: 'PARAMETER_LOCATION_BODY',
                  schema: {
                    type: 'string',
                    description: 'Description of their concern or reason for calling'
                  },
                  required: true
                }
              ],
              http: {
                baseUrlPattern: `${process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app'}/collectCallerInfo`,
                httpMethod: 'POST'
              },
              staticParameters: [
                {
                  name: 'call_sid',
                  location: 'PARAMETER_LOCATION_BODY',
                  value: call_sid
                }
              ]
            }
          },
          {
            temporaryTool: {
              modelToolName: 'hangUp',
              description: 'End the call gracefully after completing the interaction.',
              dynamicParameters: [],
              http: {
                baseUrlPattern: `${process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app'}/hangUp`,
                httpMethod: 'POST'
              },
              staticParameters: [
                {
                  name: 'call_sid',
                  location: 'PARAMETER_LOCATION_BODY',
                  value: call_sid
                }
              ]
            }
          }
        ]
      }
    })
    .hangup()
    .send();
}

// NOTE: .hangup() removed - call stays alive for LLM session
// Hangup handled by: /llmComplete event, tool handlers, or caller hanging up

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
  return `You are a helpful dental office assistant.

When a caller asks to be transferred or speak to someone, ask if they would like to speak with a live agent.

If the caller confirms they want to speak to someone, you MUST call the transferToOnCall tool immediately. Use the appropriate transfer_reason:
- emergency: life-threatening dental emergency
- needs_help: needs assistance you cannot provide
- wants_human: specifically asked for a person/agent
- other: any other transfer request

Do NOT say you are transferring unless you have successfully called the tool.`;
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
