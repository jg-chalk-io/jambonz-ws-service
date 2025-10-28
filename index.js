require('dotenv').config();

// Enable Jambonz SDK debug logging
// process.env.DEBUG = 'jambonz:*';  // DISABLED: Causes service to hang from excessive log volume

const http = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const pino = require('pino');
const {handleIncomingCall} = require('./handlers/incoming-call');
const {testSimpleTransfer} = require('./test-simple-transfer');
const {handleToolCall} = require('./handlers/tool-call');
const {handleLlmComplete} = require('./handlers/llm-complete');
const {handleLlmEvent} = require('./handlers/llm-event');
const {handleCallStatus} = require('./handlers/call-status');
const {handleOutboundDial} = require('./handlers/outbound-dial');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

const PORT = process.env.PORT || 3000;
const WS_PATH = process.env.WS_PATH || '/ws';

// Store active WebSocket sessions keyed by call_sid
// This allows HTTP tool webhooks to find and control the correct session
const activeSessions = new Map();

// Create HTTP server with webhook endpoints for Ultravox HTTP tools
const server = http.createServer(async (req, res) => {
  // Log ALL incoming requests to debug Ultravox webhook calls
  logger.info({method: req.method, url: req.url, headers: req.headers}, 'Incoming HTTP request');

  // Parse request body for POST requests
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  await new Promise(resolve => req.on('end', resolve));

  // Log request body for debugging
  if (body) {
    logger.info({body: body.substring(0, 500)}, 'Request body received');
  }

  // Handle routes
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'healthy', service: 'jambonz-ws-service'}));
  }
  else if (req.url === '/transferToOnCall' && req.method === 'POST') {
    try {
      const payload = JSON.parse(body);
      logger.info({payload}, 'Received transferToOnCall HTTP tool call from Ultravox');

      // Ultravox sends: invocationId, parameters, and call metadata
      // We need the Jambonz call_sid to look up the WebSocket session
      // Check multiple possible locations for call_sid
      let call_sid = null;

      // Try to get from query params (if sent that way)
      if (req.url.includes('?')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        call_sid = urlParams.get('call_sid');
      }

      // Try to get from request body
      if (!call_sid) {
        call_sid = payload.call_sid || payload.callSid || payload.parameters?.call_sid;
      }

      // Try to get from metadata (passed when creating Ultravox call)
      if (!call_sid && payload.metadata) {
        call_sid = payload.metadata.call_sid;
      }

      logger.info({call_sid, payload_keys: Object.keys(payload)}, 'Extracted call_sid from payload');

      if (!call_sid) {
        logger.error({payload}, 'No call_sid found in any location of transferToOnCall payload');
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'call_sid is required', received: payload}));
        return;
      }

      // Look up the active WebSocket session
      const session = activeSessions.get(call_sid);

      if (!session) {
        logger.error({call_sid, activeSessions: Array.from(activeSessions.keys())}, 'No active session found for call_sid');
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Session not found'}));
        return;
      }

      // Respond immediately to Ultravox (ends AI session, saves time/money)
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        result: 'Transfer initiated successfully'
      }));

      // Execute the transfer using enqueue pattern (like ultravox-warm-transfer example)
      logger.info({call_sid}, 'Executing transfer via HTTP tool with enqueue pattern');

      // Accept enum transfer_reason or legacy text parameters
      const transfer_reason = payload.transfer_reason || 'other';
      const conversation_summary = payload.caller_request || payload.conversation_summary || `Transfer reason: ${transfer_reason}`;
      const transferNumber = '+13654001512';

      // Mark call as transferred in database
      try {
        const {CallLog} = require('./models/CallLog');
        await CallLog.markTransferred(call_sid, transferNumber, conversation_summary);
      } catch (err) {
        logger.error({err}, 'Error marking call as transferred');
      }

      // Put caller in queue with hold music
      session
        .say({text: 'Please hold while I transfer you to our on-call team.'})
        .enqueue({
          name: call_sid,
          actionHook: '/consultationDone',
          waitHook: '/wait-music'
        })
        .reply();

      // Dial specialist on separate leg using REST API
      // sendCommand creates a NEW outbound call leg (not redirect)
      setTimeout(() => {
        logger.info({transferNumber, call_sid, from: session.from}, 'Dialing specialist via REST API');

        session.sendCommand('dial', {
          call_hook: '/dial-specialist',
          to: {
            type: 'phone',
            number: transferNumber,
            trunk: 'voip.ms-jambonz'
          },
          tag: {
            original_caller: session.from,
            conversation_summary,
            queue: call_sid
          }
        });

        logger.info('Dial command sent via sendCommand (REST API)');
      }, 500);
    } catch (err) {
      logger.error({err}, 'Error handling transferToOnCall');
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
  }
  else if (req.url === '/collectCallerInfo' && req.method === 'POST') {
    try {
      const payload = JSON.parse(body);
      logger.info({payload}, 'Received collectCallerInfo HTTP tool call');

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        result: 'Caller information collected'
      }));
    } catch (err) {
      logger.error({err}, 'Error handling collectCallerInfo');
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
  }
  else if (req.url === '/toolCall' && req.method === 'POST') {
    try {
      const payload = JSON.parse(body);
      logger.info({payload}, 'Received /toolCall HTTP webhook from Ultravox');

      const conversation_summary = payload.conversation_summary || 'Transfer requested';
      const invocation_id = payload.invocationId || `http-${Date.now()}`;

      // Hard-code transfer details
      const transferNumber = '+13654001512';
      const call_sid = payload.callId || 'unknown';

      logger.info({conversation_summary, transferNumber, call_sid}, 'Executing transfer from HTTP tool');

      // Return success to Ultravox immediately
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        result: 'Transfer initiated'
      }));

      // Execute transfer asynchronously
      // NOTE: We don't have access to the WebSocket session from HTTP endpoint
      // This is the fundamental limitation we need to solve
      logger.warn('HTTP tool called but cannot access WebSocket session for dial execution');

    } catch (err) {
      logger.error({err}, 'Error handling /toolCall');
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
  }
  else if (req.url === '/dial-specialist' && req.method === 'POST') {
    try {
      const payload = JSON.parse(body);
      logger.info({payload}, 'Received dial-specialist webhook');

      // Extract conversation context from tag
      const conversation_summary = payload.tag?.conversation_summary || 'Transfer requested';
      const queue = payload.tag?.queue;
      const original_caller = payload.tag?.original_caller || payload.from;

      logger.info({conversation_summary, queue, original_caller}, 'Briefing specialist');

      // Return verbs: brief specialist, then dequeue caller
      const response = [
        {
          verb: 'say',
          text: `You have a transferred call from ${original_caller}. ${conversation_summary}. Now connecting you to the caller.`
        },
        {
          verb: 'dequeue',
          name: queue,
          beep: true,
          timeout: 2,
          actionHook: '/dequeueResult'
        }
      ];

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(response));
    } catch (err) {
      logger.error({err}, 'Error handling dial-specialist');
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
  }
  else if (req.url === '/outbound-dial' && req.method === 'POST') {
    try {
      const payload = JSON.parse(body);
      logger.info({payload}, 'Received outbound dial webhook from registered softphone');

      // Use outbound-dial handler to generate dial verb response
      handleOutboundDial({body: payload}, {
        json: (data) => {
          logger.info({response: data}, 'Sending outbound dial response');
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify(data));
        }
      });
    } catch (err) {
      logger.error({err}, 'Error handling outbound dial');
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: err.message}));
    }
  }
  else {
    logger.warn({method: req.method, url: req.url}, 'Unknown route - returning 404');
    res.writeHead(404);
    res.end();
  }
});

