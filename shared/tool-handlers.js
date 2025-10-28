const http = require('http');

/**
 * Create HTTP tool handlers with platform-specific transfer logic
 * @param {Object} config - Configuration object
 * @param {Function} config.executeTransfer - Platform-specific transfer function (call_sid, urgency_reason) => Promise
 * @param {Object} config.logger - Logger instance
 * @param {string} config.transferNumber - Phone number to transfer to
 * @param {string|null} config.transferTrunk - Trunk name (null for Twilio)
 * @returns {Object} Handler functions for HTTP tools
 */
function createToolHandlers(config) {
  const {executeTransfer, logger, transferNumber, transferTrunk} = config;

  /**
   * Handle transferToOnCall HTTP tool invocation
   */
  function handleTransferToOnCall(data, res) {
    const {call_sid, urgency_reason} = data;

    logger.info({call_sid, urgency_reason}, 'Transfer to on-call requested');

    // Send immediate response to Ultravox
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      success: true,
      message: 'Transfer initiated'
    }));

    // Execute platform-specific transfer
    executeTransfer(call_sid, urgency_reason, transferNumber, transferTrunk)
      .then(() => {
        logger.info({call_sid}, 'Transfer completed successfully');
      })
      .catch((err) => {
        logger.error({err, call_sid}, 'Error executing transfer');
      });
  }

  /**
   * Handle collectCallerInfo HTTP tool invocation
   */
  function handleCollectCallerInfo(data, res) {
    const {call_sid, caller_name, pet_name, species, callback_number, concern_description} = data;

    logger.info({
      call_sid,
      caller_name,
      pet_name,
      species,
      callback_number,
      concern_description
    }, 'Caller information collected');

    // TODO: Store in database (Supabase call_logs or messages table)

    // Send success response
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      success: true,
      message: 'Information recorded successfully'
    }));
  }

  /**
   * Handle hangUp HTTP tool invocation
   */
  function handleHangUp(data, res) {
    const {call_sid} = data;

    logger.info({call_sid}, 'Hangup requested');

    // Send success response
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      success: true,
      message: 'Call will end'
    }));

    // Hangup will be handled by the platform's call flow
  }

  return {
    handleTransferToOnCall,
    handleCollectCallerInfo,
    handleHangUp
  };
}

/**
 * Jambonz-specific transfer implementation using REST API redirect
 */
function createJambonzTransfer(jambonzAccountSid, jambonzApiKey, logger) {
  return function executeTransfer(call_sid, urgency_reason, transferNumber, transferTrunk) {
    return new Promise((resolve, reject) => {
      const jambonzRequest = http.request({
        hostname: 'api.jambonz.cloud',
        path: `/v1/Accounts/${jambonzAccountSid}/Calls/${call_sid}/redirect`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jambonzApiKey}`,
          'Content-Type': 'application/json'
        }
      }, (jambonzRes) => {
        let responseBody = '';
        jambonzRes.on('data', chunk => responseBody += chunk);
        jambonzRes.on('end', () => {
          logger.info({call_sid, statusCode: jambonzRes.statusCode}, 'Transfer redirect sent');
          if (jambonzRes.statusCode >= 200 && jambonzRes.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Jambonz API returned ${jambonzRes.statusCode}: ${responseBody}`));
          }
        });
      });

      jambonzRequest.on('error', reject);

      // Send redirect command with phone dial
      jambonzRequest.write(JSON.stringify([
        {
          verb: 'say',
          text: 'Connecting you to our on-call team now.'
        },
        {
          verb: 'dial',
          actionHook: '/dialComplete',
          target: [
            {
              type: 'phone',
              number: transferNumber,
              trunk: transferTrunk
            }
          ]
        }
      ]));

      jambonzRequest.end();
    });
  };
}

/**
 * Twilio-specific transfer implementation using REST API call update
 */
function createTwilioTransfer(twilioClient, logger) {
  return function executeTransfer(call_sid, urgency_reason, transferNumber, transferTrunk) {
    return twilioClient
      .calls(call_sid)
      .update({
        twiml: `<Response>
          <Say>Connecting you to our on-call team now.</Say>
          <Dial>${transferNumber}</Dial>
        </Response>`
      })
      .then(call => {
        logger.info({call_sid, callStatus: call.status}, 'Twilio transfer executed');
        return call;
      });
  };
}

module.exports = {
  createToolHandlers,
  createJambonzTransfer,
  createTwilioTransfer
};
