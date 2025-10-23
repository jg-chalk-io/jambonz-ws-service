# Aircall SIP Integration Setup Guide

This guide explains how to configure call transfers to Aircall while preserving the original caller ID.

## Overview

Instead of using phone numbers, we transfer directly to Aircall via SIP URI. This allows:
- ✅ Original caller ID preserved (shows actual caller, not your Twilio number)
- ✅ Direct SIP-to-SIP transfer (faster, better quality)
- ✅ Works with Aircall's existing Twilio integration

## Prerequisites

1. **Aircall Account** with Twilio SIP trunking configured
2. **Aircall SIP URI** - Get this from Aircall dashboard
3. **Jambonz** - Already configured (you have this)

## Step 1: Get Your Aircall SIP URI

### Option A: If You Already Have Twilio Numbers in Aircall

1. Log into Aircall Dashboard
2. Go to **Users** → **Call Preferences**
3. Find **"Forward calls to a SIP device"** section
4. Generate SIP credentials - you'll get a SIP URI like:
   ```
   sip:username@aircall-production.sip.twilio.com
   ```

### Option B: If You Need to Set Up Twilio SIP Trunk

Follow Aircall's guide: https://support-v2.aircall.io/en-gb/articles/10375356158109

1. In Twilio Console:
   - Create SIP trunk named "Aircall Trunk"
   - Disable Secure Trunking
   - Add Origination URI based on your region:
     - **North America**: `sip:aircall-custom.sip.us1.twilio.com`
     - **Europe**: `sip:aircall-custom.sip.ie1.twilio.com`
     - **Asia/Oceania**: `sip:aircall-custom.sip.sg1.twilio.com`

2. Contact Aircall support to link the trunk

3. Get your SIP URI from Aircall dashboard

## Step 2: Configure Transfer Destination in Supabase

Update your client record in the `clients` table:

```sql
UPDATE clients
SET primary_transfer_number = 'sip:your-aircall-user@aircall-production.sip.twilio.com'
WHERE id = 'your-client-id';
```

**Important:** Use the full SIP URI, including `sip:` prefix and domain.

## Step 3: Test the Transfer

1. Call your Jambonz number
2. Ask the AI to transfer you
3. The call should route to Aircall with your original caller ID visible

## How It Works

### Detection Logic

The code automatically detects SIP URIs:

```javascript
// If transfer_number contains '@' → SIP URI
const isAircallSip = transferNumber.includes('@');
```

### Transfer Behavior

**SIP URI Transfer (Aircall):**
```javascript
{
  type: 'sip',
  sipUri: 'sip:user@aircall-production.sip.twilio.com',
  callerId: '+14168189171' // Original caller preserved
}
```

**Phone Number Transfer (Regular):**
```javascript
{
  type: 'phone',
  number: '+13654001512',
  trunk: 'Twilio-PetOne',
  callerId: '+16479526096' // Your Twilio number
}
```

## Troubleshooting

### Caller ID Not Showing Original Number

**Check:**
1. Aircall SIP trunk allows caller ID passthrough
2. No SBC/firewall stripping SIP headers
3. Using correct regional SIP URI

### Transfer Not Connecting

**Check:**
1. SIP URI format is correct (includes `sip:` prefix)
2. Aircall trunk is active in Twilio
3. Jambonz has outbound SIP permissions

### Call Quality Issues

**Check:**
1. Network latency between Jambonz and Aircall
2. Codec compatibility (both should support G.711)
3. Firewall/NAT configuration

## Alternative: Multiple Transfer Destinations

You can configure different transfer types per client:

```sql
-- Aircall for urgent transfers
UPDATE clients SET primary_transfer_number = 'sip:oncall@aircall-production.sip.twilio.com';

-- Phone number for voicemail
UPDATE clients SET voicemail_number = '+13654001512';

-- Secondary option
UPDATE clients SET secondary_transfer_number = 'sip:backup@aircall-production.sip.twilio.com';
```

## Cost Considerations

- **SIP-to-SIP transfers**: Lower cost than phone transfers
- **Aircall charges**: Check Aircall pricing for inbound calls via SIP trunk
- **Twilio charges**: Minimal (just SIP trunking fees, no outbound call charges)

## Support

For Aircall-specific issues:
- Aircall Support: https://support-v2.aircall.io/
- Aircall API Docs: https://developer.aircall.io/

For Jambonz issues:
- Jambonz Docs: https://docs.jambonz.org/
- Jambonz GitHub: https://github.com/jambonz
