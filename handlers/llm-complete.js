const {CallLog} = require('../models/CallLog');

/**
 * Handle LLM session completion
 */
async function handleLlmComplete(session, evt) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info({evt}, 'LLM session complete');

  const completionReason = evt.completion_reason || 'unknown';

  try {
    await CallLog.updateStatus(call_sid, 'llm_complete', {
      llm_completion_reason: completionReason
    });
  } catch (err) {
    logger.error({err}, 'Error updating LLM completion');
  }

  // If not already hung up, do nothing (let call continue)
  session.reply();
}

module.exports = {handleLlmComplete};
