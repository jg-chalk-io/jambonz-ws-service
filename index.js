require('dotenv').config();

// Enable Jambonz SDK debug logging
process.env.DEBUG = 'jambonz:*';

const http = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const pino = require('pino');
const {handleIncomingCall} = require('./handlers/incoming-call');
const {handleToolCall} = require('./handlers/tool-call');
const {handleLlmComplete} = require('./handlers/llm-complete');
const {handleLlmEvent} = require('./handlers/llm-event');
const {handleCallStatus} = require('./handlers/call-status');

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
      logger.info({payload}, 'Received transferToOnCall HTTP tool call');

      // Extract call_sid from payload (passed through metadata)
      const call_sid = payload.call_sid || payload.callSid || payload.metadata?.call_sid;

      if (!call_sid) {
        logger.error({payload}, 'No call_sid found in transferToOnCall payload');
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'call_sid is required'}));
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

      // Execute the transfer using the tool handler
      logger.info({call_sid}, 'Executing transfer via HTTP tool');

      // Call the handler with a synthetic tool_call_id
      const tool_call_id = payload.invocation_id || `http-${Date.now()}`;
      const args = {
        destination: 'primary',
        conversation_summary: payload.conversation_summary || 'Transfer requested via HTTP tool'
      };

      // Import and execute transfer handler
      handleToolCall(session, {
        name: 'transferToOnCall',
        args,
        tool_call_id
      });

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        result: 'Transfer initiated successfully'
      }));
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
      .on('call:status', (evt) => handleCallStatus(session, evt));

    // Handle the incoming call and generate initial response
    await handleIncomingCall(session);
  } catch (err) {
    session.locals.logger.error({err}, 'Error handling new session');
    session
      .say({text: 'Sorry, an error occurred. Please try again later.'})
      .hangup()
      .reply();
  }
});

// Start server
server.listen(PORT, () => {
  logger.info(`Jambonz WebSocket service listening on port ${PORT}`);
  logger.info(`Health check available at http://localhost:${PORT}/health`);
  logger.info(`WebSocket endpoint: ws://localhost:${PORT}${WS_PATH}`);
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
