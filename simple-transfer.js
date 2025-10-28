require('dotenv').config();
const http = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const twilio = require('twilio');
const pino = require('pino');
const {loadAgentDefinition} = require('./shared/agent-config');
const {createToolHandlers, createJambonzTransfer, createTwilioTransfer} = require('./shared/tool-handlers');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';

// Transfer configuration
const TRANSFER_NUMBER = '+13654001512';  // Phone transfer until Aircall whitelists IP
const TRANSFER_TRUNK = 'voip.ms-jambonz';

// Initialize Twilio client (for Twilio transfer mode)
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// Create Jambonz-specific transfer function
const executeJambonzTransfer = createJambonzTransfer(
  process.env.JAMBONZ_ACCOUNT_SID,
  process.env.JAMBONZ_API_KEY,
  logger
);

// Create Twilio-specific transfer function
const executeTwilioTransfer = twilioClient
  ? createTwilioTransfer(twilioClient, logger)
  : null;

// Create tool handlers with Jambonz transfer logic
const jambonzToolHandlers = createToolHandlers({
  executeTransfer: executeJambonzTransfer,
  logger,
  transferNumber: TRANSFER_NUMBER,
  transferTrunk: TRANSFER_TRUNK
});

// Create tool handlers with Twilio transfer logic
const twilioToolHandlers = executeTwilioTransfer ? createToolHandlers({
  executeTransfer: executeTwilioTransfer,
  logger,
  transferNumber: TRANSFER_NUMBER,
  transferTrunk: null
}) : null;

/**
 * Create Ultravox call and generate TwiML for incoming Twilio call
 */
async function generateIncomingCallTwiML(from, to, callSid) {
  const systemPrompt = loadAgentDefinition(from);

  // Build tool definitions for Ultravox
  const tools = [
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
          baseUrlPattern: `${BASE_URL}/twilio/transferToOnCall`,
          httpMethod: 'POST'
        },
        staticParameters: [
          {
            name: 'call_sid',
            location: 'PARAMETER_LOCATION_BODY',
            value: callSid
          }
        ]
      }
    },
    {
      temporaryTool: {
        modelToolName: 'collectCallerInfo',
        description: 'Collect and store non-urgent call details',
        dynamicParameters: [
          {name: 'caller_name', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: true},
          {name: 'pet_name', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: true},
          {name: 'species', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: true},
          {name: 'breed', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: false},
          {name: 'callback_number', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: true},
          {name: 'email', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: false},
          {name: 'home_vet_hospital', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: false},
          {name: 'concern_description', location: 'PARAMETER_LOCATION_BODY', schema: {type: 'string'}, required: true}
        ],
        http: {
          baseUrlPattern: `${BASE_URL}/twilio/collectCallerInfo`,
          httpMethod: 'POST'
        },
        staticParameters: [
          {name: 'call_sid', location: 'PARAMETER_LOCATION_BODY', value: callSid}
        ]
      }
    },
    {
      temporaryTool: {
        modelToolName: 'hangUp',
        description: 'End the call gracefully after completing the interaction',
        dynamicParameters: [],
        http: {
          baseUrlPattern: `${BASE_URL}/twilio/hangUp`,
          httpMethod: 'POST'
        },
        staticParameters: [
          {name: 'call_sid', location: 'PARAMETER_LOCATION_BODY', value: callSid}
        ]
      }
    }
  ];

  // Create Ultravox call via REST API
  logger.info({callSid}, 'Creating Ultravox call via REST API');

  const ultravoxResponse = await fetch('https://api.ultravox.ai/api/calls', {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.ULTRAVOX_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      medium: {
        twilio: {}
      },
      firstSpeakerSettings: {
        agent: {}
      },
      model: 'fixie-ai/ultravox',
      voice: 'Jessica',
      temperature: 0.1,
      systemPrompt: systemPrompt,
      selectedTools: tools
    })
  });

  if (!ultravoxResponse.ok) {
    const errorText = await ultravoxResponse.text();
    logger.error({status: ultravoxResponse.status, error: errorText}, 'Failed to create Ultravox call');
    throw new Error(`Ultravox API error: ${ultravoxResponse.status} ${errorText}`);
  }

  const ultravoxCall = await ultravoxResponse.json();
  logger.info({callId: ultravoxCall.callId, joinUrl: ultravoxCall.joinUrl}, 'Ultravox call created successfully');

  // Return TwiML with the joinUrl
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${ultravoxCall.joinUrl}" />
  </Connect>
