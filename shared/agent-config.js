const fs = require('fs');
const path = require('path');

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
 * @param {string|null} callerNumber - Optional caller phone number for last 4 digits
 * @returns {string} Interpolated system prompt
 */
function loadAgentDefinition(callerNumber = null) {
  const templatePath = path.join(__dirname, '..', 'ai-agent-definitions', 'humber_vet_ultravox_compliant.md');
  let template = fs.readFileSync(templatePath, 'utf8');

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

  return template;
}

module.exports = {
  CLIENT_CONFIG,
  loadAgentDefinition
};
