require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const {createEndpoint} = require('@jambonz/node-client-ws');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';

// Transfer configuration
const TRANSFER_NUMBER = '+13654001512';  // Phone transfer until Aircall whitelists IP
const TRANSFER_TRUNK = 'voip.ms-jambonz';

// Client configuration (can be loaded from DB in production)
const CLIENT_CONFIG = {
  office_name: 'Humber Veterinary Clinic',
  agent_name: 'Jessica',
  office_hours: 'Monday through Friday, 9 A.M. to 5 P.M., Saturday 9 to noon',
  clinic_open: false,  // Set based on business hours check
  clinic_closed: true  // Set based on business hours check
};

/**
 * Load and interpolate agent definition template
 */
function loadAgentDefinition() {
  const templatePath = path.join(__dirname, 'ai-agent-definitions', 'humber_vet_ultravox_compliant.md');
  let template = fs.readFileSync(templatePath, 'utf8');

  // Get last 4 digits of caller number (will be set per-call)
  const callerLast4 = '****';  // Placeholder, will be replaced per-call

  // Interpolate template variables
  template = template
    .replace(/\{\{office_name\}\}/g, CLIENT_CONFIG.office_name)
    .replace(/\{\{agent_name\}\}/g, CLIENT_CONFIG.agent_name)
    .replace(/\{\{office_hours\}\}/g, CLIENT_CONFIG.office_hours)
    .replace(/\{\{caller_phone_last4\}\}/g, callerLast4)
    .replace(/\{\{clinic_open\}\}/g, CLIENT_CONFIG.clinic_open)
    .replace(/\{\{clinic_closed\}\}/g, CLIENT_CONFIG.clinic_closed);

  return template;
}

// Create HTTP server (handlers added below)
const server = http.createServer();

// Create WebSocket endpoint
const makeService = createEndpoint({server});
const svc = makeService({path: '/ws'});

logger.info('WebSocket endpoint created at /ws');

