/**
 * Aircall Ring-to (via API) Route Handler
 *
 * Handles Ring-to API requests from Aircall Smartflows widget.
 * Receives call_id before routing, sends insight card, returns routing target.
 *
 * Request from Aircall:
 * POST /aircall/ring-to
 * Authorization: Bearer {AIRCALL_RING_TO_SECRET}
 * Body: {"call_id": "123", "caller_number": "+1234567890", "target_number": "+0987654321"}
 *
 * Response to Aircall (must be <3 seconds):
 * 200 OK
 * Body: {"target_type": "team", "target_id": "12345"}
 */

const {AircallInsights} = require('../lib/aircall-insights');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

/**
 * Handle Aircall Ring-to API request
 *
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @param {Object} bodyData - Pre-parsed request body (optional, will parse if not provided)
 */
async function handleAircallRingTo(req, res, bodyData = null) {
  const startTime = Date.now();

  try {
    // Use pre-parsed body if provided, otherwise parse from stream
    const body = bodyData || await parseRequestBody(req);

    if (!body) {
      logger.error('Failed to parse request body');
      return sendResponse(res, 400, {error: 'Invalid request body'});
    }

    const {call_id, caller_number, target_number} = body;

    logger.info({
      call_id,
      caller_number,
      target_number,
      fullBody: body,
      bodyKeys: Object.keys(body)
    }, 'Ring-to API request received');

    // Verify authentication
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.AIRCALL_RING_TO_SECRET;

    if (!expectedToken) {
      logger.error('AIRCALL_RING_TO_SECRET not configured');
      return sendResponse(res, 500, {error: 'Server configuration error'});
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn({call_id}, 'Missing or invalid Authorization header');
      return sendResponse(res, 401, {error: 'Unauthorized'});
    }

    const token = authHeader.substring(7); // Remove "Bearer "
    if (token !== expectedToken) {
      logger.warn({call_id}, 'Invalid bearer token');
      return sendResponse(res, 401, {error: 'Unauthorized'});
    }

    // Validate required parameters
    if (!caller_number) {
      logger.error({call_id, caller_number}, 'Missing required parameter: caller_number');
      return sendResponse(res, 400, {error: 'Missing caller_number'});
    }

    // If call_id is missing, we can't send insight card but still route the call
    if (!call_id) {
      logger.warn({caller_number}, 'Missing call_id - will route without insight card');
      const routingTarget = getRoutingTarget({});
      return sendResponse(res, 200, routingTarget);
    }

    // Process asynchronously with timeout protection
    const processingPromise = processInsightCard({
      call_id,
      caller_number,
      target_number,
      startTime
    });

    // Race between processing and timeout (2.5s to leave buffer for response)
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          reason: 'timeout',
          cardStatus: 'failed'
        });
      }, 2500);
    });

    const result = await Promise.race([processingPromise, timeoutPromise]);

    // Calculate total processing time
    const processingTimeMs = Date.now() - startTime;

    logger.info({
      call_id,
      cardStatus: result.cardStatus,
      processingTimeMs
    }, 'Ring-to processing completed');

    // Always return routing response, even if insight card failed
    const routingTarget = getRoutingTarget(result);

    return sendResponse(res, 200, routingTarget);

  } catch (err) {
    logger.error({err}, 'Exception in Ring-to handler');
    const processingTimeMs = Date.now() - startTime;

    // Still return routing target even on error
    const defaultRouting = getDefaultRouting();

    logger.warn({processingTimeMs}, 'Returning default routing after error');
    return sendResponse(res, 200, defaultRouting);
  }
}

/**
 * Process insight card: find transfer, build card, send to Aircall
 */
