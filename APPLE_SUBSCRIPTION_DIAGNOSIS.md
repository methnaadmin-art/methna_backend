# Apple Subscription Diagnosis & Fix

## 🔍 Current Status

**Apple Sign-In:** ✅ Working  
**Apple Subscriptions:** ⚠️ Needs Investigation

---

## 📋 Apple Subscription Implementation

### Endpoint
```
POST /mobile/payments/apple/verify
```

### Supported Products
- `com.methnapp.app.premium_monthly`
- `com.methnapp.app.premium_yearly`

### Request Format
```json
{
  "productId": "com.methnapp.app.premium_monthly",
  "transactionId": "<from iOS StoreKit>",
  "originalTransactionId": "<from iOS StoreKit>",
  "environment": "sandbox" | "production" | "auto"
}
```

### Response Format (Success)
```json
{
  "status": "verified",
  "provider": "apple",
  "platform": "ios",
  "environment": "production",
  "plan": { ... },
  "subscription": { ... },
  "entitlements": { ... }
}
```

---

## 🔧 Required Configuration

### Environment Variables (Production)

**Critical - Must be set in Railway:**

```bash
# Apple App Store Server API (for subscription verification)
APPLE_ISSUER_ID=d98e5ccd-e16a-4036-a66b-f7af26ec577c
APPLE_KEY_ID=2MY3WV823R
APPLE_BUNDLE_ID=com.methnapp.app
APPLE_APP_APPLE_ID=6774157582
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgYKz9PH+QnoBTBFBw
j9nKJA45r9IIpxtQMF0tTT7s4v6gCgYIKoZIzj0DAQehRANCAARwJ6F4NBInnmoZ
qJ4gtWe/JKRuwELbEp4zMLdFT2ikkVjuZMdL265ewDemOhQt0EqWxitpWBlXthbh
vyR4luZv
-----END PRIVATE KEY-----"
APPLE_APP_STORE_ENVIRONMENT=auto

# Optional - for legacy receipt verification
APPLE_SHARED_SECRET=<your-shared-secret>
```

**Note:** The `APPLE_PRIVATE_KEY` is your **App Store Connect API Key** (.p8 file), NOT the same as Apple Sign-In credentials.

---

## 🚨 Common Issues & Solutions

### Issue 1: "Apple App Store Server API credentials missing"

**Symptom:**
```json
{
  "statusCode": 503,
  "message": "Apple App Store Server API credentials missing"
}
```

**Cause:** Missing or incomplete environment variables

**Fix:**
1. Go to Railway dashboard → Variables
2. Add all required variables listed above
3. Restart the service
4. Test again

---

### Issue 2: "Invalid Apple private key format"

**Symptom:**
```json
{
  "statusCode": 400,
  "message": "Invalid Apple private key format"
}
```

**Cause:** `APPLE_PRIVATE_KEY` not in correct PEM format

**Fix:**
1. Ensure key starts with `-----BEGIN PRIVATE KEY-----`
2. Ensure key ends with `-----END PRIVATE KEY-----`
3. Use `\n` for newlines in environment variable
4. Or wrap entire key in quotes with actual newlines

**Correct format:**
```bash
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgYKz9PH+QnoBTBFBw
j9nKJA45r9IIpxtQMF0tTT7s4v6gCgYIKoZIzj0DAQehRANCAARwJ6F4NBInnmoZ
qJ4gtWe/JKRuwELbEp4zMLdFT2ikkVjuZMdL265ewDemOhQt0EqWxitpWBlXthbh
vyR4luZv
-----END PRIVATE KEY-----"
```

---

### Issue 3: "Apple transaction not found"

**Symptom:**
```json
{
  "statusCode": 404,
  "message": "Apple could not find this transaction"
}
```

**Cause:** 
- Transaction ID is invalid
- Wrong environment (sandbox vs production)
- Transaction doesn't exist in Apple's system

**Fix:**
1. Verify transaction ID is correct
2. Set `environment: "auto"` to try both sandbox and production
3. Ensure purchase was completed in iOS
4. Check Apple App Store Connect for transaction

---

### Issue 4: "Apple subscription is already linked to another account"

**Symptom:**
```json
{
  "statusCode": 400,
  "message": "This Apple subscription is already linked to another account"
}
```

**Cause:** User trying to use same subscription on multiple accounts

**Fix:**
- This is intentional security - one subscription per account
- User must use the original account
- Or cancel and repurchase on new account

---

### Issue 5: "Apple subscription is expired"

**Symptom:**
```json
{
  "statusCode": 400,
  "message": "Apple subscription is expired"
}
```

**Cause:** Subscription has passed expiry date

**Fix:**
- User needs to renew subscription in iOS
- Check if auto-renewal is enabled
- Verify payment method is valid

---

### Issue 6: "Unsupported Apple productId"

**Symptom:**
```json
{
  "statusCode": 400,
  "message": "Unsupported Apple productId 'com.example.product'"
}
```

**Cause:** Product ID not in allowed list

**Fix:**
1. Check product ID matches exactly:
   - `com.methnapp.app.premium_monthly`
   - `com.methnapp.app.premium_yearly`
2. Update iOS app to use correct product IDs
3. Or add new product ID to backend allowed list

---

## 🧪 Testing Steps

### Step 1: Check Environment Variables

```bash
# In Railway dashboard, verify these are set:
APPLE_ISSUER_ID
APPLE_KEY_ID
APPLE_BUNDLE_ID
APPLE_PRIVATE_KEY
```

### Step 2: Test Endpoint Exists

