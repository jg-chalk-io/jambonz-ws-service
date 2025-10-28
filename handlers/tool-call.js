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
  console.log('=== EMERGENCY DEBUG: handleTransfer called ===', {
    tool_call_id,
    args,
    timestamp: new Date().toISOString()
  });

  const {logger, client} = session.locals;
  const {call_sid, from} = session;

  logger.info({args, call_sid, from}, 'handleTransfer CALLED - starting transfer execution');

  const reason = args.reason || args.transfer_reason || args.conversation_summary || 'Customer requested transfer';

  // TEMPORARY: Hard-code transfer to 3654001512 for testing
  const transferNumber = '+13654001512';

  logger.info({reason, transferNumber}, 'Transfer details extracted');

  console.log('=== EMERGENCY DEBUG: About to call sendToolOutput ===');

  // CRITICAL: Send tool output FIRST (confirms to Ultravox) - MUST be before ANY async operations
  try {
    session.sendToolOutput(tool_call_id, {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      result: 'Transfer initiated'
    });
    console.log('=== EMERGENCY DEBUG: sendToolOutput completed ===');
    logger.info('Tool output sent to Ultravox successfully');
  } catch (err) {
    console.log('=== EMERGENCY DEBUG: sendToolOutput ERROR ===', err);
    logger.error({err}, 'Error sending tool output');
  }

  // Mark call as transferred in database (async, non-blocking)
  CallLog.markTransferred(call_sid, transferNumber, reason)
    .then(() => logger.info('CallLog.markTransferred completed successfully'))
    .catch(err => logger.error({err}, 'Error marking call as transferred'));

  console.log('=== EMERGENCY DEBUG: About to enqueue caller ===');

  // Enqueue caller with hold music (keep LLM session alive)
  try {
    session
      .say({text: 'Please hold while I transfer you to our on-call team.'})
      .enqueue({
        name: call_sid,
        actionHook: '/consultationDone',
        waitHook: '/wait-music'
      })
      .reply();
    console.log('=== EMERGENCY DEBUG: Caller enqueued, about to dial specialist ===');
    logger.info({call_sid}, 'Caller enqueued with hold music');
  } catch (err) {
    console.log('=== EMERGENCY DEBUG: enqueue ERROR ===', err);
    logger.error({err}, 'Error enqueuing caller');
    return;
  }

  // Dial specialist using REST API with correct Jambonz payload structure
  // NOTE: No 'from' parameter - VoIP.ms requires verified caller IDs
  setTimeout(() => {
    console.log('=== EMERGENCY DEBUG: Dialing specialist now ===');
    try {
      const baseUrl = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';

      session.sendCommand('dial', {
        call_hook: {
          url: `${baseUrl}/dial-specialist`,
          method: 'POST'
        },
        // No 'from' - use trunk default caller ID (VoIP.ms requires verified IDs)
        to: {
          type: 'phone',
          number: transferNumber
        },
        tag: {
          original_caller: from,
          conversation_summary: reason,
          queue: call_sid
        }
      });
      console.log('=== EMERGENCY DEBUG: Dial sent - using trunk default caller ID ===');
      logger.info({transferNumber, call_sid, originalCaller: from, baseUrl}, 'Specialist dial sent (trunk default caller ID)');
    } catch (err) {
      console.log('=== EMERGENCY DEBUG: dial ERROR ===', err);
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