async function processInsightCard({call_id, caller_number, target_number, startTime}) {
  try {
    // 1. Find matching transfer by caller number
    const transferData = await AircallInsights.findTransferByCallerNumber(caller_number, 60);

    if (!transferData) {
      logger.info({call_id, caller_number}, 'No matching transfer found - likely direct call');

      // Log as no_match
      await AircallInsights.logInsightCard({
        aircallCallId: call_id,
        callerNumber: caller_number,
        targetNumber: target_number,
        cardContent: {},
        routedToType: 'team',
        routedToId: process.env.AIRCALL_NORA_INBOUND_TEAM_ID,
        cardStatus: 'no_match',
        processingTimeMs: Date.now() - startTime
      });

      return {
        success: false,
        reason: 'no_match',
        cardStatus: 'no_match'
      };
    }

    // 2. Build insight card content
    const cardContent = AircallInsights.buildInsightCard(transferData);

    logger.info({
      call_id,
      toolCallLogId: transferData.id,
      callerName: transferData.caller_name
    }, 'Built insight card from transfer data');

    // 3. Send insight card to Aircall
    const sendResult = await AircallInsights.sendInsightCard(call_id, cardContent);

    // 4. Extract data for logging
    const params = transferData.tool_parameters || {};
    const cardStatus = sendResult.success ? 'success' : 'failed';

    // 5. Log to database
    await AircallInsights.logInsightCard({
      aircallCallId: call_id,
      callerNumber: caller_number,
      targetNumber: target_number,
      toolCallLogId: transferData.id,
      ultravoxCallId: transferData.ultravox_call_id,
      twilioCallSid: transferData.twilio_call_sid,
      callLogId: transferData.call_log_id,
      callerName: transferData.caller_name,
      callerConcern: params.concern_details || params.reason,
      petName: params.pet_name,
      urgencyLevel: transferData.urgency_level,
      cardContent: cardContent,
      routedToType: 'team',
      routedToId: process.env.AIRCALL_NORA_INBOUND_TEAM_ID,
      cardStatus: cardStatus,
      aircallResponse: sendResult.response,
      errorMessage: sendResult.error,
      processingTimeMs: Date.now() - startTime
    });

    return {
      success: sendResult.success,
      reason: sendResult.success ? 'sent' : 'api_error',
      cardStatus: cardStatus,
      transferData: transferData
    };

  } catch (err) {
    logger.error({err, call_id}, 'Exception processing insight card');

    // Log error to database
    await AircallInsights.logInsightCard({
      aircallCallId: call_id,
      callerNumber: caller_number,
      targetNumber: target_number,
      cardContent: {},
      routedToType: 'team',
      routedToId: process.env.AIRCALL_NORA_INBOUND_TEAM_ID,
      cardStatus: 'failed',
      errorMessage: err.message,
      processingTimeMs: Date.now() - startTime
    });

    return {
      success: false,
      reason: 'exception',
      cardStatus: 'failed'
    };
  }
}

/**
 * Get routing target based on processing result
 *
 * Returns response format compatible with Aircall Ring-to widget response paths:
 * - data.user_id (for single user routing)
 * - data.team_id (for team routing)
 * - data[0].user_id (for array format)
 *
 * Aircall extracts the ID based on "Response Path" configuration in widget.
 */
function getRoutingTarget(result) {
  // For now, always route to Nora_Inbound team
  // Future: Could implement urgency-based routing here

  const teamId = process.env.AIRCALL_NORA_INBOUND_TEAM_ID;

  if (!teamId) {
    logger.error('AIRCALL_NORA_INBOUND_TEAM_ID not configured, using fallback');
    // Aircall will use Smartflow fallback routing
    return {};
  }

  // Return format that supports multiple Aircall response path configurations
  // Widget can be configured to extract from:
  // - data.team_id (single object)
  // - data[0].team_id (array format)
  // - data.user_id (if routing to specific user instead)
  return {
    data: {
      team_id: teamId,
      user_id: teamId  // Same value, allows flexibility in widget config
    }
  };
}

/**
 * Get default routing (when error occurs)
 */
function getDefaultRouting() {
  return getRoutingTarget({});
}

/**
 * Parse request body from stream
 */
function parseRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        logger.error({err, body}, 'Failed to parse JSON body');
        resolve(null);
      }
    });

    req.on('error', (err) => {
      logger.error({err}, 'Error reading request body');
      resolve(null);
    });
  });
}

/**
 * Send JSON response
 */
function sendResponse(res, statusCode, data) {
  const json = JSON.stringify(data);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json)
  });

  res.end(json);
}

module.exports = handleAircallRingTo;
