/**
 * Test script for Apple Sign-In endpoint
 * 
 * Usage:
 *   node test-apple-endpoint.js <API_URL>
 * 
 * Example:
 *   node test-apple-endpoint.js https://your-api.railway.app
 *   node test-apple-endpoint.js http://localhost:3000
 */

const API_URL = process.argv[2] || 'http://localhost:3000';
const ENDPOINT = `${API_URL}/api/v1/auth/apple`;

console.log('🧪 Testing Apple Sign-In Endpoint');
console.log('📍 URL:', ENDPOINT);
console.log('');

// Test 1: Endpoint exists (should return 401, not 404)
async function testEndpointExists() {
    console.log('Test 1: Checking if endpoint exists...');
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                identityToken: 'invalid-token-for-testing'
            }),
        });

        const data = await response.json();
        
        if (response.status === 404) {
            console.log('❌ FAILED: Endpoint not found (404)');
            console.log('   The endpoint is not deployed or API prefix is wrong');
            return false;
        } else if (response.status === 401) {
            console.log('✅ PASSED: Endpoint exists (returned 401 for invalid token)');
            console.log('   Message:', data.message);
            return true;
        } else if (response.status === 400) {
            console.log('✅ PASSED: Endpoint exists (returned 400 for bad request)');
            console.log('   Message:', data.message);
            return true;
        } else {
            console.log('⚠️  UNEXPECTED: Status', response.status);
            console.log('   Response:', data);
            return true; // Endpoint exists but unexpected response
        }
    } catch (error) {
        console.log('❌ FAILED: Network error');
        console.log('   Error:', error.message);
        return false;
    }
}

// Test 2: Endpoint validates required fields
async function testValidation() {
    console.log('\nTest 2: Checking field validation...');
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}), // Empty body
        });

        const data = await response.json();
        
        if (response.status === 400) {
            console.log('✅ PASSED: Validation works (returned 400 for missing fields)');
            console.log('   Message:', data.message);
            return true;
        } else {
            console.log('⚠️  UNEXPECTED: Status', response.status);
            console.log('   Response:', data);
            return false;
        }
    } catch (error) {
        console.log('❌ FAILED: Network error');
        console.log('   Error:', error.message);
        return false;
    }
}

// Test 3: Check other auth endpoints for comparison
async function testGoogleEndpoint() {
    console.log('\nTest 3: Checking Google endpoint for comparison...');
    try {
        const response = await fetch(`${API_URL}/api/v1/auth/google`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                idToken: 'invalid-token'
            }),
        });

        const data = await response.json();
        
        if (response.status === 404) {
            console.log('⚠️  Google endpoint also not found - API prefix might be wrong');
            return false;
        } else {
            console.log('✅ Google endpoint exists (status:', response.status + ')');
            return true;
        }
    } catch (error) {
        console.log('⚠️  Could not test Google endpoint:', error.message);
        return false;
    }
}

// Run all tests
async function runTests() {
    const test1 = await testEndpointExists();
    const test2 = await testValidation();
    const test3 = await testGoogleEndpoint();

    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Summary');
    console.log('='.repeat(50));
    console.log('Endpoint exists:', test1 ? '✅' : '❌');
    console.log('Validation works:', test2 ? '✅' : '❌');
    console.log('Google endpoint:', test3 ? '✅' : '❌');
    console.log('');

    if (test1 && test2) {
        console.log('✅ Apple Sign-In endpoint is working correctly!');
        console.log('');
        console.log('Next steps:');
        console.log('1. Test with real Apple identity token from iOS');
        console.log('2. Verify user creation/login flow');
        console.log('3. Check token response format');
    } else if (!test1) {
        console.log('❌ Apple Sign-In endpoint is NOT deployed');
        console.log('');
        console.log('Fix steps:');
        console.log('1. Run: npm run build');
        console.log('2. Deploy the latest code to production');
        console.log('3. Verify API_PREFIX environment variable is set to "api/v1"');
        console.log('4. Check server logs for startup errors');
    }
}

runTests().catch(console.error);
