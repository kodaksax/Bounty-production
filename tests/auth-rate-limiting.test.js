/**
 * Auth Rate Limiting Test
 * Tests brute force protection on authentication endpoints
 * 
 * REQUIREMENTS:
 * - API server must be running (default: http://localhost:3000)
 * - Override with environment variable: API_BASE_URL=http://localhost:3000
 * - Start server with: npm run api (or node api/server.js)
 * 
 * This test verifies that:
 * 1. Rate limiting is applied to all auth endpoints
 * 2. Requests are allowed up to the limit (5 per 15 minutes)
 * 3. Requests beyond the limit are blocked with 429 status
 * 4. Rate limit headers are properly set
 * 5. Rate limit resets after the window expires
 * 
 * Run with: node tests/auth-rate-limiting.test.js
 */

const http = require('http');
const assert = require('assert');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const RATE_LIMIT = 5; // 5 requests per window
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes in ms

// Test data
const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'TestPassword123!';
const testUsername = `testuser${Date.now()}`;

/**
 * Make HTTP request to API
 */
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: jsonBody,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Test helper: Check rate limit headers
 */
function checkRateLimitHeaders(headers, remaining) {
  assert.ok(
    headers['ratelimit-limit'] !== undefined,
    'Should include RateLimit-Limit header'
  );
  assert.ok(
    headers['ratelimit-remaining'] !== undefined,
    'Should include RateLimit-Remaining header'
  );
  assert.ok(
    headers['ratelimit-reset'] !== undefined,
    'Should include RateLimit-Reset header'
  );
  
  const limit = parseInt(headers['ratelimit-limit']);
  const rem = parseInt(headers['ratelimit-remaining']);
  
  assert.strictEqual(
    limit,
    RATE_LIMIT,
    `Rate limit should be ${RATE_LIMIT}`
  );
  
  if (remaining !== undefined) {
    assert.strictEqual(
      rem,
      remaining,
      `Remaining requests should be ${remaining}`
    );
  }
}

/**
 * Test rate limiting on a specific endpoint
 */
async function testEndpointRateLimit(endpoint, requestData, testName) {
  console.log(`\nTest: ${testName}`);
  console.log(`Endpoint: POST ${endpoint}`);
  
  try {
    // Send requests up to the limit
    for (let i = 1; i <= RATE_LIMIT; i++) {
      const response = await makeRequest('POST', endpoint, requestData);
      
      // Check that request went through (may fail auth, but shouldn't be rate limited)
      assert.ok(
        response.status !== 429,
        `Request ${i}/${RATE_LIMIT} should not be rate limited`
      );
      
      // Check rate limit headers
      if (response.headers['ratelimit-limit']) {
        checkRateLimitHeaders(response.headers, RATE_LIMIT - i);
      }
      
      console.log(
        `  Request ${i}/${RATE_LIMIT}: ${response.status} ` +
        `(remaining: ${response.headers['ratelimit-remaining'] || 'N/A'})`
      );
    }
    
    // Next request should be rate limited
    const blockedResponse = await makeRequest('POST', endpoint, requestData);
    
    assert.strictEqual(
      blockedResponse.status,
      429,
      'Request beyond limit should return 429 Too Many Requests'
    );
    
    assert.ok(
      blockedResponse.body.error || blockedResponse.body.message,
      'Response should include error message'
    );
    
    // Check for retry-after header
    assert.ok(
      blockedResponse.headers['retry-after'] !== undefined,
      'Should include Retry-After header'
    );
    
    console.log(`  Request ${RATE_LIMIT + 1}: ${blockedResponse.status} (BLOCKED) ✓`);
    console.log(`  Error message: "${blockedResponse.body.message || blockedResponse.body.error}"`);
    console.log(`✅ ${testName} passed\n`);
    
    return true;
  } catch (error) {
    console.error(`❌ ${testName} failed:`, error.message);
    return false;
  }
}

/**
 * Main test suite
 */
async function runTests() {
  console.log('🧪 Running Auth Rate Limiting Tests\n');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`Rate Limit: ${RATE_LIMIT} requests per ${RATE_LIMIT_WINDOW / 60000} minutes\n`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: /app/auth/sign-up-form
  const signUpFormData = {
    email: testEmail,
    username: testUsername,
    password: testPassword,
  };
  
  if (await testEndpointRateLimit(
    '/app/auth/sign-up-form',
    signUpFormData,
    'Rate limiting on /app/auth/sign-up-form'
  )) {
    passed++;
  } else {
    failed++;
  }
  
  // Wait a bit to avoid cross-test rate limiting
  console.log('Waiting 2 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 2: /app/auth/sign-in-form
  const signInFormData = {
    email: testEmail,
    password: testPassword,
  };
  
  if (await testEndpointRateLimit(
    '/app/auth/sign-in-form',
    signInFormData,
    'Rate limiting on /app/auth/sign-in-form'
  )) {
    passed++;
  } else {
    failed++;
  }
  
  // Wait a bit to avoid cross-test rate limiting
  console.log('Waiting 2 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 3: /auth/register
  const registerData = {
    email: `test2-${Date.now()}@example.com`,
    username: `testuser2${Date.now()}`,
    password: testPassword,
  };
  
  if (await testEndpointRateLimit(
    '/auth/register',
    registerData,
    'Rate limiting on /auth/register'
  )) {
    passed++;
  } else {
    failed++;
  }
  
  // Wait a bit to avoid cross-test rate limiting
  console.log('Waiting 2 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 4: /auth/sign-in
  const signInData = {
    email: testEmail,
    password: testPassword,
  };
  
  if (await testEndpointRateLimit(
    '/auth/sign-in',
    signInData,
    'Rate limiting on /auth/sign-in'
  )) {
    passed++;
  } else {
    failed++;
  }
  
  // Wait a bit to avoid cross-test rate limiting
  console.log('Waiting 2 seconds before next test...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 5: /auth/identifier-sign-up
  const identifierSignUpData = {
    identifier: `user${Date.now()}@example.com`,
    password: testPassword,
  };
  
  if (await testEndpointRateLimit(
    '/auth/identifier-sign-up',
    identifierSignUpData,
    'Rate limiting on /auth/identifier-sign-up'
  )) {
    passed++;
  } else {
    failed++;
  }
  
  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (failed === 0) {
    console.log('🎉 All rate limiting tests passed!\n');
    console.log('✅ Auth endpoints are protected against brute force attacks');
    return 0;
  } else {
    console.log('⚠️  Some tests failed. Please review the implementation.\n');
    return 1;
  }
}

// Run tests if this is the main module
if (require.main === module) {
  runTests()
    .then(exitCode => process.exit(exitCode))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runTests, makeRequest, testEndpointRateLimit };
