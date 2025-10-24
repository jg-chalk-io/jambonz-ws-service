// Test what sendCommand actually sends over WebSocket
const {WebSocket} = require('ws');

// Simulate what the session object does
function testSendCommand() {
  const redirectVerbs = [
    {
      verb: 'say',
      text: 'Please hold while I transfer you to our on-call team.'
    },
    {
      verb: 'dial',
      callerId: '+14168189171',
      answerOnBridge: true,
      target: [{
        type: 'phone',
        number: '+16479526096',
        trunk: 'voip.ms-jambonz'
      }],
      headers: {
        'X-Original-Caller': '+14168189171',
        'X-Transfer-Reason': 'Test transfer'
      }
    }
  ];

  // This is what session.sendCommand does internally
  const msg = {
    type: 'command',
    command: 'redirect',
    queueCommand: false,
    data: redirectVerbs
  };

  console.log('Message that would be sent over WebSocket:');
  console.log(JSON.stringify(msg, null, 2));
}

testSendCommand();
