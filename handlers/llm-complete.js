const {CallLog} = require('../models/CallLog');

/**
 * Handle LLM session completion
 */
async function handleLlmComplete(session, evt) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info({evt}, 'LLM session complete');

  try {
    await CallLog.updateStatus(call_sid, 'llm_complete');
  } catch (err) {
    logger.error({err}, 'Error updating LLM completion');
  }

  // Event handlers should not call session.reply()
}

module.exports = {handleLlmComplete};
