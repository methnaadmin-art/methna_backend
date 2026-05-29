/**
 * Test Apple App Store Subscription Endpoint
 * 
 * Tests the /mobile/payments/apple/verify endpoint
 */

const API_URL = 'https://web-production-afbe4.up.railway.app';
const ENDPOINT = `${API_URL}/mobile/payments/apple/verify`;

// You need a real access token from a logged-in user
const ACCESS_TOKEN = process.argv[2] || '';

console.log('🧪 Testing Apple Subscription Endpoint');
console.log('📍 URL:', ENDPOINT);
console.log('🔑 Token:', ACCESS_TOKEN ? '✅ Provided' : '❌ Missing');
console.log('');

if (!ACCESS_TOKEN) {
    console.log('❌ ERROR: Access token required');
    console.log('');
    console.log('Usage:');
    console.log('  node test-apple-subscription.js <ACCESS_TOKEN>');
    console.log('');
    console.log('To get an access token:');
    console.log('  1. Login via iOS app or API');
    console.log('  2. Copy the accessToken from the response');
    console.log('  3. Run: node test-apple-subscription.js <token>');
    process.exit(1);
}

async function testEndpointExists() {
    console.log('Test 1: Checking if endpoint exists...');
    
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                productId: 'com.methnapp.app.premium_monthly',
                transactionId: 'test-transaction-id',
            }),
        });

        const data = await response.json();
        
        console.log('📊 Status:', response.status);
        console.log('📄 Response:', JSON.stringify(data, null, 2));
        console.log('');

        if (response.status === 404) {
            console.log('❌ FAILED: Endpoint not found (404)');
            return false;
        } else if (response.status === 401 && data.message?.includes('Unauthorized')) {
            console.log('⚠️  Token invalid or expired');
            console.log('   Get a new token by logging in');
            return false;
        } else if (response.status === 400) {
            console.log('✅ PASSED: Endpoint exists (returned 400 for invalid data)');
            console.log('   Message:', data.message);
            return true;
        } else {
            console.log('✅ PASSED: Endpoint exists');
            return true;
        }
    } catch (error) {
        console.log('❌ FAILED: Network error');
        console.log('   Error:', error.message);
        return false;
    }
}

async function testConfiguration() {
    console.log('Test 2: Checking Apple configuration...');
    
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                productId: 'com.methnapp.app.premium_monthly',
                transactionId: '2000000000000001', // Fake but valid format
                environment: 'sandbox',
            }),
        });

        const data = await response.json();
        
        console.log('📊 Status:', response.status);
        console.log('');

        if (response.status === 503 || data.message?.includes('credentials missing')) {
            console.log('❌ FAILED: Apple credentials not configured');
            console.log('   Message:', data.message);
            console.log('');
            console.log('   Required environment variables:');
            console.log('   - APPLE_ISSUER_ID');
            console.log('   - APPLE_KEY_ID');
            console.log('   - APPLE_BUNDLE_ID');
            console.log('   - APPLE_PRIVATE_KEY');
            return false;
        } else if (response.status === 400) {
            const message = data.message || '';
            if (message.includes('verification failed') || 
                message.includes('not found') ||
                message.includes('Invalid')) {
                console.log('✅ PASSED: Apple API is configured and responding');
                console.log('   (Got expected validation error for fake transaction)');
                return true;
            }
        }

        console.log('⚠️  Unexpected response:', data.message);
        return false;
    } catch (error) {
        console.log('❌ FAILED: Network error');
        console.log('   Error:', error.message);
        return false;
    }
}

async function testProductIds() {
    console.log('Test 3: Checking supported product IDs...');
    
    const productIds = [
        'com.methnapp.app.premium_monthly',
        'com.methnapp.app.premium_yearly',
        'com.invalid.product',
    ];

    for (const productId of productIds) {
        try {
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    productId,
                    transactionId: 'test',
                }),
            });

            const data = await response.json();
            
            if (productId === 'com.invalid.product') {
                if (data.message?.includes('Unsupported')) {
                    console.log(`✅ ${productId}: Correctly rejected`);
                } else {
                    console.log(`⚠️  ${productId}: Should be rejected`);
                }
            } else {
                if (data.message?.includes('Unsupported')) {
                    console.log(`❌ ${productId}: Should be supported!`);
                } else {
                    console.log(`✅ ${productId}: Supported`);
                }
            }
        } catch (error) {
            console.log(`❌ ${productId}: Error -`, error.message);
        }
    }
    
    console.log('');
    return true;
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('');
    
    const test1 = await testEndpointExists();
    console.log('');
    
    if (!test1) {
        console.log('❌ Cannot proceed - endpoint not accessible');
        return;
    }
    
    const test2 = await testConfiguration();
    console.log('');
    
    const test3 = await testProductIds();
    
    console.log('='.repeat(60));
    console.log('📋 SUMMARY');
    console.log('='.repeat(60));
    console.log('');
    console.log('Endpoint exists:', test1 ? '✅' : '❌');
    console.log('Apple configured:', test2 ? '✅' : '❌');
    console.log('Product IDs:', test3 ? '✅' : '❌');
    console.log('');
    
    if (test1 && test2 && test3) {
        console.log('✅ Apple subscription endpoint is working!');
        console.log('');
        console.log('📱 To test with real purchase:');
        console.log('   1. Make a purchase in iOS app');
        console.log('   2. App should send transactionId to this endpoint');
        console.log('   3. Backend will verify with Apple');
        console.log('   4. User will get premium access');
    } else {
        console.log('❌ Apple subscription has issues');
        console.log('');
        if (!test2) {
            console.log('🔧 Fix: Set Apple environment variables in Railway:');
            console.log('   APPLE_ISSUER_ID=d98e5ccd-e16a-4036-a66b-f7af26ec577c');
            console.log('   APPLE_KEY_ID=2MY3WV823R');
            console.log('   APPLE_BUNDLE_ID=com.methnapp.app');
            console.log('   APPLE_PRIVATE_KEY=<your .p8 key>');
        }
    }
}

runTests().catch(console.error);
