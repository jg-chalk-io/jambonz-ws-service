# Quick Start Guide

Get the Jambonz WebSocket service running in under 10 minutes.

## Prerequisites

- Node.js 18+ installed
- Supabase account with database tables (clients, call_logs)
- Ultravox API key
- Jambonz account

## Step 1: Clone and Install

```bash
cd /path/to/your/projects
git clone <your-repo-url> jambonz-ws-service
cd jambonz-ws-service
npm install
```

## Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...
ULTRAVOX_API_KEY=uvkey_...
PORT=3000
```

## Step 3: Test Locally

```bash
npm run dev
```

You should see:
```
Jambonz WebSocket service listening on port 3000
WebSocket endpoint created at /ws
```

Test health check:
```bash
curl http://localhost:3000/health
# {"status":"healthy","service":"jambonz-ws-service"}
```

## Step 4: Deploy to Railway

### Option A: From GitHub

1. Push to GitHub:
   ```bash
   git remote add origin https://github.com/YOUR-ORG/jambonz-ws-service.git
   git push -u origin main
   ```

2. In Railway dashboard:
   - New Project → Deploy from GitHub
   - Select repository
   - Add environment variables from `.env`

### Option B: With Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Add variables:
```bash
railway variables set SUPABASE_URL=...
railway variables set SUPABASE_SERVICE_KEY=...
railway variables set ULTRAVOX_API_KEY=...
```

## Step 5: Get Your WebSocket URL

After Railway deployment completes:
```
https://jambonz-ws-service-production.up.railway.app
```

Your WebSocket endpoint:
```
wss://jambonz-ws-service-production.up.railway.app/ws
```

## Step 6: Configure Jambonz

1. Log into Jambonz portal
2. Go to Applications
3. Edit your application
4. Change to:
   - **Application Type**: WebSocket
   - **WebSocket URL**: `wss://your-railway-url/ws`
5. Save

## Step 7: Test a Call

1. Call your Jambonz phone number
2. Watch Railway logs: `railway logs`
3. Expected output:
   ```
   New call session
   Processing incoming call
   Initiating Ultravox LLM session
   ```

4. Try saying "I need to speak with someone" to trigger transfer
5. Check logs for:
   ```
   Tool call received: transferToOnCall
   Transfer initiated
   ```

## Verification Checklist

- [ ] Service health check returns 200
- [ ] Railway logs show service started
- [ ] Call connects and AI responds
- [ ] Tool call (transfer) works correctly
- [ ] Call logs appear in Supabase
- [ ] No errors in Railway logs

## Troubleshooting

### Service Won't Start

**Error: supabase_url is required**
- Check environment variables are set in Railway
- Verify SUPABASE_URL has `https://`

### Calls Don't Connect

**No WebSocket connection**
- Confirm Jambonz application uses `wss://` (not `ws://`)
- Verify Railway service is running
- Check Jambonz application webhook URL is correct

### Tool Calls Fail

**"No client found"**
- Verify `clients` table has data
- Confirm `jambonz_account_sid` matches
- Check SUPABASE_SERVICE_KEY has permissions

## Next Steps

1. **Read ARCHITECTURE.md** - Understand how it works
2. **Read DEPLOYMENT.md** - Production deployment guide
3. **Customize prompts** - Edit system prompts in `handlers/incoming-call.js`
4. **Add tools** - Extend tool handlers in `handlers/tool-call.js`

## Support

- **Issues**: Check Railway logs first
- **Documentation**: See README.md, ARCHITECTURE.md, DEPLOYMENT.md
- **Health Check**: `curl https://your-url/health`

## Success!

If you can:
- ✅ Make a call
- ✅ AI responds
- ✅ Transfer works

You're all set! The WebSocket service is now handling your Jambonz LLM calls with proper multi-tenant routing.