```bash
# Should return 401 (not 404)
curl -X POST https://web-production-afbe4.up.railway.app/mobile/payments/apple/verify \
  -H "Content-Type: application/json" \
  -d '{"productId":"com.methnapp.app.premium_monthly"}'
```

### Step 3: Test with Access Token

```bash
# Get access token by logging in first
# Then test:
curl -X POST https://web-production-afbe4.up.railway.app/mobile/payments/apple/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{
    "productId": "com.methnapp.app.premium_monthly",
    "transactionId": "test"
  }'
```

### Step 4: Test from iOS

1. **Make test purchase in iOS app (sandbox)**
2. **App should call:**
   ```typescript
   POST /mobile/payments/apple/verify
   Headers: {
     Authorization: Bearer <accessToken>
     Content-Type: application/json
   }
   Body: {
     productId: "com.methnapp.app.premium_monthly",
     transactionId: transaction.transactionIdentifier,
     originalTransactionId: transaction.originalTransactionIdentifier,
     environment: "sandbox"
   }
   ```
3. **Backend should:**
   - Verify transaction with Apple
   - Create subscription record
   - Grant premium access
   - Return subscription details

### Step 5: Verify Premium Access

```bash
# Check user has premium
GET /mobile/subscription/me
Headers: {
  Authorization: Bearer <accessToken>
}

# Should return:
{
  "isPremium": true,
  "plan": "premium",
  "appleProductId": "com.methnapp.app.premium_monthly",
  "appleTransactionId": "...",
  "endDate": "2024-12-31T23:59:59.000Z"
}
```

---

## 📱 iOS App Requirements

### StoreKit 2 Implementation

```swift
import StoreKit

// 1. Purchase product
let product = try await Product.products(for: ["com.methnapp.app.premium_monthly"]).first
let result = try await product?.purchase()

// 2. Get transaction
if case .success(let verification) = result {
    let transaction = try verification.payloadValue
    
    // 3. Send to backend
    let response = await verifyWithBackend(
        productId: transaction.productID,
        transactionId: String(transaction.id),
        originalTransactionId: String(transaction.originalID)
    )
    
    // 4. Finish transaction
    await transaction.finish()
}
```

### Backend Verification Call

```swift
func verifyWithBackend(
    productId: String,
    transactionId: String,
    originalTransactionId: String
) async throws -> SubscriptionResponse {
    let url = URL(string: "https://web-production-afbe4.up.railway.app/mobile/payments/apple/verify")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    
    let body: [String: Any] = [
        "productId": productId,
        "transactionId": transactionId,
        "originalTransactionId": originalTransactionId,
        "environment": "sandbox" // or "production"
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    
    let (data, response) = try await URLSession.shared.data(for: request)
    
    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw SubscriptionError.verificationFailed
    }
    
    return try JSONDecoder().decode(SubscriptionResponse.self, from: data)
}
```

---

## 🔍 Debugging Checklist

### Backend Logs to Check

```bash
# Railway logs
railway logs

# Look for:
[PAYMENT] Apple verify called user=<userId> productId=<productId>
[PAYMENT] Apple token received user=<userId> productId=<productId>
[PAYMENT] Apple premium activated user=<userId> productId=<productId>

# Or errors:
[PAYMENT] Apple verification failed: <error>
```

### Database Verification

```sql
-- Check subscriptions
SELECT 
  id,
  "userId",
  plan,
  status,
  "appleProductId",
  "appleTransactionId",
  "appleOriginalTransactionId",
  "appleEnvironment",
  "startDate",
  "endDate"
FROM subscriptions
WHERE "appleTransactionId" IS NOT NULL
ORDER BY "createdAt" DESC
LIMIT 10;

-- Check purchase transactions
SELECT 
  id,
  "userId",
  provider,
  "productId",
  status,
  "purchaseToken",
  "transactionDate",
  "expiryDate"
FROM purchase_transactions
WHERE provider = 'apple'
ORDER BY "createdAt" DESC
LIMIT 10;
```

---

## ✅ Success Criteria

After fixing:

- [ ] Environment variables set in Railway
- [ ] Endpoint returns 401 (not 404) without auth
- [ ] Endpoint returns 400 (not 503) with invalid transaction
- [ ] iOS can make test purchase in sandbox
- [ ] Backend verifies transaction with Apple
- [ ] Subscription record created in database
- [ ] User gets premium access
- [ ] `/mobile/subscription/me` shows premium status
- [ ] Premium features unlocked in app

---

## 🚀 Quick Fix Steps

1. **Set Environment Variables in Railway:**
   ```bash
   APPLE_ISSUER_ID=d98e5ccd-e16a-4036-a66b-f7af26ec577c
   APPLE_KEY_ID=2MY3WV823R
   APPLE_BUNDLE_ID=com.methnapp.app
   APPLE_PRIVATE_KEY=<your .p8 key>
   ```

2. **Restart Railway Service**

3. **Test Endpoint:**
   ```bash
   curl https://web-production-afbe4.up.railway.app/mobile/payments/apple/verify
   # Should return 401, not 404
   ```

4. **Test from iOS:**
   - Make sandbox purchase
   - App sends transaction to backend
   - Check logs for success

5. **Verify Premium Access:**
   - Check `/mobile/subscription/me`
   - Should show `isPremium: true`

---

## 📞 Need Help?

**Check logs:**
```bash
railway logs --tail
```

**Test endpoint:**
```bash
node test-apple-subscription.js <ACCESS_TOKEN>
```

**Common issues:**
- Missing environment variables → Set in Railway
- Wrong private key format → Check PEM format
- Transaction not found → Verify environment (sandbox/production)
- Already linked → One subscription per account

---

**Next Step:** Set environment variables in Railway and test!
