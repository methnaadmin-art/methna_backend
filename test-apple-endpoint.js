#!/usr/bin/env node

/**
 * Test Apple subscription endpoint with real product ID
 */

const https = require('https');

const API_URL = 'https://web-production-afbe4.up.railway.app';
const PRODUCT_ID = 'com.methnapp.app.premium_monthly';

// Test 1: Check if endpoint exists (should return 401 without auth)
function testEndpointExists() {
    return new Promise((resolve) => {
        const postData = JSON.stringify({
            productId: PRODUCT_ID,
            purchaseToken: 'fake_token_for_testing'
        });

        const options = {
            hostname: 'web-production-afbe4.up.railway.app',
            port: 443,
            path: '/api/v1/mobile/payments/apple/verify',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: data
                });
            });
        });

        req.on('error', (err) => {
            resolve({
                status: 0,
                error: err.message
            });
        });

        req.write(postData);
        req.end();
    });
}

// Test 2: Check plans endpoint
function testPlansEndpoint() {
    return new Promise((resolve) => {
        https.get(`${API_URL}/api/v1/mobile/plans`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: data
                });
            });
        }).on('error', (err) => {
            resolve({
                status: 0,
                error: err.message
            });
        });
    });
}

async function runTests() {
    console.log('🧪 Testing Apple Subscription Endpoints\n');
    console.log(`API URL: ${API_URL}`);
    console.log(`Product ID: ${PRODUCT_ID}\n`);
    console.log('='.repeat(70));

    // Test 1: Apple verify endpoint
    console.log('\n1️⃣  Testing POST /mobile/payments/apple/verify');
    const appleResult = await testEndpointExists();
    
    if (appleResult.status === 0) {
        console.log(`   ❌ Connection error: ${appleResult.error}`);
    } else if (appleResult.status === 401) {
        console.log(`   ✅ Endpoint exists and requires authentication (401)`);
        console.log(`   This is correct! Endpoint is ready.`);
    } else if (appleResult.status === 404) {
        console.log(`   ❌ Endpoint not found (404)`);
        console.log(`   The route is not registered or deployed.`);
    } else if (appleResult.status === 502) {
        console.log(`   ⚠️  Bad Gateway (502)`);
        console.log(`   The app is deployed but crashing or misconfigured.`);
        try {
            const parsed = JSON.parse(appleResult.body);
            console.log(`   Error:`, parsed);
        } catch {
            console.log(`   Response:`, appleResult.body.substring(0, 200));
        }
    } else {
        console.log(`   ⚠️  Status: ${appleResult.status}`);
        try {
            const parsed = JSON.parse(appleResult.body);
            console.log(`   Response:`, JSON.stringify(parsed, null, 2));
        } catch {
            console.log(`   Response:`, appleResult.body.substring(0, 200));
        }
    }

    // Test 2: Plans endpoint
    console.log('\n2️⃣  Testing GET /mobile/plans');
    const plansResult = await testPlansEndpoint();
    
    if (plansResult.status === 0) {
        console.log(`   ❌ Connection error: ${plansResult.error}`);
    } else if (plansResult.status === 200) {
        console.log(`   ✅ Plans endpoint working (200)`);
        try {
            const parsed = JSON.parse(plansResult.body);
            const plans = Array.isArray(parsed) ? parsed : (parsed.data || []);
            console.log(`   Found ${plans.length} plans:`);
            plans.forEach(plan => {
                console.log(`     - ${plan.name} (${plan.code})`);
                if (plan.appleProductId) {
                    console.log(`       Apple Product ID: ${plan.appleProductId}`);
                }
                if (plan.googleProductId) {
                    console.log(`       Google Product ID: ${plan.googleProductId}`);
                }
            });
            
            // Check if our product ID is configured
            const hasAppleProduct = plans.some(p => p.appleProductId === PRODUCT_ID);
            if (hasAppleProduct) {
                console.log(`\n   ✅ Product ID '${PRODUCT_ID}' is configured!`);
            } else {
                console.log(`\n   ⚠️  Product ID '${PRODUCT_ID}' not found in plans`);
                console.log(`   You may need to update the plan in the database.`);
            }
        } catch (err) {
            console.log(`   ⚠️  Could not parse response:`, plansResult.body.substring(0, 200));
        }
    } else if (plansResult.status === 404) {
        console.log(`   ❌ Endpoint not found (404)`);
    } else if (plansResult.status === 502) {
        console.log(`   ⚠️  Bad Gateway (502)`);
        console.log(`   The app is deployed but crashing.`);
    } else {
        console.log(`   ⚠️  Status: ${plansResult.status}`);
        console.log(`   Response:`, plansResult.body.substring(0, 200));
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY\n');
    
    const appleReady = appleResult.status === 401;
    const plansReady = plansResult.status === 200;
    
    if (appleReady && plansReady) {
        console.log('✅ ALL SYSTEMS READY!');
        console.log('\nYou can now test from iOS app:');
        console.log('  1. Login with: chialinouad222@icloud.com');
        console.log('  2. Navigate to subscription screen');
        console.log(`  3. Purchase: ${PRODUCT_ID}`);
        console.log('  4. Complete sandbox purchase');
        console.log('  5. Backend will verify and activate subscription');
    } else {
        console.log('❌ NOT READY\n');
        if (!appleReady) {
            console.log('⚠️  Apple verify endpoint not ready');
        }
        if (!plansReady) {
            console.log('⚠️  Plans endpoint not ready');
        }
        console.log('\nCheck Railway logs for errors.');
    }
    
    console.log('\n');
}

runTests().catch(console.error);
