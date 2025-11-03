const http = require('http');
const {supabase} = require('../lib/supabase');
const {ToolCallLogger} = require('../lib/tool-call-logger');
const pino = require('pino');

const baseLogger = pino({level: process.env.LOG_LEVEL || 'info'});

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
    const {call_sid, urgency_reason, first_name, last_name} = data;
    const caller_name = last_name ? `${first_name} ${last_name}` : first_name;

    logger.info({call_sid, urgency_reason, caller_name}, 'Transfer to on-call requested');

    // For Twilio: Return actionUrl so Ultravox can end the stream gracefully
    // For Jambonz: Execute transfer immediately (existing behavior)
    if (transferTrunk === null) {
      // Twilio platform - use actionUrl pattern
      const baseUrl = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        success: true,
        message: 'Transfer initiated',
        actionUrl: `${baseUrl}/twilio/executeDial?number=${encodeURIComponent(transferNumber)}&reason=${encodeURIComponent(urgency_reason)}`
      }));
    } else {
      // Jambonz platform - execute transfer immediately
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
  }

  /**
   * Handle collectCallerInfo HTTP tool invocation
   */
  async function handleCollectCallerInfo(data, res) {
    let logId = null;

    try {
      const {call_sid, first_name, last_name, pet_name, species, callback_number, concern_description} = data;
      const caller_name = last_name ? `${first_name} ${last_name}` : first_name;

      logger.info({
        call_sid,
        caller_name,
        pet_name,
        species,
        callback_number,
        concern_description
      }, 'Caller information collected');

      // Determine urgency level from concern description
      const concernLower = (concern_description || '').toLowerCase();
      const urgencyLevel = concernLower.includes('urgent') || concernLower.includes('emergency')
                          ? 'urgent'
                          : 'normal';

      // Log tool call to database IMMEDIATELY
      logId = await ToolCallLogger.logToolCall({
        toolName: 'collectNameNumberConcernPetName',
        toolParameters: data,
        ultravoxCallId: null, // Not available in this context
        twilioCallSid: call_sid,
        callbackNumber: callback_number,
        callerName: caller_name,
        urgencyLevel: urgencyLevel,
        toolData: {
          caller_name,
          pet_name,
          species,
          concern_description,
          timestamp: new Date().toISOString()
        }
      });

      // Store callback request for processing by backend system
      // This allows retry if frontend posting fails
      const {error: insertError} = await supabase
        .from('callback_requests')
        .insert({
          callback_number,
          caller_name,
          pet_name,
          species,
          concern_description,
          urgency_level: urgencyLevel,
          call_sid,
          tool_call_log_id: logId,
          status: 'pending' // Will be processed by backend worker
        });

      if (insertError) {
        logger.error({insertError, logId}, 'Failed to store callback request');
        // Mark tool call as failed
        if (logId) {
          await ToolCallLogger.logFailure(logId, 'Failed to store callback request', {
            error: insertError.message
          });
        }
        throw insertError;
      }

      // Mark tool call as successful
      if (logId) {
        await ToolCallLogger.logSuccess(logId, {
          callback_request_stored: true,
          callback_number,
          caller_name
        });
      }

      logger.info({logId, callback_number, caller_name}, 'Callback request stored successfully');

      // Send success response
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        success: true,
        message: 'Information recorded successfully'
      }));

    } catch (err) {
      logger.error({err, data}, 'Error handling collect caller info');

      // Mark tool call as failed if logId exists
      if (logId) {
        await ToolCallLogger.logFailure(logId, err.message, {
          error: err.message,
          stack: err.stack,
          data
        });
      }

      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        success: false,
        error: err.message
      }));
    }
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
