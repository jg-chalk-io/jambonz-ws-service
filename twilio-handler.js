require('dotenv').config();
const http = require('http');
const https = require('https');
const twilio = require('twilio');
const pino = require('pino');
const {loadAgentDefinition} = require('./shared/agent-config');
const {createToolHandlers, createTwilioTransfer} = require('./shared/tool-handlers');
const {supabase} = require('./lib/supabase');
const {ToolCallLogger} = require('./lib/tool-call-logger');

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

  // Helper function to strip +1 prefix from phone numbers
  const stripInternationalPrefix = (phone) => {
    if (!phone) return '';
    return phone.replace(/^\+1/, '');
  };

  // Helper function to format phone number digit-by-digit in groups with pauses
  // Example: "4168189171" → "four one six... pause... eight one eight... pause... nine one seven one"
  const formatPhoneDigitByDigit = (phone) => {
    if (!phone || phone.length !== 10) return '';

    const digitWords = {
      '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
      '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
    };

    // Split into groups: area code (3), prefix (3), line number (4)
    const areaCode = phone.substring(0, 3).split('').map(d => digitWords[d]).join(' ');
    const prefix = phone.substring(3, 6).split('').map(d => digitWords[d]).join(' ');
    const lineNumber = phone.substring(6, 10).split('').map(d => digitWords[d]).join(' ');

    // Format with pauses between groups
    return `${areaCode}... pause... ${prefix}... pause... ${lineNumber}`;
  };

  // Strip +1 from phone numbers - provide 10-digit format only
  const callerPhone10Digit = stripInternationalPrefix(from);
  const toPhone10Digit = stripInternationalPrefix(to);
  const officePhone10Digit = stripInternationalPrefix(clientData.office_phone);
  const primaryTransfer10Digit = stripInternationalPrefix(clientData.primary_transfer_number);
  const secondaryTransfer10Digit = stripInternationalPrefix(clientData.secondary_transfer_number);
  const vetwisePhone10Digit = stripInternationalPrefix(clientData.vetwise_phone);

  // Format phone numbers for display (using 10-digit format)
  const callerLast4 = callerPhone10Digit ? callerPhone10Digit.slice(-4) : '****';
  const callerFormatted = callerPhone10Digit ? `(${callerPhone10Digit.slice(0, 3)}) ${callerPhone10Digit.slice(3, 6)}-${callerPhone10Digit.slice(6)}` : 'Unknown';
  const toFormatted = toPhone10Digit ? `(${toPhone10Digit.slice(0, 3)}) ${toPhone10Digit.slice(3, 6)}-${toPhone10Digit.slice(6)}` : '';

  // Format phone number digit-by-digit for AI to speak naturally
  const callerPhoneDigits = formatPhoneDigitByDigit(callerPhone10Digit);

  // Business hours check (TODO: Implement proper business hours logic)
  const isOpen = false;  // Placeholder
  const isClosed = true;  // Placeholder

  // Build FULL template context with ALL available variables
  const fullTemplateContext = {
    // === TWILIO CALL PARAMETERS ===
    call_sid: callSid,
    caller_phone_number: callerPhone10Digit,
    caller_phone_last4: callerLast4,
    caller_phone_formatted: callerFormatted,
    caller_phone_digits: callerPhoneDigits,
    to_phone_number: toPhone10Digit,
    to_phone_formatted: toFormatted,

    // === CLIENT DATABASE FIELDS ===
    client_id: clientData.id,
    client_name: clientData.name,
    office_name: clientData.office_name || clientData.name,
    office_phone: officePhone10Digit,
    office_website: clientData.office_website || '',
    office_hours: clientData.office_hours || 'Please check our website',
    primary_transfer_number: primaryTransfer10Digit,
    secondary_transfer_number: secondaryTransfer10Digit,
    vetwise_phone: vetwisePhone10Digit,
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
    templateContext,  // call_sid already included in templateContext
    medium: {
      twilio: {}
    }
  };

  const ultravoxResponse = await createUltravoxCallWithAgent(clientData.ultravox_agent_id, callConfig);
  logger.info({callSid, ultravoxResponse}, 'Got Ultravox joinUrl');

  // Create call_logs entry
  let callLogId = null;
  try {
    const {data: callLogData, error: callLogError} = await supabase
      .from('call_logs')
      .insert({
        call_sid: callSid,
        from_number: from,
        to_number: to,
        client_id: clientData.id,
        direction: 'inbound',
        status: 'in-progress',
        ultravox_call_id: ultravoxResponse.callId,
        start_time: new Date().toISOString()
      })
      .select('id')
      .single();

    if (callLogError) {
      logger.error({callLogError, callSid}, 'Failed to create call_logs entry');
    } else {
      callLogId = callLogData.id;
      logger.info({callSid, callLogId, ultravoxCallId: ultravoxResponse.callId}, 'Created call_logs entry');
    }
  } catch (callLogException) {
    logger.error({callLogException, callSid}, 'Exception creating call_logs entry');
  }

  // Store mapping of ultravox_call_id to twilio_call_sid for tool invocations
  try {
    await supabase.from('twilio_ultravox_calls').insert({
      twilio_call_sid: callSid,
      ultravox_call_id: ultravoxResponse.callId,
      from_number: from,
      to_number: to,
      call_log_id: callLogId  // Link to call_logs
    });
    logger.info({callSid, ultravoxCallId: ultravoxResponse.callId, callLogId}, 'Stored call mapping');
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
  let logId = null;

  try {
    // Log all request details for debugging
    logger.info({
      toolData,
      headers: req.headers,
      url: req.url
    }, 'Transfer request received');

    // Determine urgency level from tool data
    const urgencyLevel = toolData.urgency_reason?.toLowerCase().includes('critical') ||
                        toolData.urgency_reason?.toLowerCase().includes('emergency')
                        ? 'critical'
                        : 'urgent';

    // Get ultravox_call_id from multiple sources (priority order)
    let ultravoxCallId = toolData.ultravox_call_id ||  // NEW: From tool staticParameters
                         req.headers['x-ultravox-call-id'] ||
                         req.headers['x-call-id'] ||
                         toolData.callId;

    // Look up call_log_id from mapping if possible
    let callLogId = null;
    if (ultravoxCallId) {
      const {data: mapping} = await supabase
        .from('twilio_ultravox_calls')
        .select('call_log_id')
        .eq('ultravox_call_id', ultravoxCallId)
        .single();
      callLogId = mapping?.call_log_id;
    }

    // Log tool call to database IMMEDIATELY for reliability
    logId = await ToolCallLogger.logToolCall({
      toolName: 'transferFromAiTriageWithMetadata',
      toolParameters: toolData,
      ultravoxCallId: ultravoxCallId,
      twilioCallSid: null, // Will be determined below
      callLogId: callLogId, // Link to call_logs
      callbackNumber: toolData.callback_number,
      callerName: toolData.caller_name,
      urgencyLevel: urgencyLevel,
      toolData: {
        ...toolData,
        requestHeaders: req.headers,
        timestamp: new Date().toISOString()
      }
    });

    // If call_sid is present but looks like an uninterpolated template variable, ignore it
    const call_sid_from_tool = toolData.call_sid;
    if (call_sid_from_tool && call_sid_from_tool.includes('{{')) {
      logger.warn({call_sid_from_tool}, 'Ignoring uninterpolated template variable');
    } else if (call_sid_from_tool && call_sid_from_tool.startsWith('CA')) {
      // Valid Twilio call SID format - use it directly
      logger.info({call_sid: call_sid_from_tool}, 'Using call_sid from tool data directly');

      // Get client info from callback_number
      const callback_number = toolData.callback_number;

      // Look up to_phone_number from mapping if available
      const {data: callMapping} = await supabase
        .from('twilio_ultravox_calls')
        .select('to_number')
        .eq('twilio_call_sid', call_sid_from_tool)
        .single();

      const to_phone_number = callMapping?.to_number || callback_number;

      await performTransfer(call_sid_from_tool, to_phone_number, toolData, res);
      return;
    }

    // Fallback: Look up via Ultravox call ID
    if (!ultravoxCallId) {
      logger.error({toolData, headers: req.headers}, 'Cannot determine Ultravox call ID');
      throw new Error('Cannot determine Ultravox call ID - no header or field found');
    }

    logger.info({ultravoxCallId}, 'Looking up Twilio call SID from Ultravox call ID');

    // Look up Twilio call SID from mapping table
    const {data: callMapping, error: mappingError} = await supabase
      .from('twilio_ultravox_calls')
      .select('twilio_call_sid, from_number, to_number')
      .eq('ultravox_call_id', ultravoxCallId)
      .single();

    if (mappingError || !callMapping) {
      logger.error({ultravoxCallId, mappingError}, 'Failed to find call mapping');
      throw new Error(`No call mapping found for Ultravox call ${ultravoxCallId}`);
    }

    const call_sid = callMapping.twilio_call_sid;
    const to_phone_number = callMapping.to_number;

    await performTransfer(call_sid, to_phone_number, toolData, res);

    // Mark tool call as successful
    if (logId) {
      await ToolCallLogger.logSuccess(logId, {
        call_sid,
        to_phone_number,
        transfer_completed_at: new Date().toISOString()
      });
    }

  } catch (err) {
    logger.error({err, toolData}, 'Error handling Twilio transfer');

    // Mark tool call as failed - THIS TRIGGERS CALLBACK RETRY
    if (logId) {
      await ToolCallLogger.logFailure(logId, err.message, {
        error: err.message,
        stack: err.stack,
        toolData
      });
    }

    res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      success: false,
      error: err.message
    }));
  }
}

/**
 * Perform the actual transfer via Twilio REST API
 */
async function performTransfer(call_sid, to_phone_number, toolData, res) {
  logger.info({
    call_sid,
    to_phone_number
  }, 'Performing Twilio transfer');

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
