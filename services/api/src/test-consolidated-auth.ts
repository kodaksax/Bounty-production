/**
 * Test script for consolidated authentication routes
 * Tests all endpoints with various scenarios
 */

import { config } from './config';

const API_BASE_URL = `http://localhost:${config.service.port}`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✓ ${message}`, colors.green);
}

function logError(message: string) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`ℹ ${message}`, colors.blue);
}

function logSection(message: string) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(message, colors.cyan);
  log('='.repeat(60), colors.cyan);
}

interface TestResult {
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; error?: string }>;
}

const testResults: TestResult = {
  passed: 0,
  failed: 0,
  tests: [],
};

function recordTest(name: string, passed: boolean, error?: string) {
  testResults.tests.push({ name, passed, error });
  if (passed) {
    testResults.passed++;
    logSuccess(name);
  } else {
    testResults.failed++;
    logError(`${name}${error ? ': ' + error : ''}`);
  }
}

async function makeRequest(
  method: string,
  endpoint: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: Headers }> {
  const url = `${API_BASE_URL}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    return {
      status: response.status,
      data,
      headers: response.headers,
    };
  } catch (error) {
    throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function testDiagnostics() {
  logSection('Testing GET /auth/diagnostics');

  try {
    const response = await makeRequest('GET', '/auth/diagnostics');
    
    const hasStatus = response.data.status === 'ok';
    recordTest('Diagnostics returns ok status', hasStatus);
    
    const hasConfig = typeof response.data.supabaseConfigured === 'boolean';
    recordTest('Diagnostics returns configuration status', hasConfig);
    
    const hasTimestamp = typeof response.data.timestamp === 'string';
    recordTest('Diagnostics returns timestamp', hasTimestamp);
    
    logInfo(`Response: ${JSON.stringify(response.data, null, 2)}`);
  } catch (error) {
    recordTest('Diagnostics endpoint', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testPing() {
  logSection('Testing GET /auth/ping');

  try {
    const response = await makeRequest('GET', '/auth/ping');
    
    const isOk = response.data.ok === true;
    recordTest('Ping returns ok status', isOk);
    
    const hasMessage = typeof response.data.message === 'string';
    recordTest('Ping returns message', hasMessage);
    
    logInfo(`Response: ${JSON.stringify(response.data, null, 2)}`);
  } catch (error) {
    recordTest('Ping endpoint', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testRegister() {
  logSection('Testing POST /auth/register');

  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  
  // Test valid registration
  try {
    const response = await makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: testPassword,
    });
    
    const isSuccess = response.status === 201 && response.data.success === true;
    recordTest('Register with valid data succeeds', isSuccess);
    
    const hasUserId = typeof response.data.userId === 'string';
    recordTest('Register returns userId', hasUserId);
    
    logInfo(`Registered user: ${response.data.email} (ID: ${response.data.userId})`);
  } catch (error) {
    recordTest('Register with valid data', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test validation - missing password
  try {
    const response = await makeRequest('POST', '/auth/register', {
      email: 'test@example.com',
    });
    
    const isBadRequest = response.status === 400;
    recordTest('Register without password returns 400', isBadRequest);
  } catch (error) {
    recordTest('Register validation (missing password)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test validation - invalid email
  try {
    const response = await makeRequest('POST', '/auth/register', {
      email: 'not-an-email',
      password: 'password123',
    });
    
    const isBadRequest = response.status === 400;
    recordTest('Register with invalid email returns 400', isBadRequest);
  } catch (error) {
    recordTest('Register validation (invalid email)', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test validation - short password
  try {
    const response = await makeRequest('POST', '/auth/register', {
      email: 'test2@example.com',
      password: 'short',
    });
    
    const isBadRequest = response.status === 400;
    recordTest('Register with short password returns 400', isBadRequest);
  } catch (error) {
    recordTest('Register validation (short password)', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testSignIn() {
  logSection('Testing POST /auth/sign-in');

  // First, create a test user
  const testEmail = `signin-test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  
  try {
    const registerResponse = await makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: testPassword,
    });
    
    if (registerResponse.status === 201) {
      logInfo(`Created test user: ${testEmail}`);
      
      // Wait a moment for the user to be fully created
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Test sign-in with correct credentials
      const signInResponse = await makeRequest('POST', '/auth/sign-in', {
        email: testEmail,
        password: testPassword,
      });
      
      const isSuccess = signInResponse.status === 200 && signInResponse.data.success === true;
      recordTest('Sign-in with valid credentials succeeds', isSuccess);
      
      const hasSession = signInResponse.data.session && typeof signInResponse.data.session.access_token === 'string';
      recordTest('Sign-in returns session with access token', hasSession);
      
      if (hasSession) {
        logInfo(`Access token received (length: ${signInResponse.data.session.access_token.length})`);
      }
    }
  } catch (error) {
    recordTest('Sign-in with valid credentials', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test sign-in with invalid credentials
  try {
    const response = await makeRequest('POST', '/auth/sign-in', {
      email: 'nonexistent@example.com',
      password: 'wrongpassword',
    });
    
    const isUnauthorized = response.status === 401;
    recordTest('Sign-in with invalid credentials returns 401', isUnauthorized);
  } catch (error) {
    recordTest('Sign-in with invalid credentials', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test validation - missing password
  try {
    const response = await makeRequest('POST', '/auth/sign-in', {
      email: 'test@example.com',
    });
    
    const isBadRequest = response.status === 400;
    recordTest('Sign-in without password returns 400', isBadRequest);
  } catch (error) {
    recordTest('Sign-in validation (missing password)', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testSignUp() {
  logSection('Testing POST /auth/sign-up');

  const testEmail = `signup-test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  
  try {
    const response = await makeRequest('POST', '/auth/sign-up', {
      email: testEmail,
      password: testPassword,
      username: 'testuser',
    });
    
    const isSuccess = response.status === 201 && response.data.success === true;
    recordTest('Sign-up with valid data succeeds', isSuccess);
    
    const hasUserId = typeof response.data.userId === 'string';
    recordTest('Sign-up returns userId', hasUserId);
    
    const hasUsername = response.data.username === 'testuser';
    recordTest('Sign-up returns correct username', hasUsername);
    
    logInfo(`Signed up user: ${response.data.email} (ID: ${response.data.userId})`);
  } catch (error) {
    recordTest('Sign-up with valid data', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testRateLimit() {
  logSection('Testing Rate Limiting (5 requests per 15 minutes)');

  const testEmail = `ratelimit-test-${Date.now()}@example.com`;
  
  try {
    logInfo('Making 6 consecutive requests to test rate limiting...');
    
    for (let i = 1; i <= 6; i++) {
      const response = await makeRequest('POST', '/auth/register', {
        email: `${testEmail}-${i}`,
        password: 'TestPassword123!',
      });
      
      logInfo(`Request ${i}: Status ${response.status}`);
      
      if (i <= 5) {
        // First 5 requests should succeed or fail for other reasons (like duplicate)
        const notRateLimited = response.status !== 429;
        if (notRateLimited) {
          logInfo(`  Request ${i} was not rate-limited`);
        }
      } else {
        // 6th request should be rate-limited
        const isRateLimited = response.status === 429;
        recordTest('6th request is rate-limited (429)', isRateLimited);
        
        if (isRateLimited) {
          const hasRetryAfter = response.headers.get('Retry-After');
          recordTest('Rate limit response includes Retry-After header', !!hasRetryAfter);
          logInfo(`  Rate limit hit! Retry after: ${hasRetryAfter} seconds`);
        }
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    recordTest('Rate limiting test', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testDeleteAccount() {
  logSection('Testing DELETE /auth/delete-account');

  // First, create a test user and get their access token
  const testEmail = `delete-test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  
  try {
    // Register
    const registerResponse = await makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: testPassword,
    });
    
    if (registerResponse.status !== 201) {
      recordTest('Create user for deletion test', false, 'Failed to create user');
      return;
    }
    
    const userId = registerResponse.data.userId;
    logInfo(`Created test user: ${testEmail} (ID: ${userId})`);
    
    // Wait for user creation to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Sign in to get access token
    const signInResponse = await makeRequest('POST', '/auth/sign-in', {
      email: testEmail,
      password: testPassword,
    });
    
    if (signInResponse.status !== 200 || !signInResponse.data.session) {
      recordTest('Sign in for deletion test', false, 'Failed to sign in');
      return;
    }
    
    const accessToken = signInResponse.data.session.access_token;
    logInfo(`Signed in, got access token`);
    
    // Test deletion without auth
    const unauthResponse = await makeRequest('DELETE', '/auth/delete-account');
    const isUnauthorized = unauthResponse.status === 401;
    recordTest('Delete account without auth returns 401', isUnauthorized);
    
    // Test deletion with auth
    const deleteResponse = await makeRequest('DELETE', '/auth/delete-account', undefined, {
      Authorization: `Bearer ${accessToken}`,
    });
    
    const isSuccess = deleteResponse.status === 200 && deleteResponse.data.success === true;
    recordTest('Delete account with auth succeeds', isSuccess);
    
    logInfo(`Deleted user account: ${userId}`);
  } catch (error) {
    recordTest('Delete account test', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function runAllTests() {
  log('\n🧪 Starting Consolidated Auth Routes Tests\n', colors.cyan);
  logInfo(`API Base URL: ${API_BASE_URL}`);
  logInfo(`Config loaded: ${config.service.name} v${config.service.version}`);
  
  try {
    await testDiagnostics();
    await testPing();
    await testRegister();
    await testSignUp();
    await testSignIn();
    await testRateLimit();
    await testDeleteAccount();
    
    // Print summary
    logSection('Test Summary');
    log(`Total tests: ${testResults.passed + testResults.failed}`, colors.blue);
    log(`Passed: ${testResults.passed}`, colors.green);
    log(`Failed: ${testResults.failed}`, colors.red);
    
    if (testResults.failed > 0) {
      log('\nFailed tests:', colors.red);
      testResults.tests
        .filter(t => !t.passed)
        .forEach(t => {
          log(`  - ${t.name}${t.error ? ': ' + t.error : ''}`, colors.red);
        });
    }
    
    log('\n✅ Test run completed!\n', colors.green);
    
    process.exit(testResults.failed > 0 ? 1 : 0);
  } catch (error) {
    logError(`Test suite failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  logError(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1);
});
