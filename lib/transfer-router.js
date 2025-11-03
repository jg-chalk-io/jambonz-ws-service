/**
 * Transfer Router - Simplified routing for phone numbers and SIP URIs
 *
 * How Twilio Elastic SIP Trunks Work:
 * - When you dial a phone number, Twilio checks if it's associated with a SIP trunk
 * - If YES: Routes through the trunk's Origination URI (e.g., Aircall)
 * - If NO: Routes through standard PSTN
 *
 * Routing Logic:
 * 1. SIP URI (sip:user@domain) → Route through Jambonz (future implementation)
 * 2. Phone Number → Dial normally via Twilio (PSTN or Elastic SIP trunk auto-routing)
 */

/**
 * Determine transfer routing strategy based on destination number/URI
 *
 * @param {string} transferNumber - Transfer destination (phone number or SIP URI)
 * @param {object} client - Client configuration from database (not currently used)
 * @returns {object} Route configuration with type, method, and destination
 */
function determineTransferRoute(transferNumber, client) {
  // Check if it's a SIP URI (sip:user@domain or sips:user@domain)
  if (transferNumber.toLowerCase().startsWith('sip:') ||
      transferNumber.toLowerCase().startsWith('sips:')) {
    return {
      type: 'sip_uri',
      method: 'jambonz',
      destination: transferNumber,
      sipUri: transferNumber
    };
  }

  // Default: Phone number via Twilio
  // Twilio automatically routes through Elastic SIP trunk if number is associated
  // Otherwise routes through standard PSTN
  return {
    type: 'phone',
    method: 'twilio_phone',
    destination: transferNumber,
    sipUri: null
  };
}

module.exports = {
  determineTransferRoute
};
