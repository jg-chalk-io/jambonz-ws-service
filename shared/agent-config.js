const fs = require('fs');
const path = require('path');
const {supabase} = require('../lib/supabase');

// Client configuration (can be loaded from DB in production)
const CLIENT_CONFIG = {
  office_name: 'Humber Veterinary Clinic',
  agent_name: 'Jessica',
  office_hours: 'Monday through Friday, 9 A.M. to 5 P.M., Saturday 9 to noon',
  clinic_open: false,  // Set based on business hours check
  clinic_closed: true  // Set based on business hours check
};

/**
 * Load and interpolate agent definition template
 * @param {string|null} callerNumber - Optional caller phone number for last 4 digits (also used for client lookup)
 * @returns {Promise<string>} Interpolated system prompt
 */
async function loadAgentDefinition(callerNumber = null) {
  try {
    let template = null;

    // Try to load from database if caller number provided
    if (callerNumber) {
      try {
        // Look up client by phone number
        const {data: phoneData, error: phoneError} = await supabase
          .from('phone_numbers')
          .select('client_id')
          .eq('phone_number', callerNumber)
          .single();

        if (!phoneError && phoneData) {
          // Load client configuration including system_prompt
          const {data: clientData, error: clientError} = await supabase
            .from('clients')
            .select('*')
            .eq('id', phoneData.client_id)
            .single();

          if (!clientError && clientData && clientData.system_prompt) {
            console.log(`Loaded system prompt from database for client: ${clientData.name}`);
            template = clientData.system_prompt;

            // Update CLIENT_CONFIG with database values
            CLIENT_CONFIG.office_name = clientData.office_name || CLIENT_CONFIG.office_name;
            CLIENT_CONFIG.agent_name = 'Jessica'; // Default voice
            CLIENT_CONFIG.office_hours = clientData.office_hours || CLIENT_CONFIG.office_hours;
          }
        }
      } catch (dbError) {
        console.warn('Database lookup failed, falling back to template file:', dbError.message);
      }
    }

    // Fallback to template file if database doesn't have a prompt
    if (!template) {
      const templatePath = path.join(__dirname, '..', 'ai-agent-definitions', 'humber_vet_ultravox_compliant.md');

      // Check if file exists
      if (!fs.existsSync(templatePath)) {
        console.error(`Template file not found: ${templatePath}`);
        throw new Error(`Template file not found: ${templatePath}`);
      }

      template = fs.readFileSync(templatePath, 'utf8');
      console.log(`Loaded agent template from file, length: ${template.length}`);
    }

    // Get last 4 digits of caller number
    const callerLast4 = callerNumber ? callerNumber.slice(-4) : '****';

    // Interpolate template variables
    template = template
      .replace(/\{\{office_name\}\}/g, CLIENT_CONFIG.office_name)
      .replace(/\{\{agent_name\}\}/g, CLIENT_CONFIG.agent_name)
      .replace(/\{\{office_hours\}\}/g, CLIENT_CONFIG.office_hours)
      .replace(/\{\{caller_phone_last4\}\}/g, callerLast4)
      .replace(/\{\{clinic_open\}\}/g, CLIENT_CONFIG.clinic_open)
      .replace(/\{\{clinic_closed\}\}/g, CLIENT_CONFIG.clinic_closed);

    console.log('Template interpolation complete');
    return template;
  } catch (error) {
    console.error('Error loading agent definition:', error);
    throw error;
  }
}

module.exports = {
  CLIENT_CONFIG,
  loadAgentDefinition
};
