/**
 * Transfer Router - Intelligent routing for Aircall SIP, other SIP, and PSTN transfers
 *
 * Routing Logic:
 * 1. Aircall SIP: If transfer number matches client.aircall_sip_number → Use Twilio SIP trunk
 * 2. Other SIP: If transfer number starts with "sip:" → Route through Jambonz
 * 3. PSTN: Default behavior → Use Twilio outbound PSTN
 */

/**
 * Determine transfer routing strategy based on destination number/URI
 *
 * @param {string} transferNumber - Transfer destination (phone number or SIP URI)
 * @param {object} client - Client configuration from database
 * @returns {object} Route configuration with type, method, destination, and sipUri
 */
function determineTransferRoute(transferNumber, client) {
  // Normalize transfer number for comparison (remove spaces, dashes)
  const normalizedTransfer = transferNumber.replace(/[\s\-()]/g, '');
  const normalizedAircall = client.aircall_sip_number?.replace(/[\s\-()]/g, '');

  // Check if Aircall SIP is configured and matches
  if (normalizedAircall && normalizedTransfer === normalizedAircall) {
    // Ensure E.164 format for SIP URI (+1XXXXXXXXXX)
    const e164Number = normalizedAircall.startsWith('+')
      ? normalizedAircall
      : `+${normalizedAircall}`;

    return {
      type: 'aircall_sip',
      method: 'twilio_sip',
      destination: transferNumber,
      sipUri: `sip:${e164Number}@aircall-custom.sip.us1.twilio.com`,
      trunkSid: client.twilio_aircall_trunk_sid || 'TK9e454ef3135d17201fc935de6cda56ec'
    };
  }

  // Check if it's a SIP URI (sip:user@domain or sips:user@domain)
  if (transferNumber.toLowerCase().startsWith('sip:') ||
      transferNumber.toLowerCase().startsWith('sips:')) {
    return {
      type: 'other_sip',
      method: 'jambonz',
      destination: transferNumber,
      sipUri: transferNumber,
      trunkSid: null
    };
  }

  // Default: PSTN via Twilio outbound
  return {
    type: 'pstn',
    method: 'twilio_pstn',
    destination: transferNumber,
    sipUri: null,
    trunkSid: null
  };
}

/**
 * Get regional Aircall SIP domain based on configuration
 * Default: North/South America (us1)
 *
 * @param {object} client - Client configuration
 * @returns {string} Aircall SIP domain
 */
function getAircallSipDomain(client) {
  const region = client.aircall_region || 'us1'; // Default to North/South America

  const regionMap = {
    'us1': 'aircall-custom.sip.us1.twilio.com',  // North/South America
    'ie1': 'aircall-custom.sip.ie1.twilio.com',  // Europe
    'sg1': 'aircall-custom.sip.sg1.twilio.com'   // Asia/Oceania
  };

  return regionMap[region] || regionMap['us1'];
}

module.exports = {
  determineTransferRoute,
  getAircallSipDomain
};
