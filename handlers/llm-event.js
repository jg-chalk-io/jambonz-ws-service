/**
 * Handle LLM events from Ultravox
 */
async function handleLlmEvent(session, evt) {
  const {logger} = session.locals;
  const {call_sid} = session;

  logger.info({evt}, 'LLM event received');

  // No action needed for most events, just log them
  // Events include transcription updates, etc.
  session.reply();
}

module.exports = {handleLlmEvent};
