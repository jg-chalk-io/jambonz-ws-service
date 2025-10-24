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

      // Return success - the actual transfer logic needs access to the call session
      // For now, just acknowledge receipt
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        result: 'Transfer request acknowledged'
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

  try {
    // Register event handlers for this session
    // IMPORTANT: WebSocket events use event names like 'llm:tool-call', not path-based like '/toolCall'
    session
      .on('llm:tool-call', (evt) => handleToolCall(session, evt))
      .on('llm:end', (evt) => handleLlmComplete(session, evt))
      .on('llm:event', (evt) => handleLlmEvent(session, evt))
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