</Response>`;

  return twiml;
}

// Create HTTP server (handlers added below)
const server = http.createServer();

// Create WebSocket endpoint
const makeService = createEndpoint({server});
const svc = makeService({path: '/ws'});

logger.info('WebSocket endpoint created at /ws');
logger.info('HTTP routes ready for both Jambonz and Twilio');

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

// Add HTTP routes for both Jambonz and Twilio
server.on('request', (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      logger.info({url: req.url, method: req.method}, 'Received request');

      // Parse body based on content type
      let data = {};
      const contentType = req.headers['content-type'] || '';

      if (body) {
        if (contentType.includes('application/x-www-form-urlencoded')) {
          // Twilio sends form-encoded data
          const params = new URLSearchParams(body);
          data = Object.fromEntries(params);
        } else {
          // Ultravox HTTP tools send JSON
          data = JSON.parse(body);
        }
      }

      // Twilio routes
      if (req.url === '/twilio/incoming' && req.method === 'POST') {
        const {From, To, CallSid} = data;
        logger.info({From, To, CallSid}, 'Twilio incoming call');

        (async () => {
          try {
            const twiml = await generateIncomingCallTwiML(From, To, CallSid);
            logger.info({twimlLength: twiml.length}, 'Generated TwiML response');

            // Log first 500 chars of TwiML for debugging
            logger.info({twimlPreview: twiml.substring(0, 500)}, 'TwiML preview');

            res.writeHead(200, {'Content-Type': 'text/xml'});
            res.end(twiml);
            logger.info('TwiML response sent successfully');
          } catch (twimlError) {
            logger.error({err: twimlError, stack: twimlError.stack}, 'Error generating TwiML');
            res.writeHead(500, {'Content-Type': 'text/xml'});
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say></Response>');
          }
        })();

      } else if (req.url === '/twilio/transferToOnCall' && req.method === 'POST') {
        if (!twilioToolHandlers) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: 'Twilio not configured'}));
          return;
        }
        twilioToolHandlers.handleTransferToOnCall(data, res);

      } else if (req.url === '/twilio/collectCallerInfo' && req.method === 'POST') {
        if (!twilioToolHandlers) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: 'Twilio not configured'}));
          return;
        }
        twilioToolHandlers.handleCollectCallerInfo(data, res);

      } else if (req.url === '/twilio/hangUp' && req.method === 'POST') {
        if (!twilioToolHandlers) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: 'Twilio not configured'}));
          return;
        }
        twilioToolHandlers.handleHangUp(data, res);

      // Jambonz routes
      } else if (req.url === '/transferToOnCall' && req.method === 'POST') {
        jambonzToolHandlers.handleTransferToOnCall(data, res);
      } else if (req.url === '/collectCallerInfo' && req.method === 'POST') {
        jambonzToolHandlers.handleCollectCallerInfo(data, res);
      } else if (req.url === '/hangUp' && req.method === 'POST') {
        jambonzToolHandlers.handleHangUp(data, res);

      // Health check
      } else if (req.url === '/health') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          status: 'healthy',
          jambonz: true,
          twilio: !!twilioClient
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      logger.error({err}, 'Error handling request');
      res.writeHead(400);
      res.end(JSON.stringify({error: 'Bad request'}));
    }
  });
});

// Start server
server.listen(PORT, () => {
  logger.info(`Unified service listening on port ${PORT}`);
  logger.info(`Jambonz WebSocket: ws://localhost:${PORT}/ws`);
  if (twilioClient) {
    logger.info(`Twilio HTTP: ${BASE_URL}/twilio/incoming`);
  }
  logger.info(`Health check: ${BASE_URL}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
