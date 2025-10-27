const {CallLog} = require('../models/CallLog');

/**
 * Handle LLM session completion
 * After Ultravox ends, check if transfer was requested
 */
async function handleLlmComplete(session, evt) {
  const {logger, client} = session.locals;
  const {call_sid, from} = session;

  logger.info({evt}, 'LLM session complete - checking for transfer request');

  // Check if this was a transfer completion
  // Ultravox client-side tools will have set transfer metadata or transcript
  const transferRequested = evt.transfer_requested ||
                            evt.metadata?.transfer_requested ||
                            (evt.transcript && evt.transcript.includes('transferToOnCall'));

  if (transferRequested) {
    logger.info('Transfer detected in llmComplete - executing transfer now');

    const conversation_summary = evt.conversation_summary ||
                                 evt.metadata?.conversation_summary ||
                                 'Transfer requested';
    const transferNumber = '+13654001512';

    try {
      await CallLog.markTransferred(call_sid, transferNumber, conversation_summary);
      logger.info('CallLog.markTransferred completed');
    } catch (err) {
      logger.error({err}, 'Error marking call as transferred');
    }

    // Now Jambonz takes over - do the actual transfer
    logger.info({transferNumber, call_sid}, 'Executing transfer after LLM ended');

    // Say transfer message, enqueue caller
    session
      .say({text: 'Please hold while I transfer you to our on-call team.'})
      .enqueue({
        name: call_sid,
        actionHook: '/consultationDone',
        waitHook: '/wait-music'
      })
      .reply();

    logger.info('Caller enqueued - now dialing specialist');

    // Dial specialist on separate leg
    setTimeout(() => {
      logger.info({transferNumber, call_sid}, 'Dialing specialist now');

      session.sendCommand('dial', {
        call_hook: '/dial-specialist',
        from: from,
        to: transferNumber,
        tag: {
          conversation_summary,
          queue: call_sid,
          original_caller: from
        }
      });

      logger.info('Dial command sent');
    }, 500);

  } else {
    // Normal completion - no transfer
    logger.info('No transfer requested - normal call completion');

    try {
      await CallLog.updateStatus(call_sid, 'llm_complete');
    } catch (err) {
      logger.error({err}, 'Error updating LLM completion');
    }
  }
}

module.exports = {handleLlmComplete};
