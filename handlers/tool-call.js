const {CallLog} = require('../models/CallLog');

/**
 * Handle tool calls from Ultravox AI agent
 * The session object provides full call context
 *
 * IMPORTANT: Must respond immediately with sendToolOutput to avoid timeout
 */
async function handleToolCall(session, evt) {
  const {logger, client} = session.locals;
  const {call_sid} = session;
  const {name, args, tool_call_id} = evt;

  logger.info({tool: name, args, tool_call_id}, 'Tool call received');

  // Route to appropriate tool handler
  // CRITICAL: Don't await - let handlers run async since they sendToolOutput immediately
  switch (name) {
    case 'transferToOnCall':
    case 'transfer_to_human':
      handleTransfer(session, tool_call_id, args).catch(err => {
        logger.error({err, tool: name}, 'Error in handleTransfer');
        session.sendToolOutput(tool_call_id, {
          type: 'client_tool_result',
          invocation_id: tool_call_id,
          error_message: err.message
        });
      });
      break;

    case 'collectCallerInfo':
      handleCollectCallerInfo(session, tool_call_id, args).catch(err => {
        logger.error({err, tool: name}, 'Error in handleCollectCallerInfo');
      });
      break;

    case 'hangUp':
      handleHangUp(session, tool_call_id).catch(err => {
        logger.error({err, tool: name}, 'Error in handleHangUp');
      });
      break;

    default:
      logger.warn({tool: name}, 'Unknown tool called');
      session.sendToolOutput(tool_call_id, {
        type: 'client_tool_result',
        invocation_id: tool_call_id,
        error_message: `Unknown tool: ${name}`
      });
  }
}

/**
 * Transfer call to human agent
 * Uses Jambonz pattern: sendToolOutput immediately, then redirect
 */
async function handleTransfer(session, tool_call_id, args) {
  const {logger, client} = session.locals;
  const {call_sid, from} = session;

  logger.info({args, call_sid, from}, 'handleTransfer CALLED - starting transfer execution');

  const conversation_summary = args.reason || args.transfer_reason || args.conversation_summary || 'Customer requested transfer';

  // Hard-code transfer number for testing
  const transferNumber = '+13654001512';

  logger.info({conversation_summary, transferNumber}, 'Transfer details extracted');

  // CRITICAL: Send tool output FIRST (confirms to Ultravox)
  try {
    session.sendToolOutput(tool_call_id, {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      result: 'Successfully initiated transfer to specialist.'
    });
    logger.info('Tool output sent to Ultravox successfully');
  } catch (err) {
    logger.error({err}, 'Error sending tool output');
  }

  // Mark call as transferred in database (async, non-blocking)
  CallLog.markTransferred(call_sid, transferNumber, conversation_summary)
    .then(() => logger.info('CallLog.markTransferred completed successfully'))
    .catch(err => logger.error({err}, 'Error marking call as transferred'));

  // Redirect call away from LLM to enqueue pattern
  // Using sendCommand('redirect') to replace LLM verb execution
  try {
    session.sendCommand('redirect', [
      {
        verb: 'say',
        text: 'Please hold while I transfer you to our on-call team.'
      },
      {
        verb: 'enqueue',
        name: call_sid,
        actionHook: '/consultationDone',
        waitHook: '/wait-music'
      }
    ]);
    logger.info({call_sid}, 'Call redirected to enqueue pattern');
  } catch (err) {
    logger.error({err}, 'Error redirecting to enqueue');
    return;
  }

  // Dial specialist using sendCommand REST API (Jambonz pattern)
  // This creates a SEPARATE outbound call leg
  setTimeout(() => {
    try {
      session.sendCommand('dial', {
        call_hook: '/dial-specialist',
        to: {
          type: 'phone',
          number: transferNumber,
          trunk: 'voip.ms-jambonz'
        },
        tag: {
          conversation_summary,
          queue: call_sid
        },
        speech_synthesis_vendor: 'google',
        speech_synthesis_language: 'en-US',
        speech_synthesis_voice: 'en-US-Wavenet-C'
      });
      logger.info({transferNumber, call_sid, conversation_summary}, 'Specialist dial command sent via REST API');
    } catch (err) {
      logger.error({err}, 'Error dialing specialist');
    }
  }, 500);
}

/**
 * Collect caller information
 */
async function handleCollectCallerInfo(session, tool_call_id, args) {
  const {logger} = session.locals;
  const {call_sid} = session;

  const {caller_name, callback_number, concern_description} = args;

  logger.info({
    caller_name,
    callback_number,
    concern: concern_description
  }, 'Caller info collected');

  // CRITICAL: Respond immediately to Ultravox FIRST
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: `Information recorded for ${caller_name}`
  });

  // Store in database (async, non-blocking)
  CallLog.updateStatus(call_sid, 'info_collected', {
    caller_name,
    callback_number,
    concern_description
  })
    .then(() => logger.info('Caller info stored successfully'))
    .catch(err => logger.error({err}, 'Error storing caller info'));

  logger.info('Caller info confirmed to AI, DB update running in background');
}

/**
 * Hang up the call
 */
async function handleHangUp(session, tool_call_id) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info('Hanging up call');

  // CRITICAL: Send tool output FIRST, then hang up
  // Once hangup executes, we can't send tool output anymore
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Call ending'
  });

  // Update database status (async, non-blocking)
  CallLog.updateStatus(call_sid, 'completed')
    .catch(err => logger.error({err}, 'Error updating call status'));

  // Now hang up the call
  session.sendCommand('redirect', [
    {
      verb: 'hangup'
    }
  ]);
}

module.exports = {handleToolCall};
