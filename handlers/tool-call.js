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

  try {
    // Route to appropriate tool handler
    switch (name) {
      case 'transferToOnCall':
      case 'transfer_to_human':
        await handleTransfer(session, tool_call_id, args);
        break;

      case 'collectCallerInfo':
        await handleCollectCallerInfo(session, tool_call_id, args);
        break;

      case 'hangUp':
        await handleHangUp(session, tool_call_id);
        break;

      default:
        logger.warn({tool: name}, 'Unknown tool called');
        session.sendToolOutput(tool_call_id, {
          type: 'client_tool_result',
          invocation_id: tool_call_id,
          error_message: `Unknown tool: ${name}`
        });
    }
  } catch (err) {
    logger.error({err, tool: name}, 'Error handling tool call');
    session.sendToolOutput(tool_call_id, {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      error_message: err.message
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

  logger.info({args}, 'Executing transfer');

  const reason = args.reason || args.conversation_summary || 'Customer requested transfer';

  // TEMPORARY: Hard-code transfer to 3654001512 for testing
  const transferNumber = '+13654001512';

  // Mark call as transferred in database
  try {
    await CallLog.markTransferred(call_sid, transferNumber, reason);
  } catch (err) {
    logger.error({err}, 'Error marking call as transferred');
  }

  // Execute the transfer by replacing active LLM session
  logger.info({transferNumber}, 'Executing transfer with say + dial verb sequence');

  // TEMPORARY: Always use voip.ms-jambonz trunk for testing
  const dialTarget = [{
    type: 'phone',
    number: transferNumber,
    trunk: 'voip.ms-jambonz'
  }];

  logger.info({dialTarget}, 'Using dial target configuration');

  // IMPORTANT: Send tool output FIRST (confirms to Ultravox)
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Transfer initiated'
  });

  logger.info('Tool output sent to Ultravox');

  // Use enqueue pattern to keep caller on hold with music
  // This prevents killing the Ultravox session with redirect
  session
    .say({text: 'Please hold while I transfer you to our on-call team.'})
    .enqueue({
      name: call_sid,
      actionHook: '/consultationDone',
      waitHook: '/wait-music'
    })
    .reply();

  logger.info('Caller enqueued with hold music');

  // Dial specialist on separate leg
  // Based on ultravox-warm-transfer example
  setTimeout(() => {
    logger.info({transferNumber}, 'Dialing specialist');

    session.sendCommand('dial', {
      call_hook: '/dial-specialist',
      from: from,
      to: transferNumber,
      tag: {
        conversation_summary: reason,
        queue: call_sid,
        original_caller: from
      }
    });
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

  // Store in database (could add a caller_info table or update call_logs)
  try {
    await CallLog.updateStatus(call_sid, 'info_collected', {
      caller_name,
      callback_number,
      concern_description
    });
  } catch (err) {
    logger.error({err}, 'Error storing caller info');
  }

  // Respond immediately to Ultravox
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: `Information recorded for ${caller_name}`
  });

  logger.info('Caller info stored and confirmed to AI');
}

/**
 * Hang up the call
 */
async function handleHangUp(session, tool_call_id) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info('Hanging up call');

  try {
    await CallLog.updateStatus(call_sid, 'completed');
  } catch (err) {
    logger.error({err}, 'Error updating call status');
  }

  // CRITICAL: Send tool output FIRST, then hang up
  // Once hangup executes, we can't send tool output anymore
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Call ending'
  });

  // Now hang up the call
  session.sendCommand('redirect', [
    {
      verb: 'hangup'
    }
  ]);
}

module.exports = {handleToolCall};
