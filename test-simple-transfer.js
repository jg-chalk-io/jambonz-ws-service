/**
 * Simple Cold Transfer Test
 *
 * This bypasses all LLM/AI logic and immediately transfers incoming calls
 * to test basic dial functionality.
 *
 * Usage: Replace incoming call handler temporarily to test transfer
 */

async function testSimpleTransfer(session) {
  const {logger} = session.locals;
  const {call_sid, from, to} = session;

  logger.info({call_sid, from, to}, 'TEST: Simple cold transfer to 3654001512');

  // Immediate cold transfer - no LLM, no AI, just dial
  session
    .dial({
      target: [{
        type: 'phone',
        number: '+13654001512'
      }],
      actionHook: '/dialComplete',
      answerOnBridge: true,
      timeLimit: 3600
    })
    .reply();

  logger.info('TEST: Direct dial command sent');
}

module.exports = {testSimpleTransfer};
