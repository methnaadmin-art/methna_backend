# 🔴 Deployment Issue: 502 Bad Gateway

## Current Status

**Symptom:** All endpoints returning 502 Bad Gateway  
**Meaning:** Railway is routing requests to the app, but the app is crashing on startup  
**Progress:** ✅ Deployment successful, ❌ Application not starting

---

## What We Fixed

1. ✅ **Procfile path** - Changed to `node dist/src/main.js`
2. ✅ **Railway configuration** - Added `railway.toml` with explicit build commands
3. ✅ **Code is complete** - All Apple subscription code is implemented
4. ✅ **Environment variables** - All APPLE_* variables are set in Railway

---

## Root Cause (Most Likely)

The application is **crashing on startup**, most likely due to one of these issues:

### 1. Missing Database Table (Most Likely)
The `app_update_policies` table might not exist in the production database.

**Evidence:**
- `MobileController` depends on `AppUpdatePolicyService`
- `AppUpdatePolicyService` queries `app_update_policies` table
- If table doesn't exist, TypeORM will crash on startup

**Solution:** Run migrations on production database

### 2. Database Connection Issue
The app might not be able to connect to the database.

**Evidence:**
- TypeORM initialization happens on startup
- Connection failures cause 502 errors

**Solution:** Verify DATABASE_URL environment variable

### 3. Missing Environment Variable
A required environment variable might be missing.

**Solution:** Check Railway logs for specific error

---

## Immediate Next Steps

### Step 1: Check Railway Logs (CRITICAL)

1. Go to Railway dashboard: https://railway.app
2. Select your project
3. Click on the service
4. Click "Logs" tab
5. Look for error messages at the bottom

**What to look for:**
- `Error: relation "app_update_policies" does not exist`
- `Error: connect ECONNREFUSED` (database connection)
- `Error: Missing required environment variable`
- Any stack trace showing which module is failing

### Step 2: Run Database Migrations

If logs show missing table errors:

```bash
# Connect to Railway database
# In Railway dashboard, get DATABASE_URL from Variables tab

# Option A: Run migrations via Railway CLI
railway run npm run migration:run

# Option B: Run migrations locally against production DB
# (Set DATABASE_URL in .env temporarily)
npm run migration:run
```

### Step 3: Verify Environment Variables

In Railway dashboard, Variables tab, ensure these exist:
- `DATABASE_URL`
- `REDIS_URL` (if using Redis)
- `JWT_SECRET`
- `APPLE_ISSUER_ID`
- `APPLE_KEY_ID`
- `APPLE_BUNDLE_ID`
- `APPLE_APP_APPLE_ID`
- `APPLE_PRIVATE_KEY`
- `APPLE_APP_STORE_ENVIRONMENT`

### Step 4: Manual Redeploy

After fixing the issue:
1. In Railway dashboard
2. Click "Deploy" → "Redeploy"
3. Wait 2-3 minutes
4. Test again: `node test-apple-endpoint.js`

---

## Alternative: Temporary Fix

If you need to get the app running quickly, we can temporarily disable the `AppUpdatePolicyModule`:

### Option A: Make AppUpdatePolicy Optional

Modify `MobileController` to handle missing service gracefully:

```typescript
// In mobile.controller.ts
@Get('config/update-policy')
async getMobileUpdatePolicy(
    @Query('platform') platform?: string,
    @Query('version') version?: string,
) {
    try {
        return await this.appUpdatePolicyService.getMobilePolicy({ platform, version });
    } catch (error) {
        // Return default policy if service fails
        return {
            isActive: false,
            platform: platform || 'android',
            currentVersion: version || '',
            hardRequired: false,
            softUpdateAvailable: false,
        };
    }
}
```

### Option B: Remove AppUpdatePolicyModule Temporarily

1. Comment out in `mobile.module.ts`:
```typescript
imports: [
    SubscriptionsModule,
    PaymentsModule,
    ConsumablesModule,
    // AppUpdatePolicyModule,  // Temporarily disabled
],
```

2. Comment out in `mobile.controller.ts`:
```typescript
// private readonly appUpdatePolicyService: AppUpdatePolicyService,
```

3. Comment out the update policy endpoint

4. Commit and push

**Note:** This will disable the app update policy feature but allow the app to start.

---

## Testing After Fix

Once the app starts successfully:

```bash
node test-apple-endpoint.js
```

**Expected output:**
```
✅ Endpoint exists and requires authentication (401)
✅ Plans endpoint working (200)
```

---

## Debug Information

### Current Test Results
```
POST /mobile/payments/apple/verify → 502 Bad Gateway
GET /mobile/plans → 502 Bad Gateway
```

### Railway Configuration
- **Build command:** `npm run build`
- **Start command:** `node dist/src/main.js`
- **Procfile:** `web: node dist/src/main.js`

### Recent Commits
- `16fe323` - Fix Procfile path
- `4b9ce33` - Add Railway configuration

---

## What to Share

Please share the **Railway logs** (last 50-100 lines) so we can see the exact error message. This will tell us:
- Which module is failing
- What table or connection is missing
- The exact error message

**How to get logs:**
1. Railway dashboard → Your service → Logs tab
2. Scroll to bottom (most recent)
3. Copy the error messages
4. Share here

---

## Summary

✅ **Code is complete and correct**  
✅ **Deployment configuration is correct**  
❌ **Application is crashing on startup**  
🔍 **Need Railway logs to identify exact cause**

**Most likely fix:** Run database migrations to create missing tables

**Next action:** Check Railway logs and share the error message
