# Apple Sign-In - Quick Fix Guide

## 🚨 Problem
iOS TestFlight: **"Cannot POST /api/v1/auth/apple"**

## ✅ Solution
**Deploy the backend** (code is already complete)

---

## 🚀 Quick Fix (5 minutes)

### Step 1: Deploy
```bash
# If using Railway/Heroku (auto-deploy)
git add .
git commit -m "Deploy Apple Sign-In"
git push origin main

# If manual deploy
npm run build
# Upload dist/ to server and restart
```

### Step 2: Verify
```bash
# Should return 401 (not 404)
curl -X POST https://your-api.com/api/v1/auth/apple \
  -H "Content-Type: application/json" \
  -d '{"identityToken":"test"}'

# Or use test script
node test-apple-endpoint.js https://your-api.com
```

### Step 3: Test in iOS
1. Open TestFlight
2. Tap "Sign in with Apple"
3. Complete authentication
4. ✅ Should login successfully

---

## 📋 What Was Done

### Backend (Already Complete)
- ✅ Endpoint: `POST /api/v1/auth/apple`
- ✅ Token verification (Apple public keys)
- ✅ User creation/linking
- ✅ Database schema (appleUserId column)
- ✅ Same response as Google/email login
- ✅ Build successful

### What's Needed
- ❌ Deploy to production (ONLY BLOCKER)

---

## 🧪 Test Checklist

After deployment:
- [ ] Endpoint returns 401 (not 404)
- [ ] iOS can complete Apple auth
- [ ] User is created/logged in
- [ ] Profile data populated
- [ ] Tokens work
- [ ] Google login still works
- [ ] Email login still works

---

## 📞 Support

**Test endpoint:**
```bash
node test-apple-endpoint.js <your-api-url>
```

**Check logs:**
```bash
# Look for:
[AppleSignIn] Attempt
[AppleSignIn] Success user=<id>
```

**Verify database:**
```sql
SELECT * FROM users WHERE "appleUserId" IS NOT NULL;
```

---

## 📚 Full Documentation

- `APPLE_SIGNIN_FIX_REPORT.md` - Complete fix report
- `APPLE_SIGNIN_SUMMARY.md` - Executive summary
- `DEPLOYMENT_CHECKLIST.md` - Detailed deployment steps
- `test-apple-endpoint.js` - Automated test script

---

## ✨ Result

After deployment:
- ✅ Apple Sign-In works in iOS
- ✅ Users can login with Apple ID
- ✅ Same experience as Google login
- ✅ No code changes needed
- ✅ 5-minute fix
