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

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'healthy', service: 'jambonz-ws-service'}));
  } else {
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
