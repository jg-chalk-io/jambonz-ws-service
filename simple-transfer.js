require('dotenv').config();
const http = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const pino = require('pino');
const {loadAgentDefinition} = require('./shared/agent-config');
const {createToolHandlers, createJambonzTransfer} = require('./shared/tool-handlers');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';

// Transfer configuration
const TRANSFER_NUMBER = '+13654001512';  // Phone transfer until Aircall whitelists IP
const TRANSFER_TRUNK = 'voip.ms-jambonz';

// Create Jambonz-specific transfer function
const executeTransfer = createJambonzTransfer(
  process.env.JAMBONZ_ACCOUNT_SID,
  process.env.JAMBONZ_API_KEY,
  logger
);

// Create tool handlers with Jambonz transfer logic
const toolHandlers = createToolHandlers({
  executeTransfer,
  logger,
  transferNumber: TRANSFER_NUMBER,
  transferTrunk: TRANSFER_TRUNK
});

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

// Add HTTP routes for tool handlers (shared implementations)
server.on('request', (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};

      if (req.url === '/transferToOnCall' && req.method === 'POST') {
        toolHandlers.handleTransferToOnCall(data, res);
      } else if (req.url === '/collectCallerInfo' && req.method === 'POST') {
        toolHandlers.handleCollectCallerInfo(data, res);
      } else if (req.url === '/hangUp' && req.method === 'POST') {
        toolHandlers.handleHangUp(data, res);
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
