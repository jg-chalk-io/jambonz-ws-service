# Deployment Checklist

Use this checklist to deploy the WebSocket service to Railway and switch Jambonz over.

## Pre-Deployment

- [x] Code pushed to GitHub: https://github.com/jg-chalk-io/jambonz-ws-service.git
- [x] All handlers implemented (incoming-call, tool-call, llm-complete, call-status)
- [x] Documentation complete (README, QUICKSTART, DEPLOYMENT, ARCHITECTURE)
- [ ] Environment variables ready (see below)

## Environment Variables Needed

Copy these values from your existing Flask deployment:

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ULTRAVOX_API_KEY=
JAMBONZ_ACCOUNT_SID=
JAMBONZ_API_KEY=
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

## Railway Deployment Steps

### 1. Create New Railway Project

- [ ] Go to https://railway.app
- [ ] Click "New Project"
- [ ] Select "Deploy from GitHub repo"
- [ ] Choose: `jg-chalk-io/jambonz-ws-service`
- [ ] Railway auto-detects Node.js

### 2. Configure Environment Variables

In Railway dashboard → Variables tab:

- [ ] Add `SUPABASE_URL`
- [ ] Add `SUPABASE_SERVICE_KEY`
- [ ] Add `ULTRAVOX_API_KEY`
- [ ] Add `JAMBONZ_ACCOUNT_SID` (optional, for API calls)
- [ ] Add `JAMBONZ_API_KEY` (optional, for API calls)
- [ ] Add `PORT=3000`
- [ ] Add `NODE_ENV=production`
- [ ] Add `LOG_LEVEL=info`

### 3. Wait for Deployment

- [ ] Watch build logs in Railway
- [ ] Should complete in ~2-3 minutes
- [ ] Note your Railway URL (e.g., `jambonz-ws-service-production.up.railway.app`)

### 4. Verify Deployment

- [ ] Test health endpoint:
  ```bash
  curl https://YOUR-RAILWAY-URL/health
  # Expected: {"status":"healthy","service":"jambonz-ws-service"}
  ```

- [ ] Check Railway logs show:
  ```
  Jambonz WebSocket service listening on port 3000
  WebSocket endpoint created at /ws
  ```

## Jambonz Configuration

### 5. Update Jambonz Application (CRITICAL STEP)

⚠️ **IMPORTANT**: This switches from HTTP to WebSocket mode

1. [ ] Log into Jambonz portal
2. [ ] Navigate to **Applications**
3. [ ] Find your PBX application
4. [ ] Click **Edit**
5. [ ] Change these settings:

   **BEFORE:**
   ```
   Application Type: HTTP
   Call webhook: https://voice-backend-coordination-production.up.railway.app/incoming-call
   ```

   **AFTER:**
   ```
   Application Type: WebSocket
   WebSocket URL: wss://YOUR-RAILWAY-URL/ws
   ```

6. [ ] **Save** the application

### 6. Important Notes

- Replace `YOUR-RAILWAY-URL` with your actual Railway domain
- Use `wss://` (secure WebSocket), not `ws://`
- Don't include `/health` or other paths - just `/ws`
- Example: `wss://jambonz-ws-service-production.up.railway.app/ws`

## Testing

### 7. Test Call Flow

- [ ] Make a test call to your Jambonz number
- [ ] Verify AI answers and responds
- [ ] Check Railway logs show:
  ```
  New call session
  Processing incoming call
  Initiating Ultravox LLM session
  ```

### 8. Test Transfer Tool

- [ ] During call, say "I need to speak with someone urgently"
- [ ] Verify transfer is attempted
- [ ] Check Railway logs show:
  ```
  Tool call received: transferToOnCall
  Transfer initiated to: +1XXXXXXXXXX
  ```

### 9. Test Info Collection

- [ ] Make another call
- [ ] Provide name, number, and reason
- [ ] Verify info is collected
- [ ] Check Railway logs show:
  ```
  Tool call received: collectCallerInfo
  Caller info collected: {name, number, concern}
  ```

### 10. Test Hang Up

- [ ] After providing info, AI should say goodbye
- [ ] Call should end
- [ ] Check Railway logs show:
  ```
  Tool call received: hangUp
  Hanging up call
  ```

## Database Verification

### 11. Check Supabase

- [ ] Go to Supabase dashboard
- [ ] Check `call_logs` table
- [ ] Verify new records appear with:
  - `call_sid`
  - `client_id`
  - `status` = 'completed' or 'in_progress'
  - `transferred_to_human` = true (if transfer was tested)

## Monitoring (First 24 Hours)

### 12. Monitor Railway Logs

- [ ] Check for any errors
- [ ] Verify all calls appear in logs
- [ ] Confirm tool calls are working
- [ ] Watch for memory/CPU issues (should be minimal)

### 13. Success Criteria

All of these should be true:

- [ ] Calls connect successfully
- [ ] AI responds appropriately
- [ ] Transfer tool works (initiates transfer)
- [ ] Info collection tool works (stores data)
- [ ] Hang up tool works (ends call)
- [ ] Call logs created in Supabase
- [ ] No errors in Railway logs
- [ ] WebSocket connections stable

## Rollback Plan (If Needed)

If any issues occur, you can quickly rollback:

### Emergency Rollback Steps

1. [ ] Go to Jambonz application settings
2. [ ] Change Application Type back to **HTTP**
3. [ ] Set Call webhook to: `https://voice-backend-coordination-production.up.railway.app/incoming-call`
4. [ ] Save
5. [ ] Test call - should work with old Flask service
6. [ ] Debug WebSocket service issues
7. [ ] Re-attempt deployment when fixed

Note: Flask HTTP webhook service is still running and can handle calls immediately.

## Post-Deployment

### 14. Update Documentation

- [ ] Document the WebSocket URL in your runbooks
- [ ] Update team wiki/docs with new architecture
- [ ] Note that transfers now work properly
- [ ] Share Railway dashboard access with team

### 15. Optional Cleanup

After 1 week of stable operation:

- [ ] Consider removing HTTP tool-call endpoints from Flask
- [ ] Keep Flask running for Ultravox webhooks (still needed)
- [ ] Archive old session cache code (no longer needed)
- [ ] Update monitoring alerts for WebSocket service

## Deployment Complete! 🎉

When all items above are checked:

✅ WebSocket service is live
✅ Jambonz is using WebSocket mode
✅ Tool calls work with proper context
✅ Multi-tenant routing is functional
✅ No more "No client found for account: None" errors

---

**Deployed By:** _________________
**Date:** _________________
**Railway URL:** wss://_________________/ws
**Status:** ⬜ Success ⬜ Rollback Required
**Notes:** _________________