// Create WebSocket endpoint
const makeService = createEndpoint({server});
const svc = makeService({path: WS_PATH});

logger.info(`WebSocket endpoint created at ${WS_PATH}`);

// Handle new sessions (incoming calls)
svc.on('session:new', async (session) => {
  const {call_sid, from, to, direction} = session;

  // Set up session logging
  session.locals = {
    ...session.locals,
    logger: logger.child({call_sid})
  };

  session.locals.logger.info({from, to, direction}, 'New call session');

  // Register this session in the active sessions map
  activeSessions.set(call_sid, session);
  logger.info({call_sid, totalActiveSessions: activeSessions.size}, 'Session registered in active sessions');

  // Clean up session when call ends
  session.on('close', () => {
    activeSessions.delete(call_sid);
    logger.info({call_sid, totalActiveSessions: activeSessions.size}, 'Session removed from active sessions');
  });

  try {
    // Register event handlers for this session
    // With client: {} tools, hooks are emitted as custom event paths (not verb:hook)
    // See: https://github.com/jambonz/ultravox-s2s-example
    session
      .on('/toolCall', (evt) => {
        console.log('=== EMERGENCY DEBUG: /toolCall event received ===', {
          tool_call_id: evt.tool_call_id,
          name: evt.name,
          args: evt.args,
          timestamp: new Date().toISOString()
        });
        logger.info({evt}, 'Received /toolCall event');
        logger.info({
          tool_call_id: evt.tool_call_id,
          name: evt.name,
          args: evt.args
        }, 'Tool call details');
        handleToolCall(session, evt);
      })
      .on('/llmComplete', (evt) => {
        logger.info({evt}, 'Received /llmComplete event');
        handleLlmComplete(session, evt);
      })
      .on('/llmEvent', (evt) => {
        logger.info({evt}, 'Received /llmEvent event');
        handleLlmEvent(session, evt);
      })
      .on('/dialComplete', (evt) => {
        logger.info({evt}, 'Received /dialComplete event - transfer finished');
        // No action needed - call will end naturally
        // Respond with empty array to acknowledge
        session.reply([]);
      })
      .on('/consultationDone', (evt) => {
        logger.info({evt}, 'Received /consultationDone event - queue operation complete');
        // Caller was dequeued and connected, or queue timed out
        session.reply([]);
      })
      .on('/wait-music', (evt) => {
        logger.info({evt}, 'Received /wait-music event - playing hold music');
        // Play hold music while caller waits in queue
        session.reply([{
          verb: 'play',
          url: 'https://www.kozco.com/tech/piano2.wav',
          loop: true
        }]);
      })
      .on('call:status', (evt) => handleCallStatus(session, evt));

    // Handle incoming call with Ultravox AI
    await handleIncomingCall(session);
  } catch (err) {
    session.locals.logger.error({err}, 'Error handling new session');
    session
      .say({text: 'Sorry, an error occurred. Please try again later.'})
      .hangup()
      .reply();
  }
});

