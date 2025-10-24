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
    // Respond to Ultravox immediately with error
    session.sendToolOutput(tool_call_id, {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      error_message: 'No transfer number configured for this destination'
    });
    return;
  }

  // Mark call as transferred in database
  try {
    await CallLog.markTransferred(call_sid, transferNumber, reason);
  } catch (err) {
    logger.error({err}, 'Error marking call as transferred');
  }

  // Execute the transfer by replacing active LLM session
  logger.info({transferNumber}, 'Executing transfer with say + dial verb sequence');

  // Preserve original caller ID when transferring to Aircall via SIP
  // Use the original caller's number so it shows up in Aircall
  const outboundCallerId = from; // Use original caller's number

  logger.info({outboundCallerId, originalCaller: from, transferNumber}, 'Transferring with original caller ID preserved');

  // Check if transfer destination is a SIP URI (Aircall) or phone number
  const isAircallSip = transferNumber && transferNumber.includes('@');

  const dialTarget = isAircallSip ? [{
    type: 'sip',
    sipUri: transferNumber
  }] : [{
    type: 'phone',
    number: transferNumber,
    trunk: client.sip_trunk_name || process.env.SIP_TRUNK_NAME
  }];

  logger.info({dialTarget}, 'Using dial target configuration');

  // IMPORTANT: Send tool output FIRST, before redirect ends the LLM session
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Successfully initiated transfer to agent'
  });

  logger.info({tool_call_id}, 'Tool output sent to Ultravox');

  // Now send redirect command with array of verb objects
  const redirectVerbs = [
    {
      verb: 'say',
      text: 'Please hold while I transfer you to our on-call team.'
    },
    {
      verb: 'dial',
      callerId: outboundCallerId,
      answerOnBridge: true,
      target: dialTarget,
      headers: {
        'X-Original-Caller': from,
        'X-Transfer-Reason': reason
      }
    }
  ];

  logger.info({
    redirectVerbs: JSON.stringify(redirectVerbs),
    hasMethod: typeof session.sendCommand,
    wsReadyState: session.ws?.readyState,
    wsConnected: session.ws?.readyState === 1
  }, 'About to call session.sendCommand');

  try {
    const result = session.sendCommand('redirect', redirectVerbs);
    logger.info({result, wsReadyState: session.ws?.readyState}, 'sendCommand returned');
  } catch (err) {
    logger.error({err}, 'sendCommand threw error');
  }
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

  // Send redirect command with hangup verb
  session.sendCommand('redirect', [
    {
      verb: 'hangup'
    }
  ]);

  // Send tool output to Ultravox
  session.sendToolOutput(tool_call_id, {
    type: 'client_tool_result',
    invocation_id: tool_call_id,
    result: 'Call ending'
  });
}

module.exports = {handleToolCall};
