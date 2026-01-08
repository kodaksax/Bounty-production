/**
 * Test script for Redis-backed rate limiting on auth endpoints
 * 
 * This script tests:
 * 1. Rate limiting on /auth/sign-in endpoint
 * 2. Proper headers (X-RateLimit-*, Retry-After)
 * 3. Error response after exceeding limit
 * 4. IP + email keying for targeted limiting
 */

import { config } from './config';

const API_URL = `http://localhost:${config.service.port}`;

interface RateLimitResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

/**
 * Make a request to the auth endpoint
 */
async function makeAuthRequest(email: string): Promise<RateLimitResponse> {
  try {
    const response = await fetch(`${API_URL}/auth/sign-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'wrong-password',
      }),
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let body;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    return {
      statusCode: response.status,
      headers,
      body,
    };
  } catch (error) {
    console.error('Request failed:', error);
    throw error;
  }
}

/**
 * Wait for a specified amount of time
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test rate limiting functionality
 */
async function testRateLimiting() {
  console.log('🧪 Testing Redis-backed Rate Limiting on Auth Endpoints\n');
  console.log(`API URL: ${API_URL}\n`);

  const testEmail = 'test@example.com';
  const maxAttempts = 5;

  console.log(`Testing rate limiting with email: ${testEmail}`);
  console.log(`Expected limit: ${maxAttempts} attempts per 15 minutes\n`);

  // Test 1: Make requests up to the limit
  console.log('📊 Test 1: Making requests up to the limit');
  console.log('='.repeat(60));

  for (let i = 1; i <= maxAttempts; i++) {
    const response = await makeAuthRequest(testEmail);
    
    console.log(`\nAttempt ${i}/${maxAttempts}:`);
    console.log(`  Status: ${response.statusCode}`);
    console.log(`  X-RateLimit-Limit: ${response.headers['x-ratelimit-limit'] || 'N/A'}`);
    console.log(`  X-RateLimit-Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
    console.log(`  X-RateLimit-Reset: ${response.headers['x-ratelimit-reset'] || 'N/A'}`);
    
    if (response.statusCode === 429) {
      console.log(`  ❌ Rate limited! (Unexpected at attempt ${i})`);
      console.log(`  Retry-After: ${response.headers['retry-after']} seconds`);
      console.log(`  Error: ${response.body.error}`);
    } else if (response.statusCode === 401) {
      console.log(`  ✓ Authentication failed (expected - wrong password)`);
    } else {
      console.log(`  Response: ${JSON.stringify(response.body)}`);
    }

    // Small delay between requests
    await sleep(100);
  }

  // Test 2: Exceed the limit
  console.log('\n\n📊 Test 2: Exceeding the rate limit');
  console.log('='.repeat(60));

  for (let i = 1; i <= 3; i++) {
    const response = await makeAuthRequest(testEmail);
    
    console.log(`\nAttempt ${maxAttempts + i} (over limit):`);
    console.log(`  Status: ${response.statusCode}`);
    
    if (response.statusCode === 429) {
      console.log(`  ✓ Rate limited! (Expected)`);
      console.log(`  Retry-After: ${response.headers['retry-after']} seconds`);
      console.log(`  Error: ${response.body.error}`);
      console.log(`  Code: ${response.body.code}`);
    } else {
      console.log(`  ❌ Not rate limited! (Unexpected)`);
      console.log(`  Response: ${JSON.stringify(response.body)}`);
    }

    await sleep(100);
  }

  // Test 3: Different email should have separate limit
  console.log('\n\n📊 Test 3: Different email should have separate rate limit');
  console.log('='.repeat(60));

  const differentEmail = 'different@example.com';
  const response = await makeAuthRequest(differentEmail);
  
  console.log(`\nAttempt 1 with ${differentEmail}:`);
  console.log(`  Status: ${response.statusCode}`);
  console.log(`  X-RateLimit-Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);
  
  if (response.statusCode === 401) {
    console.log(`  ✓ Not rate limited! (Expected - different email)`);
  } else if (response.statusCode === 429) {
    console.log(`  ❌ Rate limited! (Unexpected - should have separate limit)`);
  }

  console.log('\n\n✅ Rate limiting tests completed!');
  console.log('\nNote: To fully verify Redis-backed rate limiting:');
  console.log('1. Ensure Redis is running');
  console.log('2. Check Redis keys: redis-cli KEYS "bountyexpo:rl:auth:*"');
  console.log('3. Run multiple instances of the API to test distributed rate limiting');
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Check if server is running
    try {
      await fetch(`${API_URL}/health`);
    } catch (error) {
      console.error('❌ API server is not running!');
      console.error(`Please start the server with: npm run dev`);
      process.exit(1);
    }

    await testRateLimiting();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
