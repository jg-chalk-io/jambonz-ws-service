/**
 * Aircall Insights Module
 *
 * Builds and sends insight cards to Aircall agents when calls are transferred.
 * Uses Ring-to (via API) widget to receive call_id before routing.
 *
 * Flow:
 * 1. Receive Ring-to request with call_id and caller_number
 * 2. Query tool_call_logs for matching transfer (by callback_number)
 * 3. Build insight card content from transfer data
 * 4. Send card to Aircall API
 * 5. Return routing target (Nora_Inbound queue)
 */

const https = require('https');
const {supabase, aircallSupabase} = require('./supabase');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

class AircallInsights {
  /**
   * Find matching transfer by caller phone number
   *
   * @param {string} callerNumber - Caller's phone number
   * @param {number} timeWindowSeconds - Time window to search (default 60s)
   * @returns {Promise<Object|null>} Transfer data or null
   */
  static async findTransferByCallerNumber(callerNumber, timeWindowSeconds = 60) {
    try {
      // Normalize phone number to E.164 format for comparison
      const normalizedNumber = this.normalizePhoneNumber(callerNumber);

      logger.info({callerNumber, normalizedNumber, timeWindowSeconds}, 'Searching for matching transfer');

      const {data, error} = await supabase
        .from('tool_call_logs')
        .select('*')
        .eq('tool_name', 'transferFromAiTriageWithMetadata')
        .gte('created_at', new Date(Date.now() - timeWindowSeconds * 1000).toISOString())
        .in('status', ['pending', 'success'])
        .order('created_at', {ascending: false});

      if (error) {
        logger.error({error}, 'Error querying tool_call_logs');
        return null;
      }

      if (!data || data.length === 0) {
        logger.info({callerNumber, normalizedNumber}, 'No matching transfers found in database query');
        return null;
      }

      logger.info({
        callerNumber,
        normalizedNumber,
        transfersFound: data.length,
        transferNumbers: data.map(t => t.callback_number)
      }, 'Checking transfers for match');

      // Find matching transfer by normalized callback_number
      const match = data.find(transfer => {
        const transferNumber = this.normalizePhoneNumber(transfer.callback_number);
        logger.info({
          checking: transfer.callback_number,
          normalized: transferNumber,
          target: normalizedNumber,
          matches: transferNumber === normalizedNumber
        }, 'Comparing phone numbers');
        return transferNumber === normalizedNumber;
      });

      if (match) {
        logger.info({
          toolCallLogId: match.id,
          callerNumber,
          callerName: match.caller_name,
          timeSinceTransfer: Date.now() - new Date(match.created_at).getTime()
        }, 'Found matching transfer');
      } else {
        logger.info({
          callerNumber,
          normalizedNumber,
          transfersChecked: data.length,
          callbackNumbers: data.map(t => ({raw: t.callback_number, normalized: this.normalizePhoneNumber(t.callback_number)}))
        }, 'No matching transfer found in recent transfers');
      }

      return match || null;
    } catch (err) {
      logger.error({err, callerNumber}, 'Exception finding transfer');
      return null;
    }
  }

  /**
   * Build insight card content from transfer data
   *
   * @param {Object} transferData - Tool call log data
   * @returns {Object} Insight card content
   */
  static buildInsightCard(transferData) {
    const params = transferData.tool_parameters || {};
    const urgency = transferData.urgency_level || 'normal';

    const contents = [
      {
        type: 'title',
        text: '🤖 AI Triage Transfer'
      }
    ];

    // Caller name
    if (transferData.caller_name) {
      contents.push({
        type: 'shortText',
        label: 'Caller',
        text: transferData.caller_name
      });
    }

    // Phone number (last 4 digits for privacy)
    if (transferData.callback_number) {
      contents.push({
        type: 'shortText',
        label: 'Phone',
        text: this.formatPhoneForDisplay(transferData.callback_number)
      });
    }

    // Urgency reason (transfer tool parameter)
    if (params.urgency_reason) {
      contents.push({
        type: 'shortText',
        label: 'Urgency',
        text: params.urgency_reason
      });
    }

    // First name (if available separately)
    if (params.first_name && !transferData.caller_name) {
      const fullName = params.last_name
        ? `${params.first_name} ${params.last_name}`.trim()
        : params.first_name;
      contents.push({
        type: 'shortText',
        label: 'Caller',
        text: fullName
      });
    }

    // Urgency level with visual indicator
    contents.push({
      type: 'shortText',
      label: 'Level',
      text: this.getUrgencyIndicator(urgency)
    });

    return {contents};
  }

  /**
   * Send insight card to Aircall API
   *
   * @param {string} callId - Aircall call ID
   * @param {Object} cardContent - Insight card content
   * @returns {Promise<Object>} {success, response, error}
   */
  static async sendInsightCard(callId, cardContent) {
    return new Promise((resolve) => {
      const apiId = process.env.AIRCALL_API_ID;
      const apiToken = process.env.AIRCALL_API_TOKEN;

      if (!apiId || !apiToken) {
        logger.error('Missing AIRCALL_API_ID or AIRCALL_API_TOKEN');
        return resolve({
          success: false,
          error: 'Missing Aircall API credentials'
        });
      }

      const auth = Buffer.from(`${apiId}:${apiToken}`).toString('base64');
      const payload = JSON.stringify(cardContent);

      const options = {
        hostname: 'api.aircall.io',
        port: 443,
        path: `/v1/calls/${callId}/insight_cards`,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      logger.info({callId, cardContent}, 'Sending insight card to Aircall');

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          const success = res.statusCode >= 200 && res.statusCode < 300;

          let parsedResponse;
          try {
            parsedResponse = JSON.parse(responseData);
          } catch (e) {
            parsedResponse = {raw: responseData};
          }

          if (success) {
            logger.info({callId, statusCode: res.statusCode}, 'Insight card sent successfully');
          } else {
            logger.error({
              callId,
              statusCode: res.statusCode,
              response: parsedResponse
            }, 'Failed to send insight card');
          }

          resolve({
            success,
            response: parsedResponse,
            statusCode: res.statusCode,
            error: success ? null : `HTTP ${res.statusCode}: ${responseData}`
          });
        });
      });

