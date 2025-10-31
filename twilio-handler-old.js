require('dotenv').config();
const http = require('http');
const https = require('https');
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
 * Create Ultravox call via REST API (legacy - direct call creation)
 */
function createUltravoxCall(callConfig) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(callConfig);

    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: '/api/calls',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-API-Key': process.env.ULTRAVOX_API_KEY
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        // Check HTTP status code
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          logger.error({
            statusCode: res.statusCode,
            response: responseData.substring(0, 500)
          }, 'Ultravox API error');
          reject(new Error(`Ultravox API returned ${res.statusCode}: ${responseData.substring(0, 200)}`));
          return;
        }

        try {
          const parsedData = JSON.parse(responseData);
          resolve(parsedData);
        } catch (err) {
          logger.error({
            parseError: err.message,
            responseStart: responseData.substring(0, 200)
          }, 'Failed to parse Ultravox response');
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Create Ultravox call using Agent Template with templateContext
 */
function createUltravoxCallWithAgent(agentId, callConfig) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(callConfig);

    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/agents/${agentId}/calls`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-API-Key': process.env.ULTRAVOX_API_KEY
      }
    };

    logger.info({
      agentId,
      path: options.path,
      configSize: data.length
    }, 'Creating Ultravox call with Agent Template');

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        // Check HTTP status code
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          logger.error({
            statusCode: res.statusCode,
            agentId,
            response: responseData.substring(0, 500)
          }, 'Ultravox Agent API error');
          reject(new Error(`Ultravox Agent API returned ${res.statusCode}: ${responseData.substring(0, 200)}`));
          return;
        }

        try {
          const parsedData = JSON.parse(responseData);
          resolve(parsedData);
        } catch (err) {
          logger.error({
            parseError: err.message,
            agentId,
            responseStart: responseData.substring(0, 200)
          }, 'Failed to parse Ultravox Agent response');
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      logger.error({err, agentId}, 'HTTP request error to Ultravox Agent API');
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Generate TwiML for incoming call with Ultravox connection
 */
async function generateIncomingCallTwiML(from, to, callSid) {
  // Load client from database using the clinic number (to)
  const {supabase} = require('./lib/supabase');
  const {data: clientData, error: clientError} = await supabase
    .from('clients')
    .select('*')
    .eq('vetwise_phone', to)
    .single();

  if (clientError || !clientData) {
    throw new Error(`No client found for phone number ${to}`);
  }

  if (!clientData.ultravox_agent_id) {
    throw new Error(`No ultravox_agent_id configured for client ${clientData.name}`);
  }

  // Get current date/time in clinic timezone
  const timezone = clientData.business_hours_config?.timezone || 'America/Toronto';
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
  const currentDateTime = formatter.format(now);

  // Extract date and time components
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
  const currentDate = dateFormatter.format(now);
  const currentTime = timeFormatter.format(now);
  const dayOfWeek = new Intl.DateTimeFormat('en-US', {timeZone: timezone, weekday: 'long'}).format(now);

  const hour = parseInt(new Intl.DateTimeFormat('en-US', {timeZone: timezone, hour: 'numeric', hour12: false}).format(now));
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  // Format phone numbers
  const callerLast4 = from ? from.slice(-4) : '****';
  const callerFormatted = from ? `(${from.slice(2, 5)}) ${from.slice(5, 8)}-${from.slice(8)}` : 'Unknown';
  const toFormatted = to ? `(${to.slice(2, 5)}) ${to.slice(5, 8)}-${to.slice(8)}` : '';

  // Business hours check (TODO: Implement proper business hours logic)
  const isOpen = false;  // Placeholder
  const isClosed = true;  // Placeholder

  // Build comprehensive template context with ALL available variables
  const templateContext = {
    // === TWILIO CALL PARAMETERS ===
    call_sid: callSid,
    caller_phone_number: from || '',
    caller_phone_last4: callerLast4,
    caller_phone_formatted: callerFormatted,
    to_phone_number: to || '',
    to_phone_formatted: toFormatted,

    // === CLIENT DATABASE FIELDS ===
    client_id: clientData.id,
    client_name: clientData.name,
    office_name: clientData.office_name || clientData.name,
    office_phone: clientData.office_phone || '',
    office_website: clientData.office_website || '',
    office_hours: clientData.office_hours || 'Please check our website',
    primary_transfer_number: clientData.primary_transfer_number || '',
    secondary_transfer_number: clientData.secondary_transfer_number || '',
    vetwise_phone: clientData.vetwise_phone || '',
    voicemail_enabled: clientData.voicemail_enabled || false,
    business_hours_enabled: clientData.business_hours_enabled || false,

    // === COMPUTED DATE/TIME VALUES ===
    current_date: currentDate,
    current_time: currentTime,
    current_datetime: currentDateTime,
    day_of_week: dayOfWeek,
    time_of_day: timeOfDay,

    // === BUSINESS HOURS STATUS ===
    clinic_open: isOpen,
    clinic_closed: isClosed,
    is_the_clinic_open: isOpen ? 'yes' : 'no',

    // === AGENT CONFIGURATION ===
    agent_name: clientData.agent_voice || 'Jessica',
    agent_temperature: clientData.agent_temperature || 0.4,
    debug_mode: process.env.NODE_ENV === 'development'
  };

  logger.info({
    callSid,
    agentId: clientData.ultravox_agent_id,
    templateContext
  }, 'Using Ultravox Agent Template');

  // NOTE: When using Agent Templates, tools must be configured in the Ultravox dashboard
  // They cannot be passed dynamically at call creation time
  // The tool definitions below are kept for reference only - configure these in Ultravox UI
  /*
  const selectedTools = [
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
  */

  // Create Ultravox call via REST API using Agent Template
  // NOTE: Tools must be configured in the agent template itself via Ultravox dashboard
  // They cannot be passed via selectedTools when using agent templates
  const callConfig = {
    templateContext,
    medium: {
      twilio: {}
    }
  };

  const ultravoxResponse = await createUltravoxCallWithAgent(clientData.ultravox_agent_id, callConfig);
  logger.info({callSid, ultravoxResponse}, 'Got Ultravox joinUrl');

  // Generate TwiML with joinUrl from Ultravox
  const twimlResponse = new twilio.twiml.VoiceResponse();
  const connect = twimlResponse.connect();
  connect.stream({
    url: ultravoxResponse.joinUrl,
    name: 'ultravox'
  });

  return twimlResponse.toString();
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
