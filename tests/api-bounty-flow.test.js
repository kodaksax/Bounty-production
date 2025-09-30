// Integration test for bounty accept/complete API endpoints
const http = require('http');

// Simple HTTP request helper
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Test API health check
async function testHealthCheck() {
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/health',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.statusCode !== 200) {
      throw new Error(`Health check failed with status ${response.statusCode}`);
    }

    const body = JSON.parse(response.body);
    if (body.status !== 'ok') {
      throw new Error(`Health check returned status: ${body.status}`);
    }

    console.log('✅ API health check passed');
    return true;
  } catch (error) {
    console.error('❌ API health check failed:', error.message);
    return false;
  }
}

// Test bounty accept endpoint structure
async function testBountyAcceptEndpoint() {
  try {
    // This test checks the endpoint structure without auth
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/bounties/test-bounty-id/accept',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Should return 401 without auth token
    if (response.statusCode !== 401) {
      throw new Error(`Expected 401 unauthorized, got ${response.statusCode}`);
    }

    console.log('✅ Bounty accept endpoint requires authentication');
    return true;
  } catch (error) {
    console.error('❌ Bounty accept endpoint test failed:', error.message);
    return false;
  }
}

// Test bounty complete endpoint structure
async function testBountyCompleteEndpoint() {
  try {
    // This test checks the endpoint structure without auth
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/bounties/test-bounty-id/complete',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Should return 401 without auth token
    if (response.statusCode !== 401) {
      throw new Error(`Expected 401 unauthorized, got ${response.statusCode}`);
    }

    console.log('✅ Bounty complete endpoint requires authentication');
    return true;
  } catch (error) {
    console.error('❌ Bounty complete endpoint test failed:', error.message);
    return false;
  }
}

// Test API root endpoint
async function testRootEndpoint() {
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.statusCode !== 200) {
      throw new Error(`Root endpoint failed with status ${response.statusCode}`);
    }

    const body = JSON.parse(response.body);
    if (!body.endpoints || !body.endpoints.acceptBounty || !body.endpoints.completeBounty) {
      throw new Error('Root endpoint should list bounty accept and complete endpoints');
    }

    console.log('✅ API root endpoint includes new bounty endpoints');
    return true;
  } catch (error) {
    console.error('❌ API root endpoint test failed:', error.message);
    return false;
  }
}

// Run integration tests
async function runIntegrationTests() {
  console.log('🧪 Running API integration tests for bounty flow...\n');
  console.log('ℹ️  Note: These tests require the API server to be running on localhost:3001\n');

  let passedTests = 0;
  let totalTests = 0;

  const tests = [
    ['API health check', testHealthCheck],
    ['Root endpoint with new routes', testRootEndpoint],
    ['Bounty accept endpoint auth check', testBountyAcceptEndpoint],
    ['Bounty complete endpoint auth check', testBountyCompleteEndpoint]
  ];

  for (const [name, testFn] of tests) {
    totalTests++;
    try {
      const passed = await testFn();
      if (passed) {
        passedTests++;
      }
    } catch (error) {
      console.error(`❌ ${name}: ${error.message}`);
    }
  }

  console.log(`\n📊 Integration Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All integration tests passed!');
    process.exit(0);
  } else {
    console.log('💥 Some integration tests failed');
    console.log('ℹ️  Make sure the API server is running: cd services/api && npm run dev');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runIntegrationTests();
}

module.exports = {
  runIntegrationTests,
  testHealthCheck,
  testBountyAcceptEndpoint,
  testBountyCompleteEndpoint,
  testRootEndpoint
};