const {CallLog} = require('../models/CallLog');

/**
 * Handle tool calls from Ultravox AI agent
 * The session object provides full call context
 */
async function handleToolCall(session, evt) {
  const {logger, client} = session.locals;
  const {call_sid} = session;
  const {name, args, tool_call_id} = evt;

  logger.info({tool: name, args, tool_call_id}, 'Tool call received');

  // Route to appropriate tool handler
  switch (name) {
    case 'transferToOnCall':
    case 'transfer_to_human':
      await handleTransfer(session, args);
      break;

    case 'collectCallerInfo':
      await handleCollectCallerInfo(session, args);
      break;

    case 'hangUp':
      await handleHangUp(session);
      break;

    default:
      logger.warn({tool: name}, 'Unknown tool called');
      session.reply(); // Acknowledge but do nothing
  }
}

/**
 * Transfer call to human agent
 */
async function handleTransfer(session, args) {
  const {logger, client} = session.locals;
  const {call_sid, from} = session;

  logger.info({args}, 'Executing transfer');

  const destination = args.destination || 'primary';
  const reason = args.reason || 'Customer requested human agent';

  // Get transfer phone number from client config
  let transferNumber;
  if (destination === 'primary') {
    transferNumber = client.transfer_primary_phone;
  } else if (destination === 'secondary') {
    transferNumber = client.transfer_secondary_phone;
  } else if (destination === 'voicemail') {
    transferNumber = client.voicemail_phone;
  }

  if (!transferNumber) {
    logger.error({destination}, 'No transfer number configured for destination');
    session
      .say({text: 'I apologize, but I am unable to transfer your call at this time. Someone will call you back shortly.'})
      .hangup()
      .reply();
    return;
  }

  // Mark call as transferred in database
  try {
    await CallLog.markTransferred(call_sid, transferNumber);
  } catch (err) {
    logger.error({err}, 'Error marking call as transferred');
  }

  // Get last 4 digits of caller number for whisper
  const callerLast4 = from ? from.slice(-4) : '****';

  // Execute transfer with whisper
  session
    .say({
      text: 'Please hold while I transfer you.'
    })
    .dial({
      target: [{
        type: 'phone',
        number: transferNumber
      }],
      callerId: from,
      answerOnBridge: true,
      dtmfCapture: ['*'],
      dtmfHook: {
        url: '/dtmf-transfer',
        method: 'POST'
      },
      confirmHook: {
        url: '/whisper',
        method: 'POST'
      },
      // Whisper announcement to human agent
      listen: {
        url: `ws://example.com/listen`,
        mixType: 'stereo'
      }
    })
    .reply();

  logger.info({transferNumber}, 'Transfer initiated');
}

/**
 * Collect caller information
 */
async function handleCollectCallerInfo(session, args) {
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

  // Acknowledge to the LLM that info was recorded
  // The LLM will naturally continue the conversation
  session.reply();
}

/**
 * Hang up the call
 */
async function handleHangUp(session) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info('Hanging up call');

  try {
    await CallLog.updateStatus(call_sid, 'completed');
  } catch (err) {
    logger.error({err}, 'Error updating call status');
  }

  session
    .hangup()
    .reply();
}

module.exports = {handleToolCall};
