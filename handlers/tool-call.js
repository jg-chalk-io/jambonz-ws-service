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
          success: false,
          error: `Unknown tool: ${name}`
        });
    }
  } catch (err) {
    logger.error({err, tool: name}, 'Error handling tool call');
    session.sendToolOutput(tool_call_id, {
      success: false,
      error: err.message
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

  const destination = args.destination || 'primary';
  const reason = args.reason || args.conversation_summary || 'Customer requested human agent';

  // Get transfer phone number from client config
  let transferNumber;
  if (destination === 'primary') {
    transferNumber = client.primary_transfer_number;
  } else if (destination === 'secondary') {
    transferNumber = client.secondary_transfer_number;
  } else if (destination === 'voicemail') {
    transferNumber = client.voicemail_number;
  }

  if (!transferNumber) {
    logger.error({destination}, 'No transfer number configured for destination');
    // Respond to Ultravox immediately
    session.sendToolOutput(tool_call_id, {
      success: false,
      error: 'No transfer number configured'
    });
    return;
  }

  // Mark call as transferred in database
  try {
    await CallLog.markTransferred(call_sid, transferNumber, reason);
  } catch (err) {
    logger.error({err}, 'Error marking call as transferred');
  }

  // Respond to Ultravox immediately to avoid timeout
  logger.info({tool_call_id}, 'Sending tool output to Ultravox');
  session.sendToolOutput(tool_call_id, {
    success: true,
    message: `Transferring to ${destination} number`,
    transfer_number: transferNumber
  });

  // Then execute the transfer using redirect command
  logger.info({transferNumber}, 'Executing sendCommand redirect for transfer');

  const redirectResult = session.sendCommand('redirect', [
    {
      verb: 'say',
      text: 'Please hold while I transfer you to our on-call team.'
    },
    {
      verb: 'dial',
      callerId: from,
      answerOnBridge: true,
      target: [{
        type: 'phone',
        number: transferNumber,
        trunk: client.sip_trunk_name || process.env.SIP_TRUNK_NAME
      }]
    }
  ]);

  logger.info({transferNumber, from, destination, redirectResult}, 'Transfer redirect command sent');
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
    success: true,
    message: 'Information recorded successfully',
    caller_name,
    callback_number
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

  // Respond to Ultravox
  session.sendToolOutput(tool_call_id, {
    success: true,
    message: 'Call ending'
  });

  // Then hang up using redirect
  session.sendCommand('redirect', [
    {verb: 'hangup'}
  ]);
}

module.exports = {handleToolCall};
