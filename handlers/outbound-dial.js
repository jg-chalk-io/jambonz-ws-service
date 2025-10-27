/**
 * Handle outbound calls from registered softphones
 * Routes all outbound calls through voip.ms-jambonz trunk
 */
function handleOutboundDial(req, res) {
  const {from, to, call_sid} = req.body;

  console.log(`Outbound dial: ${from} -> ${to} (${call_sid})`);

  // Simple dial through voip.ms-jambonz trunk
  const response = [
    {
      verb: 'dial',
      target: [{
        type: 'phone',
        number: to,
        trunk: 'voip.ms-jambonz'
      }],
      callerId: from,
      answerOnBridge: true
    }
  ];

  res.json(response);
}

module.exports = {handleOutboundDial};
