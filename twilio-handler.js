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
const TRANSFER_NUMBER = '+13654001512';

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
 * Fetch agent prompt from Ultravox and extract referenced variables
 * Returns array of variable names found in the prompt
 */
function getAgentPromptVariables(agentId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.ultravox.ai',
      port: 443,
      path: `/api/agents/${agentId}`,
      method: 'GET',
      headers: {
        'X-API-Key': process.env.ULTRAVOX_API_KEY
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          logger.error({
            statusCode: res.statusCode,
            agentId,
            response: responseData.substring(0, 200)
          }, 'Failed to fetch agent configuration');
          reject(new Error(`Failed to fetch agent: ${res.statusCode}`));
          return;
        }

        try {
          const agentData = JSON.parse(responseData);
          const systemPrompt = agentData?.callTemplate?.systemPrompt || '';

          // Extract all {{variable}} references using regex
          const variableRegex = /\{\{(\w+)\}\}/g;
          const variables = new Set();
          let match;

          while ((match = variableRegex.exec(systemPrompt)) !== null) {
            variables.add(match[1]);
          }

          const varArray = Array.from(variables);

          logger.info({
            agentId,
            variablesFound: varArray.length,
            variables: varArray
          }, 'Extracted template variables from agent prompt');

          resolve(varArray);
        } catch (err) {
          logger.error({err, agentId}, 'Failed to parse agent data');
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      logger.error({err, agentId}, 'HTTP error fetching agent');
      reject(err);
    });

    req.end();
  });
}

/**
 * Filter template context to only include variables referenced in the prompt
 * Converts all values to strings to match Ultravox's string-only schema
 */
function filterTemplateContext(fullContext, referencedVariables) {
  const filtered = {};

  for (const varName of referencedVariables) {
    if (varName in fullContext) {
      const value = fullContext[varName];
      // Convert all values to strings for Ultravox compatibility
      filtered[varName] = String(value);
    } else {
      logger.warn({varName}, 'Variable referenced in prompt but not available in context');
    }
  }

  return filtered;
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

  // Build FULL template context with ALL available variables
  const fullTemplateContext = {
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

  // Fetch agent prompt and extract referenced variables
  const referencedVariables = await getAgentPromptVariables(clientData.ultravox_agent_id);

  // Filter to only include variables referenced in the prompt
  const templateContext = filterTemplateContext(fullTemplateContext, referencedVariables);

  logger.info({
    callSid,
    agentId: clientData.ultravox_agent_id,
    totalVariablesAvailable: Object.keys(fullTemplateContext).length,
    variablesReferenced: referencedVariables.length,
    variablesSent: Object.keys(templateContext).length,
    templateContext
  }, 'Using filtered template context based on agent prompt');

  // Create Ultravox call via REST API using Agent Template
  const callConfig = {
    templateContext,
    medium: {
      twilio: {}
    }
  };

  const ultravoxResponse = await createUltravoxCallWithAgent(clientData.ultravox_agent_id, callConfig);
  logger.info({callSid, ultravoxResponse}, 'Got Ultravox joinUrl');

  // Store mapping of ultravox_call_id to twilio_call_sid for tool invocations
  try {
    await supabase.from('twilio_ultravox_calls').insert({
      twilio_call_sid: callSid,
      ultravox_call_id: ultravoxResponse.callId,
      from_number: from,
      to_number: to
    });
    logger.info({callSid, ultravoxCallId: ultravoxResponse.callId}, 'Stored call mapping');
  } catch (mappingError) {
    logger.error({callSid, ultravoxCallId: ultravoxResponse.callId, error: mappingError}, 'Failed to store call mapping');
    // Don't fail the call if mapping storage fails - log and continue
  }

  // Generate TwiML with joinUrl from Ultravox
  const twimlResponse = new twilio.twiml.VoiceResponse();
  const connect = twimlResponse.connect();
  connect.stream({
    url: ultravoxResponse.joinUrl,
    name: 'ultravox'
  });

  return twimlResponse.toString();
}

/**
 * Handle transfer for Twilio calls using REST API
 */
async function handleTwilioTransfer(toolData, req, res) {
  try {
    // Extract Ultravox call ID from request header
    const ultravoxCallId = req.headers['x-ultravox-call-token'];

    if (!ultravoxCallId) {
      throw new Error('Missing X-Ultravox-Call-Token header');
    }

    // Look up Twilio call_sid from database
    const {supabase} = require('./lib/supabase');
    const {data: mapping, error: mappingError} = await supabase
      .from('twilio_ultravox_calls')
      .select('twilio_call_sid')
      .eq('ultravox_call_id', ultravoxCallId)
      .single();

    if (mappingError || !mapping) {
      throw new Error(`Could not find twilio_call_sid for ultravox_call_id: ${ultravoxCallId}`);
    }

    const call_sid = mapping.twilio_call_sid;
    const {to_phone_number, conversation_summary} = toolData;

    logger.info({
      ultravoxCallId,
      call_sid,
      to_phone_number,
      conversation_summary
    }, 'Handling Twilio transfer via REST API');

    if (!call_sid) {
      throw new Error('Missing call_sid in mapping');
    }

    // Load client from database using the clinic number (to_phone_number)
    const {data: clientData, error: clientError} = await supabase
      .from('clients')
      .select('*')
      .eq('vetwise_phone', to_phone_number)
      .single();

    if (clientError || !clientData) {
      throw new Error(`No client found for phone number ${to_phone_number}`);
    }

    if (!clientData.primary_transfer_number) {
      throw new Error(`No primary_transfer_number configured for client ${clientData.name}`);
    }

    const transferNumber = clientData.primary_transfer_number;

    logger.info({
      call_sid,
      transferNumber,
      clientName: clientData.name
    }, 'Transferring call using Twilio REST API');

    // Generate TwiML to dial the transfer number
    // Use the Twilio number (to_phone_number) as caller ID since we can't spoof
    const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I transfer your call.</Say>
  <Dial callerId="${to_phone_number}">${transferNumber}</Dial>
</Response>`;

    // Update the active call using Twilio REST API
    await twilioClient.calls(call_sid).update({
      twiml: transferTwiml
    });

    logger.info({call_sid, transferNumber}, 'Successfully initiated transfer via Twilio REST API');

    // Respond to Ultravox tool call
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      success: true,
      message: 'Transfer initiated'
    }));

  } catch (err) {
    logger.error({err, toolData}, 'Error handling Twilio transfer');
    res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      success: false,
      error: err.message
    }));
  }
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
        // Handle Twilio transfer via REST API
        const toolData = body ? JSON.parse(body) : {};
        await handleTwilioTransfer(toolData, req, res);

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
