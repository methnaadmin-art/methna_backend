#!/usr/bin/env node

/**
 * Wait for Railway deployment to complete
 * Polls the Apple subscription endpoint until it returns 401 (deployed) instead of 404
 */

const https = require('https');

const API_URL = 'https://web-production-afbe4.up.railway.app';
const CHECK_INTERVAL = 15000; // 15 seconds
const MAX_ATTEMPTS = 40; // 10 minutes total

let attempts = 0;

function checkEndpoint() {
    return new Promise((resolve) => {
        const url = `${API_URL}/mobile/payments/apple/verify`;
        
        https.get(url, (res) => {
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

async function waitForDeployment() {
    console.log('🚀 Waiting for Railway deployment to complete...\n');
    console.log(`Checking: ${API_URL}/mobile/payments/apple/verify`);
    console.log(`Interval: ${CHECK_INTERVAL / 1000}s | Max time: ${(MAX_ATTEMPTS * CHECK_INTERVAL) / 60000} minutes\n`);
    
    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        const elapsed = Math.floor((attempts * CHECK_INTERVAL) / 1000);
        
        process.stdout.write(`\r[${attempts}/${MAX_ATTEMPTS}] Checking... (${elapsed}s elapsed)`);
        
        const result = await checkEndpoint();
        
        if (result.status === 401) {
            console.log('\n\n✅ DEPLOYMENT COMPLETE!');
            console.log('Endpoint is now live and returning 401 (authentication required)');
            console.log('\n🎉 Apple subscription endpoints are ready!');
            console.log('\nRun verification:');
            console.log('  node check-apple-subscription-config.js');
            console.log('\nTest from iOS app with:');
            console.log('  - Account: chialinouad222@icloud.com');
            console.log('  - Product: com.methnapp.app.premium_monthly');
            return true;
        } else if (result.status === 404) {
            // Still not deployed, continue waiting
        } else if (result.status === 0) {
            console.log(`\n\n⚠️  Connection error: ${result.error}`);
            console.log('Retrying...');
        } else {
            console.log(`\n\n⚠️  Unexpected status: ${result.status}`);
            console.log('Response:', result.body.substring(0, 200));
        }
        
        if (attempts < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
        }
    }
    
    console.log('\n\n⏱️  Timeout reached');
    console.log('Deployment is taking longer than expected.');
    console.log('\nNext steps:');
    console.log('1. Check Railway dashboard for deployment status');
    console.log('2. Look for build errors in Railway logs');
    console.log('3. Manually trigger redeploy if needed');
    console.log('4. Run: node check-apple-subscription-config.js');
    
    return false;
}

waitForDeployment().then(success => {
    process.exit(success ? 0 : 1);
});
