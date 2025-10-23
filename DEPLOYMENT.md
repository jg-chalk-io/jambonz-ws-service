# Deployment Guide

## Railway Deployment

### Option 1: Deploy from GitHub (Recommended)

1. **Create GitHub Repository**
   ```bash
   # On GitHub.com, create a new private repository named "jambonz-ws-service"
   git remote add origin https://github.com/YOUR-ORG/jambonz-ws-service.git
   git push -u origin main
   ```

2. **Deploy to Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose the `jambonz-ws-service` repository
   - Railway will auto-detect Node.js and use `npm start`

3. **Configure Environment Variables**

   In Railway dashboard, add these variables:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ULTRAVOX_API_KEY=your-ultravox-api-key
   JAMBONZ_ACCOUNT_SID=your-jambonz-account-sid
   JAMBONZ_API_KEY=your-jambonz-api-key
   PORT=3000
   NODE_ENV=production
   LOG_LEVEL=info
   ```

4. **Get Your WebSocket URL**

   After deployment, Railway provides a URL like:
   ```
   https://jambonz-ws-service-production.up.railway.app
   ```

   Your WebSocket endpoint will be:
   ```
   wss://jambonz-ws-service-production.up.railway.app/ws
   ```

### Option 2: Deploy with Railway CLI

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. **Initialize and Deploy**
   ```bash
   cd /path/to/jambonz-ws-service
   railway init
   railway up
   ```

3. **Add Environment Variables**
   ```bash
   railway variables set SUPABASE_URL=https://...
   railway variables set SUPABASE_SERVICE_KEY=...
   railway variables set ULTRAVOX_API_KEY=...
   # ... etc
   ```

## Configure Jambonz

### Update Jambonz Application

1. Log into your Jambonz portal
2. Navigate to **Applications**
3. Edit your PBX application
4. Change these settings:

   **Before (HTTP Webhooks):**
   ```
   Call webhook: https://your-flask-app.railway.app/incoming-call
   ```

   **After (WebSocket):**
   ```
   Application Type: WebSocket
   WebSocket URL: wss://jambonz-ws-service-production.up.railway.app/ws
   ```

5. Save the application

## Verification

### 1. Check Service Health

```bash
curl https://jambonz-ws-service-production.up.railway.app/health
```

Expected response:
```json
{"status":"healthy","service":"jambonz-ws-service"}
```

### 2. Check Railway Logs

```bash
railway logs
```

Look for:
```
Jambonz WebSocket service listening on port 3000
WebSocket endpoint created at /ws
```

### 3. Test with a Call

1. Make a test call to your Jambonz number
2. Watch Railway logs for:
   ```
   New call session
   Processing incoming call
   LLM session initiated
   ```
3. Try triggering a transfer
4. Verify you see:
   ```
   Tool call received: transferToOnCall
   Transfer initiated
   ```

## Rollback Plan

If issues occur, you can quickly rollback to HTTP webhooks:

1. In Jambonz, change Application Type back to "HTTP"
2. Set webhook URL to your Flask service
3. The Flask service is still running and handles HTTP webhooks

## Monitoring

### Railway Dashboard
- View logs in real-time
- Monitor CPU/memory usage
- Check deployment status

### Key Metrics to Watch
- **Connection count**: Should match active calls
- **Error rate**: Should be near zero
- **Response time**: Tool calls should respond in < 100ms
- **Memory usage**: Should stay under 256MB for typical loads

## Troubleshooting

### WebSocket Connection Fails
```
Error: WebSocket connection failed
```

**Solutions:**
- Verify Railway service is running (check health endpoint)
- Confirm WebSocket URL uses `wss://` (not `ws://`)
- Check Railway logs for startup errors
- Ensure PORT environment variable is set

### Tool Calls Not Working
```
Tool call received: transferToOnCall
Error: No client found
```

**Solutions:**
- Verify Supabase credentials are correct
- Check that `clients` table has data
- Confirm `jambonz_account_sid` matches in database and Jambonz
- Review session.locals.client is set in logs

### Database Connection Issues
```
Error: supabase_url is required
```

**Solutions:**
- Verify SUPABASE_URL is set in Railway
- Confirm SUPABASE_SERVICE_KEY is the service role key (not anon key)
- Test connection: `curl $SUPABASE_URL/rest/v1/clients` with auth header

## Next Steps

After successful deployment:

1. **Test all tools**:
   - Transfer (transferToOnCall)
   - Info collection (collectCallerInfo)
   - Hang up (hangUp)

2. **Monitor for 24 hours**:
   - Check logs for errors
   - Verify call logs are being created in Supabase
   - Confirm transfers work correctly

3. **Update documentation**:
   - Document the WebSocket URL
   - Update any runbooks or procedures
   - Notify team of the change

4. **Optional: Retire Flask HTTP webhooks**:
   - Once stable, you can remove HTTP webhook endpoints from Flask
   - Keep Flask running for Ultravox webhooks and other features
   - Or migrate those to Node as well
