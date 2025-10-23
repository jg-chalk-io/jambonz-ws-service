const {supabase} = require('../lib/supabase');

class CallLog {
  /**
   * Create new call log entry
   */
  static async create(clientId, callSid, fromNumber, toNumber, direction) {
    try {
      const {data, error} = await supabase
        .from('call_logs')
        .insert({
          client_id: clientId,
          call_sid: callSid,
          from_number: fromNumber,
          to_number: toNumber,
          direction: direction,
          status: 'initiated'
        })
        .select()
        .single();

      if (error) throw error;
      return data.id;
    } catch (err) {
      console.error('Error creating call log:', err);
      throw err;
    }
  }

  /**
   * Update call status and other fields
   */
  static async updateStatus(callSid, status, extraFields = {}) {
    try {
      const updateData = {status, ...extraFields};

      const {error} = await supabase
        .from('call_logs')
        .update(updateData)
        .eq('call_sid', callSid);

      if (error) throw error;
    } catch (err) {
      console.error('Error updating call status:', err);
      throw err;
    }
  }

  /**
   * Mark call as transferred
   */
  static async markTransferred(callSid, transferredTo, reason = null) {
    try {
      const updateData = {
        transferred_to_human: true,
        transfer_destination: transferredTo
      };

      if (reason) {
        updateData.transfer_reason = reason;
      }

      const {error} = await supabase
        .from('call_logs')
        .update(updateData)
        .eq('call_sid', callSid);

      if (error) throw error;
    } catch (err) {
      console.error('Error marking call as transferred:', err);
      throw err;
    }
  }
}

module.exports = {CallLog};
