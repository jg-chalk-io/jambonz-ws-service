#!/usr/bin/env node
/**
 * Callback Request Processor
 *
 * Backend worker that:
 * 1. Polls callback_requests table for pending/failed requests
 * 2. Posts them to your frontend API
 * 3. Implements retry with exponential backoff
 * 4. Logs all attempts for debugging
 *
 * Usage:
 *   node scripts/process_callback_requests.js            # Run once
 *   node scripts/process_callback_requests.js --daemon   # Run continuously
 */

require('dotenv').config();
const {supabase} = require('../lib/supabase');
const pino = require('pino');

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

// Configuration
const FRONTEND_API_URL = process.env.FRONTEND_CALLBACK_API_URL || 'https://your-frontend.com/api/callbacks';
const FRONTEND_API_KEY = process.env.FRONTEND_API_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.CALLBACK_POLL_INTERVAL_MS || '30000'); // 30 seconds
const BATCH_SIZE = parseInt(process.env.CALLBACK_BATCH_SIZE || '10');

/**
 * Post callback request to frontend
 */
async function postToFrontend(request) {
  const payload = {
    id: request.id,
    callbackNumber: request.callback_number,
    callerName: request.caller_name,
    petName: request.pet_name,
    species: request.species,
    concernDescription: request.concern_description,
    urgencyLevel: request.urgency_level,
    callSid: request.call_sid,
    createdAt: request.created_at
  };

  logger.info({requestId: request.id, callbackNumber: request.callback_number}, 'Posting to frontend');

  const response = await fetch(FRONTEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FRONTEND_API_KEY}`,
      'X-Request-ID': request.id
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Frontend API returned ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result;
}

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetry(retryCount) {
  // Exponential backoff: 5min, 15min, 1hour
  const delays = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
  const delay = delays[Math.min(retryCount, delays.length - 1)];
  return new Date(Date.now() + delay).toISOString();
}

/**
 * Process a single callback request
 */
async function processRequest(request) {
  const requestId = request.id;

  try {
    // Attempt to post to frontend
    const result = await postToFrontend(request);

    // Success! Mark as posted
    const {error: updateError} = await supabase
      .from('callback_requests')
      .update({
        status: 'posted',
        posted_to_frontend_at: new Date().toISOString(),
        frontend_response: result
      })
      .eq('id', requestId);

    if (updateError) {
      logger.error({updateError, requestId}, 'Failed to update request status to posted');
    } else {
      logger.info({requestId, callbackNumber: request.callback_number}, 'Successfully posted to frontend');
    }

    return true;

  } catch (err) {
    logger.error({err, requestId}, 'Failed to post to frontend');

    // Increment retry count
    const newRetryCount = request.retry_count + 1;
    const maxRetries = request.max_retries;

    if (newRetryCount >= maxRetries) {
      // Max retries reached - mark as failed permanently
      const {error: updateError} = await supabase
        .from('callback_requests')
        .update({
          status: 'failed',
          error_message: err.message,
          retry_count: newRetryCount
        })
        .eq('id', requestId);

      logger.error({
        requestId,
        callbackNumber: request.callback_number,
        retryCount: newRetryCount,
        maxRetries
      }, 'Max retries reached - marking as permanently failed');

    } else {
      // Schedule retry with exponential backoff
      const nextRetryAt = calculateNextRetry(newRetryCount);

      const {error: updateError} = await supabase
        .from('callback_requests')
        .update({
          status: 'failed',
          error_message: err.message,
          retry_count: newRetryCount,
          next_retry_at: nextRetryAt
        })
        .eq('id', requestId);

      logger.warn({
        requestId,
        callbackNumber: request.callback_number,
        retryCount: newRetryCount,
        nextRetryAt
      }, 'Scheduling retry');
    }

    return false;
  }
}

/**
 * Get pending and failed requests ready for processing
 */
async function getRequestsToProcess() {
  const now = new Date().toISOString();

  const {data, error} = await supabase
    .from('callback_requests')
    .select('*')
    .or(`status.eq.pending,and(status.eq.failed,next_retry_at.lte.${now})`)
    .order('urgency_level', {ascending: false}) // critical first
    .order('created_at', {ascending: true}) // oldest first
    .limit(BATCH_SIZE);

  if (error) {
    logger.error({error}, 'Failed to fetch requests');
    return [];
  }

  return data || [];
}

/**
 * Main processing loop
 */
async function processAll() {
  logger.info('Starting callback request processing...');

  const requests = await getRequestsToProcess();

  if (requests.length === 0) {
    logger.info('No pending callback requests to process');
    return;
  }

  logger.info({count: requests.length}, 'Processing callback requests');

  let successCount = 0;
  let failureCount = 0;

  for (const request of requests) {
    const success = await processRequest(request);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }

    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info({
    total: requests.length,
    success: successCount,
    failures: failureCount
  }, 'Callback request processing complete');
}

/**
 * Run in daemon mode
 */
async function runDaemon() {
  logger.info({pollIntervalMs: POLL_INTERVAL_MS}, 'Starting callback processor daemon');

  while (true) {
    try {
      await processAll();
    } catch (err) {
      logger.error({err}, 'Error in processing loop');
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const isDaemon = args.includes('--daemon');

  logger.info({
    frontendApiUrl: FRONTEND_API_URL,
    isDaemon,
    pollIntervalMs: isDaemon ? POLL_INTERVAL_MS : 'N/A'
  }, 'Callback request processor starting');

  if (!FRONTEND_API_KEY) {
    logger.warn('FRONTEND_API_KEY not set - requests may fail authentication');
  }

  if (isDaemon) {
    await runDaemon();
  } else {
    await processAll();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    logger.error({err}, 'Fatal error');
    process.exit(1);
  });
}

module.exports = {processAll, processRequest};
