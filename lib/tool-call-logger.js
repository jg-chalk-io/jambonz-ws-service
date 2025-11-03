/**
 * Tool Call Logger
 *
 * Logs all tool invocations to Supabase for:
 * - Reliability: Track all tool calls
 * - Retry: Retry failed tool calls automatically
 * - Callback: Contact customers if tool fails
 * - Audit: Complete audit trail
 */

const {supabase} = require('./supabase');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

class ToolCallLogger {
  /**
   * Log a tool call invocation
   *
   * @param {Object} params
   * @param {string} params.toolName - Name of the tool being called
   * @param {Object} params.toolParameters - Parameters passed to the tool
   * @param {string} params.ultravoxCallId - Ultravox call ID
   * @param {string} params.twilioCallSid - Twilio call SID (if available)
   * @param {number} params.callLogId - Call logs table ID (if available)
   * @param {string} params.callbackNumber - Customer callback number
   * @param {string} params.callerName - Customer name
   * @param {string} params.urgencyLevel - normal, urgent, critical
   * @param {Object} params.toolData - Complete tool data for retry
   * @returns {Promise<string>} - Log entry ID
   */
  static async logToolCall({
    toolName,
    toolParameters = {},
    ultravoxCallId = null,
    twilioCallSid = null,
    callLogId = null,
    callbackNumber = null,
    callerName = null,
    urgencyLevel = 'normal',
    toolData = {}
  }) {
    try {
      const {data, error} = await supabase
        .from('tool_call_logs')
        .insert({
          tool_name: toolName,
          tool_parameters: toolParameters,
          ultravox_call_id: ultravoxCallId,
          twilio_call_sid: twilioCallSid,
          call_log_id: callLogId,
          callback_number: callbackNumber,
          caller_name: callerName,
          urgency_level: urgencyLevel,
          tool_data: toolData,
          status: 'pending'
        })
        .select('id')
        .single();

      if (error) {
        logger.error({error, toolName}, 'Failed to log tool call to database');
        // Don't throw - continue even if logging fails
        return null;
      }

      logger.info({
        logId: data.id,
        toolName,
        ultravoxCallId,
        callbackNumber
      }, 'Tool call logged to database');

      return data.id;
    } catch (err) {
      logger.error({err, toolName}, 'Exception logging tool call');
      return null;
    }
  }

  /**
   * Mark tool call as successful
   */
  static async logSuccess(logId, result = {}) {
    if (!logId) return;

    try {
      const {error} = await supabase
        .from('tool_call_logs')
        .update({
          status: 'success',
          result: result,
          processed_at: new Date().toISOString()
        })
        .eq('id', logId);

      if (error) {
        logger.error({error, logId}, 'Failed to update tool call status to success');
      } else {
        logger.info({logId}, 'Tool call marked as success');
      }
    } catch (err) {
      logger.error({err, logId}, 'Exception updating tool call status');
    }
  }

  /**
   * Mark tool call as failed
   */
  static async logFailure(logId, errorMessage, errorDetails = {}) {
    if (!logId) return;

    try {
      const {error} = await supabase
        .from('tool_call_logs')
        .update({
          status: 'failed',
          error_message: errorMessage,
          result: {error: errorDetails},
          processed_at: new Date().toISOString()
        })
        .eq('id', logId);

      if (error) {
        logger.error({error, logId}, 'Failed to update tool call status to failed');
      } else {
        logger.error({logId, errorMessage}, 'Tool call marked as failed - callback needed');
      }
    } catch (err) {
      logger.error({err, logId}, 'Exception updating tool call status');
    }
  }

  /**
   * Increment retry count
   */
  static async incrementRetry(logId) {
    if (!logId) return;

    try {
      const {data, error} = await supabase
        .from('tool_call_logs')
        .update({
          retry_count: supabase.sql`retry_count + 1`,
          status: 'retrying',
          updated_at: new Date().toISOString()
        })
        .eq('id', logId)
        .select('retry_count, max_retries')
        .single();

      if (error) {
        logger.error({error, logId}, 'Failed to increment retry count');
        return null;
      }

      logger.info({
        logId,
        retryCount: data.retry_count,
        maxRetries: data.max_retries
      }, 'Retry count incremented');

      return data;
    } catch (err) {
      logger.error({err, logId}, 'Exception incrementing retry count');
      return null;
    }
  }

  /**
   * Get failed tool calls that need retry
   */
  static async getFailedCallsForRetry(limit = 10) {
    try {
      const {data, error} = await supabase
        .from('tool_call_logs')
        .select('*')
        .eq('status', 'failed')
        .filter('retry_count', 'lt', 'max_retries')
        .order('urgency_level', {ascending: false}) // critical first
        .order('created_at', {ascending: true}) // oldest first
        .limit(limit);

      if (error) {
        logger.error({error}, 'Failed to get failed calls for retry');
        return [];
      }

      return data;
    } catch (err) {
      logger.error({err}, 'Exception getting failed calls for retry');
      return [];
    }
  }

  /**
   * Get pending tool calls (not yet processed)
   */
  static async getPendingCalls(limit = 50) {
    try {
      const {data, error} = await supabase
        .from('tool_call_logs')
        .select('*')
        .eq('status', 'pending')
        .order('urgency_level', {ascending: false})
        .order('created_at', {ascending: true})
        .limit(limit);

      if (error) {
        logger.error({error}, 'Failed to get pending calls');
        return [];
      }

      return data;
    } catch (err) {
      logger.error({err}, 'Exception getting pending calls');
      return [];
    }
  }
}

module.exports = {ToolCallLogger};
