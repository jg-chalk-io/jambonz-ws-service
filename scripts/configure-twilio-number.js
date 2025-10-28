#!/usr/bin/env node
require('dotenv').config();
const twilio = require('twilio');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_CALLER_ID || '+16479526096';
const BASE_URL = process.env.BASE_URL || 'https://jambonz-ws-service-production.up.railway.app';

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error('Error: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

async function configureTwilioNumber() {
  try {
    console.log(`Searching for Twilio number: ${TWILIO_PHONE_NUMBER}`);

    // Find the phone number SID
    const numbers = await client.incomingPhoneNumbers.list({
      phoneNumber: TWILIO_PHONE_NUMBER
    });

    if (numbers.length === 0) {
      console.error(`Error: Phone number ${TWILIO_PHONE_NUMBER} not found in your Twilio account`);
      process.exit(1);
    }

    const phoneNumber = numbers[0];
    console.log(`Found phone number SID: ${phoneNumber.sid}`);

    // Update the voice webhook URL
    const voiceUrl = `${BASE_URL}/twilio/incoming`;
    console.log(`Updating voice URL to: ${voiceUrl}`);

    await client.incomingPhoneNumbers(phoneNumber.sid).update({
      voiceUrl: voiceUrl,
      voiceMethod: 'POST'
    });

    console.log('✅ Successfully configured Twilio number!');
    console.log(`Voice calls to ${TWILIO_PHONE_NUMBER} will now route to ${voiceUrl}`);

  } catch (error) {
    console.error('Error configuring Twilio number:', error.message);
    if (error.code) {
      console.error(`Twilio error code: ${error.code}`);
    }
    process.exit(1);
  }
}

configureTwilioNumber();
