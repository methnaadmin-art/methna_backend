# Apple Sign-In Deployment Checklist

## ✅ Pre-Deployment Verification

### 1. Code Verification
- [x] Apple endpoint exists in `src/modules/auth/auth.controller.ts`
- [x] Apple service logic exists in `src/modules/auth/auth.service.ts`
- [x] AppleSignInDto exists in `src/modules/auth/dto/auth.dto.ts`
- [x] User entity has `appleUserId` column
- [x] Migration exists for `appleUserId` column
- [x] Build completes successfully (`npm run build`)
- [x] Compiled code contains Apple endpoint in `dist/`

### 2. Environment Variables
Check production environment has these set:

```bash
# Required
APPLE_SIGN_IN_CLIENT_ID=com.methnapp.app
APPLE_BUNDLE_ID=com.methnapp.app
API_PREFIX=api/v1

# Optional
APPLE_SIGN_IN_ALLOWED_AUDIENCES=
```

### 3. Database Migration
Ensure the migration has run in production:

```sql
-- Check if column exists
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name = 'appleUserId';

-- Check if index exists
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'users' 
AND indexname = 'IDX_users_appleUserId_unique';
```

## 🚀 Deployment Steps

### Option A: Automatic Deployment (Railway/Heroku)

1. **Commit and push changes:**
   ```bash
   git add .
   git commit -m "Deploy Apple Sign-In endpoint"
   git push origin main
   ```

2. **Wait for automatic deployment**
   - Railway: Check deployment logs in dashboard
   - Heroku: Check `heroku logs --tail`

3. **Verify deployment:**
   ```bash
   node test-apple-endpoint.js https://your-api.railway.app
   ```

### Option B: Manual Deployment

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Upload dist folder to server**

3. **Restart the server:**
   ```bash
   pm2 restart wafaa-backend
   # or
   systemctl restart wafaa-backend
   ```

4. **Check server logs:**
   ```bash
   pm2 logs wafaa-backend
   # or
   journalctl -u wafaa-backend -f
   ```

## 🧪 Post-Deployment Testing

### 1. Test Endpoint Accessibility

```bash
# Should return 401 (not 404)
curl -X POST https://your-api.com/api/v1/auth/apple \
  -H "Content-Type: application/json" \
  -d '{"identityToken": "test"}'
```

Expected response:
```json
{
  "statusCode": 401,
  "message": "Invalid Apple identity token format",
  "error": "Unauthorized"
}
```

### 2. Test with Node Script

```bash
node test-apple-endpoint.js https://your-api.com
```

Expected output:
```
✅ PASSED: Endpoint exists (returned 401 for invalid token)
✅ PASSED: Validation works (returned 400 for missing fields)
```

### 3. Test from iOS TestFlight

1. Open app in TestFlight
2. Tap "Sign in with Apple"
3. Complete Apple authentication
4. Verify successful login
5. Check user profile is populated
6. Verify tokens are stored

### 4. Check Server Logs

Look for these log entries:
```
[AppleSignIn] Attempt
[AppleSignIn] Processing appleUserId=*** email=***
[AppleSignIn] New user created: <user-id>
[AppleSignIn] Success user=<user-id>
```

## 🔍 Troubleshooting

### Issue: Still getting 404

**Possible causes:**
1. Server not restarted after deployment
2. Old build artifacts cached
3. Wrong API prefix in environment

**Fix:**
```bash
# Clear build cache
rm -rf dist/
npm run build

# Restart server
pm2 restart all
# or redeploy
git commit --allow-empty -m "Force redeploy"
git push origin main
```

### Issue: Getting 401 "Invalid Apple identity token"

**This is expected!** It means the endpoint is working.

The 401 error occurs because:
- Test tokens are invalid
- Real tokens must come from iOS Apple Sign-In

**Next step:** Test with real Apple ID from iOS app

### Issue: Getting 400 "Missing Apple identity token"

**This is also expected!** It means validation is working.

**Next step:** Ensure iOS app sends `identityToken` in request body

### Issue: User created but missing data

**Check:**
1. iOS app sends `fullName` on first login
2. Backend logs show name extraction
3. Database has firstName/lastName populated

**Note:** Apple only sends name on FIRST login. Subsequent logins won't have name data.

## 📱 iOS App Configuration

### Required Info.plist entries:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>methna</string>
        </array>
    </dict>
</array>
```

### Required Capabilities:
- Sign in with Apple

### Required Code (React Native):

```typescript
import appleAuth from '@invertase/react-native-apple-authentication';

const onAppleSignIn = async () => {
  try {
    const appleAuthRequestResponse = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
    });

    const { identityToken, authorizationCode, user, email, fullName } = appleAuthRequestResponse;

    // Send to backend
    const response = await fetch('https://your-api.com/api/v1/auth/apple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identityToken,
        authorizationCode,
        userIdentifier: user,
        email,
        fullName: fullName ? {
          givenName: fullName.givenName,
          familyName: fullName.familyName,
        } : undefined,
      }),
    });

    const data = await response.json();
    
    if (response.ok) {
      // Store tokens
      await AsyncStorage.setItem('accessToken', data.accessToken);
      await AsyncStorage.setItem('refreshToken', data.refreshToken);
      
      // Navigate to app
      navigation.navigate('Home');
    } else {
      Alert.alert('Error', data.message || 'Apple Sign-In failed');
    }
  } catch (error) {
    console.error('Apple Sign-In error:', error);
    Alert.alert('Error', 'Apple Sign-In failed');
  }
};
```

## ✅ Success Criteria

- [ ] Endpoint returns 401 for invalid token (not 404)
- [ ] Endpoint returns 400 for missing fields
- [ ] iOS app can complete Apple authentication
- [ ] Backend receives identity token
- [ ] Backend validates token successfully
- [ ] New user is created on first login
- [ ] Existing user is found on repeat login
- [ ] Response includes accessToken and refreshToken
- [ ] User profile is populated correctly
- [ ] Tokens work for authenticated requests
- [ ] Google login still works (not broken)
- [ ] Email/password login still works (not broken)

## 📊 Monitoring

### Key Metrics to Watch:
- Apple Sign-In success rate
- Token validation failures
- New user creation rate
- Account linking rate (existing email)
- Error rate by type

### Log Queries:
```bash
# Successful Apple logins
grep "AppleSignIn.*Success" logs.txt

# Failed Apple logins
grep "AppleSignIn.*FAILED" logs.txt

# New users from Apple
grep "AppleSignIn.*New user created" logs.txt

# Existing users from Apple
grep "AppleSignIn.*Existing user found" logs.txt
```

## 🎯 Final Verification

Run this complete test sequence:

1. ✅ Backend endpoint accessible
2. ✅ Returns proper error codes
3. ✅ iOS app can authenticate with Apple
4. ✅ Backend receives and validates token
5. ✅ User is created/found correctly
6. ✅ Tokens are returned and work
7. ✅ Profile data is complete
8. ✅ Subsequent logins work
9. ✅ Google login still works
10. ✅ Email login still works

If all checks pass: **🎉 Apple Sign-In is fully functional!**