// Handle incoming calls
svc.on('session:new', async (session) => {
  const {call_sid, from, to} = session;

  session.locals = {
    logger: logger.child({call_sid})
  };

  session.locals.logger.info({from, to}, 'New call - veterinary triage agent');

  try {
    // Load agent definition with interpolated variables
    const systemPrompt = loadAgentDefinition();

    // Register event handlers
    session
      .on('/dialComplete', (evt) => {
        logger.info({evt}, 'Transfer completed');
        session.hangup().reply();
      })
      .on('close', () => {
        logger.info({call_sid}, 'Call ended');
      });

    // Start Ultravox LLM with veterinary triage agent
    session
      .answer()
      .pause({length: 1})
      .llm({
        vendor: 'ultravox',
        model: 'fixie-ai/ultravox',
        auth: {
          apiKey: process.env.ULTRAVOX_API_KEY
        },
        actionHook: '/llmComplete',
        llmOptions: {
          systemPrompt,
          firstSpeaker: 'FIRST_SPEAKER_AGENT',
          initialMessages: [{
            medium: 'MESSAGE_MEDIUM_VOICE',
            role: 'MESSAGE_ROLE_USER'
          }],
          model: 'fixie-ai/ultravox',
          voice: 'Jessica',
          transcriptOptional: true,
          temperature: 0.1,
          // HTTP tools - Ultravox calls our endpoints directly
          selectedTools: [
            {
              temporaryTool: {
                modelToolName: 'transferToOnCall',
                description: 'Transfer caller to on-call veterinary technician for emergency situations',
                dynamicParameters: [
                  {
                    name: 'urgency_reason',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {
                      type: 'string',
                      description: 'Brief description of the emergency situation'
                    },
                    required: true
                  }
                ],
                http: {
                  baseUrlPattern: `${BASE_URL}/transferToOnCall`,
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
                description: 'Collect and store non-urgent call details',
                dynamicParameters: [
                  {
                    name: 'caller_name',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: true
                  },
                  {
                    name: 'pet_name',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: true
                  },
                  {
                    name: 'species',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: true
                  },
                  {
                    name: 'breed',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: false
                  },
                  {
                    name: 'callback_number',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: true
                  },
                  {
                    name: 'email',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: false
                  },
                  {
                    name: 'home_vet_hospital',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: false
                  },
                  {
                    name: 'concern_description',
                    location: 'PARAMETER_LOCATION_BODY',
                    schema: {type: 'string'},
                    required: true
                  }
                ],
                http: {
                  baseUrlPattern: `${BASE_URL}/collectCallerInfo`,
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
                description: 'End the call gracefully after completing the interaction',
                dynamicParameters: [],
                http: {
                  baseUrlPattern: `${BASE_URL}/hangUp`,
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

  } catch (err) {
    session.locals.logger.error({err}, 'Error handling call');
    session
      .say({text: 'Sorry, an error occurred.'})
      .hangup()
      .send();
  }
});

/**
 * HTTP Tool Handlers - Ultravox calls these endpoints directly
 */

// Add HTTP routes for tool handlers
server.on('request', (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};

      if (req.url === '/transferToOnCall' && req.method === 'POST') {
        handleTransferToOnCall(data, res);
      } else if (req.url === '/collectCallerInfo' && req.method === 'POST') {
        handleCollectCallerInfo(data, res);
      } else if (req.url === '/hangUp' && req.method === 'POST') {
        handleHangUp(data, res);
      } else if (req.url === '/health') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({status: 'healthy'}));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      logger.error({err}, 'Error parsing request');
      res.writeHead(400);
      res.end(JSON.stringify({error: 'Bad request'}));
    }
  });
});

/**
 * Handle transferToOnCall HTTP tool invocation
 */
function handleTransferToOnCall(data, res) {
  const {call_sid, urgency_reason} = data;

  logger.info({call_sid, urgency_reason}, 'Transfer to on-call requested');

  // Send immediate response to Ultravox
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({
    success: true,
    message: 'Transfer initiated'
  }));

  // Execute transfer via Jambonz REST API
  // Using sendCommand REST API to dial the transfer number
  const jambonzRequest = http.request({
    hostname: 'api.jambonz.cloud',
    path: `/v1/Accounts/${process.env.JAMBONZ_ACCOUNT_SID}/Calls/${call_sid}/redirect`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.JAMBONZ_API_KEY}`,
      'Content-Type': 'application/json'
    }
  }, (jambonzRes) => {
    let responseBody = '';
    jambonzRes.on('data', chunk => responseBody += chunk);
    jambonzRes.on('end', () => {
      logger.info({call_sid, statusCode: jambonzRes.statusCode}, 'Transfer redirect sent');
    });
  });

  jambonzRequest.on('error', (err) => {
    logger.error({err, call_sid}, 'Error sending transfer command');
  });

  // Send redirect command with phone dial
  jambonzRequest.write(JSON.stringify([
    {
      verb: 'say',
      text: 'Connecting you to our on-call team now.'
    },
    {
      verb: 'dial',
      actionHook: '/dialComplete',
      target: [
        {
          type: 'phone',
          number: TRANSFER_NUMBER,
          trunk: TRANSFER_TRUNK
        }
      ]
    }
  ]));

  jambonzRequest.end();
}

/**
 * Handle collectCallerInfo HTTP tool invocation
 */
function handleCollectCallerInfo(data, res) {
  const {call_sid, caller_name, pet_name, species, callback_number, concern_description} = data;

  logger.info({
    call_sid,
    caller_name,
    pet_name,
    species,
    callback_number,
    concern_description
  }, 'Caller information collected');

  // TODO: Store in database (Supabase call_logs or messages table)

  // Send success response
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({
    success: true,
    message: 'Information recorded successfully'
  }));
}

/**
 * Handle hangUp HTTP tool invocation
 */
function handleHangUp(data, res) {
  const {call_sid} = data;

  logger.info({call_sid}, 'Hangup requested');

  // Send success response
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({
    success: true,
    message: 'Call will end'
  }));

  // Hangup will be handled by the .hangup() in the LLM verb chain
}

// Start server
server.listen(PORT, () => {
  logger.info(`Simple transfer service listening on port ${PORT}`);
  logger.info(`WebSocket: ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
