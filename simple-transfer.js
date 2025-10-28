require('dotenv').config();
const http = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});
const PORT = process.env.PORT || 3000;

// Simple transfer number - change this to your destination
const TRANSFER_NUMBER = '+13654001512';
const TRANSFER_TRUNK = 'voip.ms-jambonz';

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'healthy'}));
  } else {
    res.writeHead(404);
    res.end();
  }
});

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

  session.locals.logger.info({from, to}, 'New call - simple transfer agent');

  try {
    // Register event handlers
    session
      .on('/toolCall', (evt) => handleTransferTool(session, evt))
      .on('/dialComplete', (evt) => {
        logger.info({evt}, 'Transfer completed');
        session.hangup().reply();
      })
      .on('close', () => {
        logger.info({call_sid}, 'Call ended');
      });

    // Start Ultravox LLM with ONLY transfer capability
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
        toolHook: '/toolCall',
        llmOptions: {
          // MINIMAL PROMPT - just ask and transfer
          systemPrompt: 'You are a transfer agent. Ask the caller: "Would you like me to transfer you to a specialist?" If they say yes, immediately call the transfer tool. If they say no, say goodbye and end the call.',
          firstSpeaker: 'FIRST_SPEAKER_AGENT',
          initialMessages: [{
            medium: 'MESSAGE_MEDIUM_VOICE',
            role: 'MESSAGE_ROLE_USER'
          }],
          model: 'fixie-ai/ultravox',
          voice: 'Jessica',
          transcriptOptional: true,
          // ONLY ONE TOOL - transfer
          selectedTools: [
            {
              temporaryTool: {
                modelToolName: 'transfer',
                description: 'Transfer the call to a specialist',
                dynamicParameters: [],
                client: {}  // CLIENT-SIDE tool per official example
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

/**
 * Handle transfer tool invocation
 * Based on official jambonz/ultravox-transfer-call-example
 */
function handleTransferTool(session, evt) {
  const {logger} = session.locals;
  const {tool_call_id} = evt;

  logger.info('Transfer tool called - executing transfer');

  try {
    // Send tool output immediately
    session.sendToolOutput(tool_call_id, {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      result: 'Transfer initiated'
    });

    // Redirect to dial verb - NO ENQUEUE/DEQUEUE COMPLEXITY
    // This is the official Jambonz pattern from ultravox-transfer-call-example
    session.sendCommand('redirect', [
      {
        verb: 'say',
        text: 'Please wait while I connect you'
      },
      {
        verb: 'dial',
        actionHook: '/dialComplete',
        callerId: session.from,
        target: [
          {
            type: 'phone',
            number: TRANSFER_NUMBER,
            trunk: TRANSFER_TRUNK
          }
        ]
      }
    ]);

    logger.info({number: TRANSFER_NUMBER}, 'Transfer redirect sent');

  } catch (err) {
    logger.error({err}, 'Error executing transfer');
    session.sendToolOutput(tool_call_id, {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      error_message: 'Transfer failed'
    });
  }
}

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
