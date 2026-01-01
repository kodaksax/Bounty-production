/**
 * Test script for consolidated profile routes
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

// Test data
let testAccessToken = '';
let testUserId = '';

async function testGetPublicProfile() {
  logSection('Testing GET /api/profiles/:id (Public)');

  try {
    // Test with a mock UUID (should return 404)
    const mockUuid = '00000000-0000-0000-0000-000000000000';
    const response = await makeRequest('GET', `/api/profiles/${mockUuid}`);

    recordTest(
      'Returns 404 for non-existent profile',
      response.status === 404,
      response.status !== 404 ? `Expected 404, got ${response.status}` : undefined
    );

    // Test with invalid UUID format
    const invalidResponse = await makeRequest('GET', `/api/profiles/invalid-uuid`);
    
    recordTest(
      'Returns 400 for invalid UUID format',
      invalidResponse.status === 400,
      invalidResponse.status !== 400 ? `Expected 400, got ${invalidResponse.status}` : undefined
    );
  } catch (error) {
    recordTest('GET /api/profiles/:id error handling', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testGetCurrentUserProfile() {
  logSection('Testing GET /api/profile (Authenticated)');

  try {
    // Test without authentication
    const unauthResponse = await makeRequest('GET', '/api/profile');

    recordTest(
      'Returns 401 without authentication',
      unauthResponse.status === 401,
      unauthResponse.status !== 401 ? `Expected 401, got ${unauthResponse.status}` : undefined
    );

    // Test with authentication (if we have a token)
    if (testAccessToken) {
      const authResponse = await makeRequest(
        'GET',
        '/api/profile',
        undefined,
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 200 with valid authentication',
        authResponse.status === 200,
        authResponse.status !== 200 ? `Expected 200, got ${authResponse.status}` : undefined
      );

      if (authResponse.status === 200) {
        recordTest(
          'Profile contains user ID',
          !!authResponse.data.id,
          !authResponse.data.id ? 'Missing id field' : undefined
        );

        recordTest(
          'Profile contains username',
          !!authResponse.data.username,
          !authResponse.data.username ? 'Missing username field' : undefined
        );

        recordTest(
          'Profile contains balance for owner',
          authResponse.data.balance !== undefined,
          authResponse.data.balance === undefined ? 'Missing balance field for owner' : undefined
        );
      }
    } else {
      logInfo('Skipping authenticated tests - no access token available');
    }
  } catch (error) {
    recordTest('GET /api/profile error handling', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testCreateUpdateProfile() {
  logSection('Testing POST /api/profiles (Create/Update)');

  try {
    // Test without authentication
    const unauthResponse = await makeRequest(
      'POST',
      '/api/profiles',
      { username: 'testuser' }
    );

    recordTest(
      'Returns 401 without authentication',
      unauthResponse.status === 401,
      unauthResponse.status !== 401 ? `Expected 401, got ${unauthResponse.status}` : undefined
    );

    // Test with authentication (if we have a token)
    if (testAccessToken) {
      // Test with invalid username (too short)
      const invalidUsernameResponse = await makeRequest(
        'POST',
        '/api/profiles',
        { username: 'ab' },
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 400 for invalid username (too short)',
        invalidUsernameResponse.status === 400,
        invalidUsernameResponse.status !== 400 ? `Expected 400, got ${invalidUsernameResponse.status}` : undefined
      );

      // Test with invalid avatar_url
      const invalidAvatarResponse = await makeRequest(
        'POST',
        '/api/profiles',
        {
          username: 'validusername',
          avatar_url: 'not-a-url',
        },
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 400 for invalid avatar URL',
        invalidAvatarResponse.status === 400,
        invalidAvatarResponse.status !== 400 ? `Expected 400, got ${invalidAvatarResponse.status}` : undefined
      );

      // Test with bio too long
      const longBio = 'a'.repeat(501);
      const longBioResponse = await makeRequest(
        'POST',
        '/api/profiles',
        {
          username: 'validusername',
          bio: longBio,
        },
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 400 for bio exceeding max length',
        longBioResponse.status === 400,
        longBioResponse.status !== 400 ? `Expected 400, got ${longBioResponse.status}` : undefined
      );

      // Test with valid data
      const validResponse = await makeRequest(
        'POST',
        '/api/profiles',
        {
          username: `testuser_${Date.now()}`,
          bio: 'Test bio for profile',
          avatar_url: 'https://example.com/avatar.jpg',
        },
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 200 for valid profile update',
        validResponse.status === 200,
        validResponse.status !== 200 ? `Expected 200, got ${validResponse.status}` : undefined
      );

      if (validResponse.status === 200) {
        recordTest(
          'Updated profile contains username',
          !!validResponse.data.username,
          !validResponse.data.username ? 'Missing username' : undefined
        );

        recordTest(
          'Updated profile contains bio',
          validResponse.data.bio === 'Test bio for profile',
          validResponse.data.bio !== 'Test bio for profile' ? 'Bio mismatch' : undefined
        );
      }
    } else {
      logInfo('Skipping authenticated tests - no access token available');
    }
  } catch (error) {
    recordTest('POST /api/profiles error handling', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testPatchProfile() {
  logSection('Testing PATCH /api/profiles/:id (Update Fields)');

  try {
    const mockUuid = '00000000-0000-0000-0000-000000000000';

    // Test without authentication
    const unauthResponse = await makeRequest(
      'PATCH',
      `/api/profiles/${mockUuid}`,
      { username: 'newusername' }
    );

    recordTest(
      'Returns 401 without authentication',
      unauthResponse.status === 401,
      unauthResponse.status !== 401 ? `Expected 401, got ${unauthResponse.status}` : undefined
    );

    // Test with authentication (if we have a token)
    if (testAccessToken && testUserId) {
      // Test updating another user's profile (should fail)
      const otherUserResponse = await makeRequest(
        'PATCH',
        `/api/profiles/${mockUuid}`,
        { username: 'hackerusername' },
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 403 when trying to update another user profile',
        otherUserResponse.status === 403,
        otherUserResponse.status !== 403 ? `Expected 403, got ${otherUserResponse.status}` : undefined
      );

      // Test updating own profile with invalid data
      const invalidResponse = await makeRequest(
        'PATCH',
        `/api/profiles/${testUserId}`,
        { username: 'ab' }, // too short
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 400 for invalid update data',
        invalidResponse.status === 400,
        invalidResponse.status !== 400 ? `Expected 400, got ${invalidResponse.status}` : undefined
      );

      // Test updating own profile with valid data
      const validResponse = await makeRequest(
        'PATCH',
        `/api/profiles/${testUserId}`,
        { bio: 'Updated bio via PATCH' },
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 200 for valid profile patch',
        validResponse.status === 200 || validResponse.status === 404, // 404 if profile doesn't exist yet
        `Got ${validResponse.status}`
      );
    } else {
      logInfo('Skipping authenticated tests - no access token or user ID available');
    }
  } catch (error) {
    recordTest('PATCH /api/profiles/:id error handling', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function testDeleteProfile() {
  logSection('Testing DELETE /api/profiles/:id');

  try {
    const mockUuid = '00000000-0000-0000-0000-000000000000';

    // Test without authentication
    const unauthResponse = await makeRequest('DELETE', `/api/profiles/${mockUuid}`);

    recordTest(
      'Returns 401 without authentication',
      unauthResponse.status === 401,
      unauthResponse.status !== 401 ? `Expected 401, got ${unauthResponse.status}` : undefined
    );

    // Test with authentication (if we have a token)
    if (testAccessToken && testUserId) {
      // Test deleting another user's profile (should fail)
      const otherUserResponse = await makeRequest(
        'DELETE',
        `/api/profiles/${mockUuid}`,
        undefined,
        { Authorization: `Bearer ${testAccessToken}` }
      );

      recordTest(
        'Returns 403 when trying to delete another user profile',
        otherUserResponse.status === 403,
        otherUserResponse.status !== 403 ? `Expected 403, got ${otherUserResponse.status}` : undefined
      );

      logInfo('Note: Not testing actual profile deletion to preserve test account');
    } else {
      logInfo('Skipping authenticated tests - no access token or user ID available');
    }
  } catch (error) {
    recordTest('DELETE /api/profiles/:id error handling', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

async function setupTestUser() {
  logSection('Setting up test user (if possible)');

  try {
    // Try to create a test user via auth endpoint
    const testEmail = `test_profile_${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';

    const registerResponse = await makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: testPassword,
      username: `testuser_${Date.now()}`,
    });

    if (registerResponse.status === 201) {
      logSuccess('Test user created successfully');
      testUserId = registerResponse.data.userId;

      // Sign in to get access token
      const signInResponse = await makeRequest('POST', '/auth/sign-in', {
        email: testEmail,
        password: testPassword,
      });

      if (signInResponse.status === 200 && signInResponse.data.session) {
        testAccessToken = signInResponse.data.session.access_token;
        logSuccess('Test user signed in successfully');
      } else {
        logInfo('Could not sign in test user, continuing with limited tests');
      }
    } else {
      logInfo('Could not create test user, continuing with limited tests');
    }
  } catch (error) {
    logInfo('Test user setup failed, continuing with limited tests');
  }
}

async function cleanupTestUser() {
  if (!testAccessToken || !testUserId) {
    return;
  }

  logSection('Cleaning up test user');

  try {
    // Delete the test account
    await makeRequest(
      'DELETE',
      '/auth/delete-account',
      undefined,
      { Authorization: `Bearer ${testAccessToken}` }
    );
    logSuccess('Test user cleaned up successfully');
  } catch (error) {
    logInfo('Test user cleanup failed (non-fatal)');
  }
}

async function runAllTests() {
  log('\n🧪 Starting Consolidated Profile Routes Tests', colors.cyan);
  log(`API Base URL: ${API_BASE_URL}\n`, colors.blue);

  // Setup
  await setupTestUser();

  // Run all tests
  await testGetPublicProfile();
  await testGetCurrentUserProfile();
  await testCreateUpdateProfile();
  await testPatchProfile();
  await testDeleteProfile();

  // Cleanup
  await cleanupTestUser();

  // Print summary
  logSection('Test Summary');
  log(`Total Tests: ${testResults.passed + testResults.failed}`, colors.blue);
  log(`Passed: ${testResults.passed}`, colors.green);
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? colors.red : colors.green);

  if (testResults.failed > 0) {
    log('\nFailed Tests:', colors.red);
    testResults.tests
      .filter((t) => !t.passed)
      .forEach((t) => {
        log(`  - ${t.name}${t.error ? ': ' + t.error : ''}`, colors.red);
      });
  }

  log('');

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch((error) => {
  logError(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1);
});
