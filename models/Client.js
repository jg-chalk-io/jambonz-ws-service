const {supabase} = require('../lib/supabase');

class Client {
  /**
   * Get client by Jambonz account SID
   */
  static async getByAccountSid(accountSid) {
    try {
      const {data, error} = await supabase
        .from('clients')
        .select('*')
        .eq('jambonz_account_sid', accountSid)
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error fetching client by account_sid:', err);
      return null;
    }
  }

  /**
   * Get client by phone number
   */
  static async getByPhoneNumber(phoneNumber) {
    try {
      // First get the client_id from phone_numbers table
      const {data: phoneData, error: phoneError} = await supabase
        .from('phone_numbers')
        .select('client_id')
        .eq('phone_number', phoneNumber)
        .single();

      if (phoneError) throw phoneError;

      // Then get the full client record
      const {data: clientData, error: clientError} = await supabase
        .from('clients')
        .select('*')
        .eq('id', phoneData.client_id)
        .single();

      if (clientError) throw clientError;
      return clientData;
    } catch (err) {
      console.error('Error fetching client by phone number:', err);
      return null;
    }
  }

  /**
   * Get default client (fallback for single-tenant)
   */
  static async getDefaultClient() {
    try {
      const {data, error} = await supabase
        .from('clients')
        .select('*')
        .limit(1)
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error fetching default client:', err);
      return null;
    }
  }
}

module.exports = {Client};
