/**
 * Check Apple Subscription Configuration
 * 
 * This script checks if the Apple subscription endpoint is properly configured
 */

const API_URL = 'https://web-production-afbe4.up.railway.app';

console.log('🔍 Checking Apple Subscription Configuration');
console.log('📍 API URL:', API_URL);
console.log('');

async function checkEndpointExists() {
    console.log('1️⃣  Checking if endpoint exists...');
    
    try {
        const response = await fetch(`${API_URL}/mobile/payments/apple/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                productId: 'com.methnapp.app.premium_monthly'
            }),
        });

        const data = await response.json();
        
        if (response.status === 404) {
            console.log('   ❌ Endpoint NOT FOUND (404)');
            console.log('   The endpoint is not deployed');
            return { exists: false, configured: false };
        } else if (response.status === 401) {
            console.log('   ✅ Endpoint EXISTS (requires authentication)');
            return { exists: true, configured: null };
        } else {
            console.log('   ✅ Endpoint EXISTS');
            console.log('   Status:', response.status);
            return { exists: true, configured: null };
        }
    } catch (error) {
        console.log('   ❌ Network error:', error.message);
        return { exists: false, configured: false };
    }
}

async function checkConfiguration() {
    console.log('');
    console.log('2️⃣  Checking Apple configuration...');
    console.log('   (Testing with fake transaction to see error type)');
    
    try {
        // Create a fake but properly formatted request
        const response = await fetch(`${API_URL}/mobile/payments/apple/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // No auth token - will fail with 401, but we can see if config is missing
            },
            body: JSON.stringify({
                productId: 'com.methnapp.app.premium_monthly',
                transactionId: '2000000000000001',
                environment: 'sandbox'
            }),
        });

        const data = await response.json();
        
        console.log('   Status:', response.status);
        console.log('   Message:', data.message || data.error);
        console.log('');

        if (response.status === 401 && data.message?.includes('Unauthorized')) {
            console.log('   ✅ Configuration appears OK (needs authentication)');
            return true;
        } else if (response.status === 503 || data.message?.includes('credentials missing')) {
            console.log('   ❌ Apple credentials NOT CONFIGURED');
            console.log('');
            console.log('   Missing environment variables:');
            console.log('   - APPLE_ISSUER_ID');
            console.log('   - APPLE_KEY_ID');
            console.log('   - APPLE_BUNDLE_ID');
            console.log('   - APPLE_PRIVATE_KEY');
            return false;
        } else if (response.status === 400) {
            console.log('   ✅ Configuration appears OK (validation error expected)');
            return true;
        } else {
            console.log('   ⚠️  Unexpected response');
            return null;
        }
    } catch (error) {
        console.log('   ❌ Network error:', error.message);
        return false;
    }
}

async function checkPlansEndpoint() {
    console.log('');
    console.log('3️⃣  Checking mobile plans endpoint...');
    
    try {
        const response = await fetch(`${API_URL}/mobile/plans`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();
        
        if (response.status === 200 && Array.isArray(data)) {
            console.log('   ✅ Plans endpoint working');
            
            const applePlans = data.filter(plan => plan.appleProductId);
            console.log('   Found', applePlans.length, 'Apple plans:');
            
            applePlans.forEach(plan => {
                console.log(`     - ${plan.name}: ${plan.appleProductId}`);
            });
            
            return applePlans.length > 0;
        } else {
            console.log('   ⚠️  Plans endpoint returned:', response.status);
            return false;
        }
    } catch (error) {
        console.log('   ❌ Network error:', error.message);
        return false;
    }
}

async function runChecks() {
    console.log('='.repeat(70));
    console.log('');
    
    const endpointCheck = await checkEndpointExists();
    const configCheck = await checkConfiguration();
    const plansCheck = await checkPlansEndpoint();
    
    console.log('');
    console.log('='.repeat(70));
    console.log('📊 RESULTS');
    console.log('='.repeat(70));
    console.log('');
    console.log('Endpoint deployed:', endpointCheck.exists ? '✅ YES' : '❌ NO');
    console.log('Apple configured:', configCheck ? '✅ YES' : configCheck === false ? '❌ NO' : '⚠️  UNKNOWN');
    console.log('Plans configured:', plansCheck ? '✅ YES' : '❌ NO');
    console.log('');
    
    if (endpointCheck.exists && configCheck && plansCheck) {
        console.log('✅ READY: Apple subscriptions should work!');
        console.log('');
        console.log('📱 Next steps:');
        console.log('   1. Test purchase in iOS app (sandbox)');
        console.log('   2. App should call /mobile/payments/apple/verify');
        console.log('   3. User should get premium access');
        console.log('');
    } else {
        console.log('❌ NOT READY: Issues found');
        console.log('');
        
        if (!endpointCheck.exists) {
            console.log('🔧 Fix: Deploy the latest code');
            console.log('   git push origin main');
            console.log('');
        }
        
        if (configCheck === false) {
            console.log('🔧 Fix: Set environment variables in Railway:');
            console.log('');
            console.log('   APPLE_ISSUER_ID=d98e5ccd-e16a-4036-a66b-f7af26ec577c');
            console.log('   APPLE_KEY_ID=2MY3WV823R');
            console.log('   APPLE_BUNDLE_ID=com.methnapp.app');
            console.log('   APPLE_APP_APPLE_ID=6774157582');
            console.log('   APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----');
            console.log('   MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgYKz9PH+QnoBTBFBw');
            console.log('   j9nKJA45r9IIpxtQMF0tTT7s4v6gCgYIKoZIzj0DAQehRANCAARwJ6F4NBInnmoZ');
            console.log('   qJ4gtWe/JKRuwELbEp4zMLdFT2ikkVjuZMdL265ewDemOhQt0EqWxitpWBlXthbh');
            console.log('   vyR4luZv');
            console.log('   -----END PRIVATE KEY-----"');
            console.log('   APPLE_APP_STORE_ENVIRONMENT=auto');
            console.log('');
        }
        
        if (!plansCheck) {
            console.log('🔧 Fix: Configure Apple product IDs in plans');
            console.log('   Update plans in database with appleProductId');
            console.log('');
        }
    }
    
    console.log('📚 Documentation: APPLE_SUBSCRIPTION_DIAGNOSIS.md');
    console.log('');
}

runChecks().catch(console.error);