      req.on('error', (err) => {
        logger.error({err, callId}, 'Error sending insight card to Aircall');
        resolve({
          success: false,
          error: err.message
        });
      });

      req.setTimeout(2000, () => {
        req.destroy();
        logger.error({callId}, 'Timeout sending insight card to Aircall');
        resolve({
          success: false,
          error: 'Request timeout'
        });
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Get Aircall Call ID by querying the aircall_data table in Supabase.
   *
   * Finds the most recent inbound call from the given phone number.
   * This is faster and more reliable than the Aircall Search API because
   * it queries our local database which is updated via Aircall webhooks.
   *
   * @param {string} phoneNumber - Phone number to search for (E.164 format)
   * @returns {Promise<string|null>} Aircall Call ID or null if not found
   */
  static async getAircallCallId(phoneNumber) {
    if (!aircallSupabase) {
      logger.warn('AIRCALL_SUPABASE_URL not configured - cannot query aircall_data');
      return null;
    }

    try {
      logger.info({phoneNumber}, 'Searching Aircall Supabase database for call ID');

      const {data, error} = await aircallSupabase
        .from('aircall_data')
        .select('call_id, call_start_time, direction, from_number')
        .eq('from_number', phoneNumber)
        .eq('direction', 'inbound')
        .order('call_start_time', {ascending: false})
        .limit(1);

      if (error) {
        logger.error({error, phoneNumber}, 'Error querying aircall_data table');
        return null;
      }

      if (!data || data.length === 0) {
        logger.warn({phoneNumber}, 'No calls found in aircall_data');
        return null;
      }

      const call = data[0];
      const aircallCallId = call.call_id;

      logger.info({
        phoneNumber,
        aircallCallId,
        callStartTime: call.call_start_time
      }, 'Found Aircall Call ID from Supabase');

      return aircallCallId.toString();
    } catch (err) {
      logger.error({err, phoneNumber}, 'Exception querying aircall_data');
      return null;
    }
  }

  /**
   * Log insight card attempt to database
   *
   * @param {Object} params - Log parameters
   * @returns {Promise<string|null>} Log entry ID
   */
  static async logInsightCard({
    aircallCallId,
    callerNumber,
    targetNumber,
    toolCallLogId = null,
    ultravoxCallId = null,
    twilioCallSid = null,
    callLogId = null,
    callerName = null,
    callerConcern = null,
    petName = null,
    urgencyLevel = null,
    cardContent,
    routedToType,
    routedToId,
    cardStatus,
    aircallResponse = null,
    errorMessage = null,
    processingTimeMs = null
  }) {
    try {
      const {data, error} = await supabase
        .from('aircall_insight_cards')
        .insert({
          aircall_call_id: aircallCallId,
          caller_number: callerNumber,
          target_number: targetNumber,
          tool_call_log_id: toolCallLogId,
          ultravox_call_id: ultravoxCallId,
          twilio_call_sid: twilioCallSid,
          call_log_id: callLogId,
          caller_name: callerName,
          caller_concern: callerConcern,
          pet_name: petName,
          urgency_level: urgencyLevel,
          card_content: cardContent,
          routed_to_type: routedToType,
          routed_to_id: routedToId,
          card_sent_at: cardStatus === 'success' ? new Date().toISOString() : null,
          card_status: cardStatus,
          aircall_response: aircallResponse,
          error_message: errorMessage,
          processing_time_ms: processingTimeMs
        })
        .select('id')
        .single();

      if (error) {
        logger.error({error}, 'Failed to log insight card to database');
        return null;
      }

      logger.info({logId: data.id, cardStatus}, 'Insight card logged to database');
      return data.id;
    } catch (err) {
      logger.error({err}, 'Exception logging insight card');
      return null;
    }
  }

  /**
   * Normalize phone number to E.164 format
   *
   * @param {string} phoneNumber - Phone number in any format
   * @returns {string} Normalized phone number
   */
  static normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';

    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');

    // If starts with 1 and has 11 digits (North American format)
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }

    // If has 10 digits, assume North American and add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }

    // Otherwise, just add + prefix if not present
    return phoneNumber.startsWith('+') ? phoneNumber : `+${digits}`;
  }

  /**
   * Format phone number for display (last 4 digits)
   *
   * @param {string} phoneNumber - Phone number
   * @returns {string} Formatted for display (e.g., "••••1234")
   */
  static formatPhoneForDisplay(phoneNumber) {
    if (!phoneNumber) return 'Unknown';

    const digits = phoneNumber.replace(/\D/g, '');
    const last4 = digits.slice(-4);

    return `••••${last4}`;
  }

  /**
   * Get urgency indicator emoji
   *
   * @param {string} urgencyLevel - normal, urgent, critical
   * @returns {string} Emoji + text
   */
  static getUrgencyIndicator(urgencyLevel) {
    const levels = {
      critical: '🔴 Critical',
      urgent: '🟡 Urgent',
      normal: '⚪ Routine'
    };

    return levels[urgencyLevel] || levels.normal;
  }
}

module.exports = {AircallInsights};
