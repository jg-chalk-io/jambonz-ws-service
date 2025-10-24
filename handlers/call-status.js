const {CallLog} = require('../models/CallLog');

/**
 * Handle call status updates
 */
async function handleCallStatus(session, evt) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info({evt}, 'Call status update');

  const callStatus = evt.call_status;
  const duration = evt.duration;

  try {
    await CallLog.updateStatus(call_sid, callStatus, {
      duration_seconds: duration
    });
  } catch (err) {
    logger.error({err}, 'Error updating call status');
  }

  // Event handlers should not call session.reply()
}

module.exports = {handleCallStatus};
