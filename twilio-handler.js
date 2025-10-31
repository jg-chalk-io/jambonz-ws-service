require('dotenv').config();
const http = require('http');
const twilio = require('twilio');
const pino = require('pino');
const {loadAgentDefinition} = require('./shared/agent-config');
const {createToolHandlers, createTwilioTransfer} = require('./shared/tool-handlers');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';

// Transfer configuration
const TRANSFER_NUMBER = '+13654001512';  // Phone transfer

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Create Twilio-specific transfer function
const executeTransfer = createTwilioTransfer(twilioClient, logger);

// Create tool handlers with Twilio transfer logic
const toolHandlers = createToolHandlers({
  executeTransfer,
  logger,
  transferNumber: TRANSFER_NUMBER,
  transferTrunk: null  // Twilio doesn't use trunks like Jambonz
});

// Create HTTP server
const server = http.createServer();

/**
 * Generate TwiML for incoming call with Ultravox connection
 */
async function generateIncomingCallTwiML(from, to, callSid) {
  // Load agent definition - pass clinic number (to) and caller number (from)
  const systemPrompt = await loadAgentDefinition(to, from);

  // Escape XML special characters in system prompt
  const escapedPrompt = systemPrompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

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
          baseUrlPattern: `${BASE_URL}/twilio/collectCallerInfo`,
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
        modelToolName: 'hangUp',
        description: 'End the call gracefully after completing the interaction',
        dynamicParameters: [],
        http: {
          baseUrlPattern: `${BASE_URL}/twilio/hangUp`,
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
    }
  ];

  // Generate TwiML with Ultravox Stream connection
  // Per Ultravox docs: https://docs.ultravox.ai/telephony/supported-providers#twilio
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.ultravox.ai/stream">
      <Parameter name="apiKey" value="${process.env.ULTRAVOX_API_KEY}" />
      <Parameter name="systemPrompt" value="${escapedPrompt}" />
      <Parameter name="voice" value="Jessica" />
      <Parameter name="model" value="fixie-ai/ultravox" />
      <Parameter name="temperature" value="0.1" />
      <Parameter name="firstSpeaker" value="FIRST_SPEAKER_AGENT" />
      <Parameter name="selectedTools" value="${JSON.stringify(tools).replace(/"/g, '&quot;')}" />
    </Stream>
  </Connect>
</Response>`;

  return twiml;
}

// HTTP request handler
server.on('request', (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      // Parse URL-encoded body (Twilio sends form data)
      const params = new URLSearchParams(body);
      const data = Object.fromEntries(params);

      logger.info({url: req.url, method: req.method}, 'Received request');

      if (req.url === '/twilio/incoming' && req.method === 'POST') {
        // Incoming call from Twilio
        const {From, To, CallSid} = data;
        logger.info({From, To, CallSid}, 'Twilio incoming call');

        const twiml = await generateIncomingCallTwiML(From, To, CallSid);

        res.writeHead(200, {'Content-Type': 'text/xml'});
        res.end(twiml);

      } else if (req.url === '/twilio/transferToOnCall' && req.method === 'POST') {
        // Parse JSON body for tool calls
        const toolData = body ? JSON.parse(body) : {};
        toolHandlers.handleTransferToOnCall(toolData, res);

      } else if (req.url === '/twilio/collectCallerInfo' && req.method === 'POST') {
        const toolData = body ? JSON.parse(body) : {};
        toolHandlers.handleCollectCallerInfo(toolData, res);

      } else if (req.url === '/twilio/hangUp' && req.method === 'POST') {
        const toolData = body ? JSON.parse(body) : {};
        toolHandlers.handleHangUp(toolData, res);

      } else if (req.url.startsWith('/twilio/executeDial')) {
        // Called by Twilio after Ultravox ends the stream
        // Extract parameters from query string
        const url = new URL(req.url, `http://${req.headers.host}`);
        const number = url.searchParams.get('number') || TRANSFER_NUMBER;
        const reason = url.searchParams.get('reason') || 'emergency';

        logger.info({number, reason}, 'Executing dial after Ultravox stream ended');

        // Return TwiML with Dial verb
        const dialTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to our on-call team now.</Say>
  <Dial>${number}</Dial>
</Response>`;

        res.writeHead(200, {'Content-Type': 'text/xml'});
        res.end(dialTwiml);

      } else if (req.url === '/health') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({status: 'healthy', platform: 'twilio'}));

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
  logger.info(`Twilio handler service listening on port ${PORT}`);
  logger.info(`Incoming call webhook: ${BASE_URL}/twilio/incoming`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