// Create specialist WebSocket endpoint - handles outbound calls to human agents
const specialistSvc = makeService({path: '/dial-specialist'});

specialistSvc.on('session:new', async (session) => {
  const {call_sid} = session;

  session.locals = {
    ...session.locals,
    logger: logger.child({call_sid, role: 'specialist'})
  };

  session.locals.logger.info('Specialist call connected');

  try {
    // Extract queue name and conversation summary from customerData headers
    const queueName = session.customerData?.['X-Queue'];
    const conversationSummary = session.customerData?.['X-Transfer-Reason'];
    const originalCaller = session.customerData?.['X-Original-Caller'];

    session.locals.logger.info({queueName, conversationSummary}, 'Briefing specialist');

    // Brief the specialist, then bridge to caller
    session
      .say({
        text: `You have a transferred call from ${originalCaller}. ${conversationSummary}. Now connecting you to the caller.`
      })
      .dequeue({
        name: queueName,
        beep: true,
        timeout: 2,
        actionHook: '/dequeue'
      })
      .reply();

    // Handle dequeue result
    session.on('/dequeue', (evt) => {
      session.locals.logger.info({evt}, 'Dequeue result');

      if (evt.dequeueResult === 'timeout') {
        session.locals.logger.info('Caller hung up before connection');
        session
          .say({text: 'Sorry, the caller hung up.'})
          .hangup()
          .reply();
      }
      // On success, calls are bridged automatically
    });

  } catch (err) {
    session.locals.logger.error({err}, 'Error handling specialist call');
    session
      .say({text: 'Sorry, an error occurred.'})
      .hangup()
      .reply();
  }
});

logger.info('Specialist WebSocket endpoint created at /dial-specialist');

// Start server
server.listen(PORT, () => {
  logger.info(`Jambonz WebSocket service listening on port ${PORT}`);
  logger.info(`Health check available at http://localhost:${PORT}/health`);
  logger.info(`WebSocket endpoint: ws://localhost:${PORT}${WS_PATH}`);
  logger.info(`Specialist endpoint: ws://localhost:${PORT}/dial-specialist`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
