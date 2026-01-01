/**
 * Test script for consolidated bounty routes
 * Tests all endpoints with various scenarios
 * 
 * Run with: npm run test:bounties
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
let testBountyId = '';
let secondUserToken = '';
let secondUserId = '';
const createdBountyIds: string[] = [];  // Track created bounties for cleanup

/**
 * Generate a secure test password that meets common requirements
 */
function generateTestPassword(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  // Ensure we have uppercase, lowercase, number, and special char
  return `Test${random}${timestamp}!`;
}

/**
 * Setup: Create test users
 */
async function setupTestUsers() {
  logSection('Setup: Creating Test Users');

  try {
    // Create first test user
    const timestamp = Date.now();
    const user1Email = `bounty_test_user_${timestamp}@example.com`;
    const user1Password = generateTestPassword();

    const registerResponse1 = await makeRequest('POST', '/auth/register', {
      email: user1Email,
      password: user1Password,
      username: `bountyuser1_${timestamp}`,
    });

    if (registerResponse1.status === 201) {
      logSuccess(`Created test user 1: ${user1Email}`);
      testUserId = registerResponse1.data.userId;

      // Sign in to get token
      const signInResponse1 = await makeRequest('POST', '/auth/sign-in', {
        email: user1Email,
        password: user1Password,
      });

      if (signInResponse1.status === 200) {
        testAccessToken = signInResponse1.data.session.access_token;
        logSuccess('Obtained access token for user 1');
      }
    }

    // Create second test user
    const user2Email = `bounty_test_user2_${timestamp}@example.com`;
    const user2Password = generateTestPassword();

    const registerResponse2 = await makeRequest('POST', '/auth/register', {
      email: user2Email,
      password: user2Password,
      username: `bountyuser2_${timestamp}`,
    });

    if (registerResponse2.status === 201) {
      logSuccess(`Created test user 2: ${user2Email}`);
      secondUserId = registerResponse2.data.userId;

      // Sign in to get token
      const signInResponse2 = await makeRequest('POST', '/auth/sign-in', {
        email: user2Email,
        password: user2Password,
      });

      if (signInResponse2.status === 200) {
        secondUserToken = signInResponse2.data.session.access_token;
        logSuccess('Obtained access token for user 2');
      }
    }
  } catch (error) {
    logError(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

/**
 * Test: Create Bounty
 */
async function testCreateBounty() {
  logSection('Test: Create Bounty');

  // Test 1: Create valid bounty
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Test Bounty - Build a Website',
        description: 'I need someone to build a simple website for my business. Must include a contact form, about page, and services page. Design should be modern and responsive.',
        amount: 500,
        isForHonor: false,
        category: 'web-development',
        skills_required: ['HTML', 'CSS', 'JavaScript'],
        location: '123 Main St, San Francisco, CA',
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    if (response.status === 201 && response.data.id) {
      testBountyId = response.data.id;
      createdBountyIds.push(response.data.id);  // Track for cleanup
      recordTest('Create valid bounty', true);
    } else {
      recordTest('Create valid bounty', false, `Status: ${response.status}`);
    }
  } catch (error) {
    recordTest('Create valid bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Create honor bounty
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Help with community cleanup',
        description: 'Looking for volunteers to help clean up the local park. This is for honor and community service.',
        amount: 0,
        isForHonor: true,
        category: 'community',
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Create honor bounty', response.status === 201);
    if (response.status === 201 && response.data.id) {
      createdBountyIds.push(response.data.id);  // Track for cleanup
    }
  } catch (error) {
    recordTest('Create honor bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Fail - Honor bounty with non-zero amount
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Invalid honor bounty',
        description: 'This should fail because honor bounties must have amount=0',
        amount: 100,
        isForHonor: true,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject honor bounty with non-zero amount', response.status === 400);
  } catch (error) {
    recordTest('Reject honor bounty with non-zero amount', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: Fail - Title too short
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Short',
        description: 'This title is too short and should fail validation',
        amount: 100,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject bounty with short title', response.status === 400);
  } catch (error) {
    recordTest('Reject bounty with short title', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 5: Fail - Description too short
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Valid title here',
        description: 'Too short',
        amount: 100,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject bounty with short description', response.status === 400);
  } catch (error) {
    recordTest('Reject bounty with short description', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 6: Fail - No authentication
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Test Bounty Without Auth',
        description: 'This should fail because no authentication token is provided',
        amount: 100,
      }
    );

    recordTest('Reject bounty creation without auth', response.status === 401);
  } catch (error) {
    recordTest('Reject bounty creation without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: List Bounties
 */
async function testListBounties() {
  logSection('Test: List Bounties');

  // Test 1: List all bounties (no auth)
  try {
    const response = await makeRequest('GET', '/api/bounties');

    if (response.status === 200 && Array.isArray(response.data.bounties)) {
      recordTest('List bounties without auth', true);
    } else {
      recordTest('List bounties without auth', false, `Status: ${response.status}`);
    }
  } catch (error) {
    recordTest('List bounties without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: List bounties with authentication
  try {
    const response = await makeRequest(
      'GET',
      '/api/bounties',
      undefined,
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('List bounties with auth', response.status === 200);
  } catch (error) {
    recordTest('List bounties with auth', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: List bounties with status filter
  try {
    const response = await makeRequest('GET', '/api/bounties?status=open');

    recordTest('List bounties with status filter', response.status === 200);
  } catch (error) {
    recordTest('List bounties with status filter', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: List bounties with pagination
  try {
    const response = await makeRequest('GET', '/api/bounties?page=1&limit=5');

    if (response.status === 200 && response.data.pagination) {
      recordTest('List bounties with pagination', true);
    } else {
      recordTest('List bounties with pagination', false);
    }
  } catch (error) {
    recordTest('List bounties with pagination', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 5: List bounties by user
  try {
    const response = await makeRequest('GET', `/api/bounties?user_id=${testUserId}`);

    recordTest('List bounties by user', response.status === 200);
  } catch (error) {
    recordTest('List bounties by user', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 6: List bounties with sorting
  try {
    const response = await makeRequest('GET', '/api/bounties?sortBy=amount&sortOrder=desc');

    recordTest('List bounties with sorting', response.status === 200);
  } catch (error) {
    recordTest('List bounties with sorting', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: Get Bounty by ID
 */
async function testGetBounty() {
  logSection('Test: Get Bounty by ID');

  // Test 1: Get existing bounty without auth
  try {
    const response = await makeRequest('GET', `/api/bounties/${testBountyId}`);

    recordTest('Get bounty without auth', response.status === 200);
  } catch (error) {
    recordTest('Get bounty without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Get existing bounty with auth
  try {
    const response = await makeRequest(
      'GET',
      `/api/bounties/${testBountyId}`,
      undefined,
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Get bounty with auth', response.status === 200);
  } catch (error) {
    recordTest('Get bounty with auth', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Get non-existent bounty
  try {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await makeRequest('GET', `/api/bounties/${fakeId}`);

    recordTest('Get non-existent bounty returns 404', response.status === 404);
  } catch (error) {
    recordTest('Get non-existent bounty returns 404', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: Get bounty with invalid UUID
  try {
    const response = await makeRequest('GET', '/api/bounties/invalid-uuid');

    // Accept either 400 (validation error) or 404 (route not matched)
    recordTest('Get bounty with invalid UUID returns error', response.status === 400 || response.status === 404);
  } catch (error) {
    recordTest('Get bounty with invalid UUID returns error', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: Update Bounty
 */
async function testUpdateBounty() {
  logSection('Test: Update Bounty');

  // Test 1: Update bounty as owner
  try {
    const response = await makeRequest(
      'PATCH',
      `/api/bounties/${testBountyId}`,
      {
        title: 'Updated Test Bounty - Build a Website',
        amount: 600,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Update bounty as owner', response.status === 200);
  } catch (error) {
    recordTest('Update bounty as owner', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Fail - Update bounty as different user
  try {
    const response = await makeRequest(
      'PATCH',
      `/api/bounties/${testBountyId}`,
      {
        title: 'Trying to hijack bounty',
      },
      { Authorization: `Bearer ${secondUserToken}` }
    );

    recordTest('Reject update by non-owner', response.status === 403);
  } catch (error) {
    recordTest('Reject update by non-owner', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Fail - Update without authentication
  try {
    const response = await makeRequest(
      'PATCH',
      `/api/bounties/${testBountyId}`,
      {
        title: 'No auth update',
      }
    );

    recordTest('Reject update without auth', response.status === 401);
  } catch (error) {
    recordTest('Reject update without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: Accept Bounty
 */
async function testAcceptBounty() {
  logSection('Test: Accept Bounty');

  // Test 1: Fail - Accept own bounty
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/accept`,
      {},
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject accepting own bounty', response.status === 400);
  } catch (error) {
    recordTest('Reject accepting own bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Accept bounty as different user
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/accept`,
      {},
      { Authorization: `Bearer ${secondUserToken}` }
    );

    recordTest('Accept bounty as different user', response.status === 200);
  } catch (error) {
    recordTest('Accept bounty as different user', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Fail - Accept already accepted bounty
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/accept`,
      {},
      { Authorization: `Bearer ${secondUserToken}` }
    );

    recordTest('Reject accepting already accepted bounty', response.status === 409);
  } catch (error) {
    recordTest('Reject accepting already accepted bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: Fail - Accept without authentication
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/accept`,
      {}
    );

    recordTest('Reject accept without auth', response.status === 401);
  } catch (error) {
    recordTest('Reject accept without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: Complete Bounty
 */
async function testCompleteBounty() {
  logSection('Test: Complete Bounty');

  // Test 1: Fail - Complete as non-hunter
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/complete`,
      {},
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject completion by non-hunter', response.status === 403);
  } catch (error) {
    recordTest('Reject completion by non-hunter', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Complete as hunter
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/complete`,
      {},
      { Authorization: `Bearer ${secondUserToken}` }
    );

    recordTest('Complete bounty as hunter', response.status === 200);
  } catch (error) {
    recordTest('Complete bounty as hunter', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Fail - Complete already completed bounty
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/complete`,
      {},
      { Authorization: `Bearer ${secondUserToken}` }
    );

    recordTest('Reject completing already completed bounty', response.status === 409);
  } catch (error) {
    recordTest('Reject completing already completed bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: Fail - Complete without authentication
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/complete`,
      {}
    );

    recordTest('Reject complete without auth', response.status === 401);
  } catch (error) {
    recordTest('Reject complete without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: Archive Bounty
 */
async function testArchiveBounty() {
  logSection('Test: Archive Bounty');

  // Create a new bounty for archival tests
  let archiveBountyId = '';
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Bounty to be archived',
        description: 'This bounty will be archived during testing to verify the archive functionality works correctly.',
        amount: 100,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    if (response.status === 201) {
      archiveBountyId = response.data.id;
      createdBountyIds.push(response.data.id);  // Track for cleanup
      logInfo('Created bounty for archive tests');
    }
  } catch (error) {
    logError('Failed to create bounty for archive tests');
  }

  // Test 1: Archive bounty as owner
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${archiveBountyId}/archive`,
      {},
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Archive bounty as owner', response.status === 200);
  } catch (error) {
    recordTest('Archive bounty as owner', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Fail - Archive completed bounty (using the completed test bounty)
  try {
    const response = await makeRequest(
      'POST',
      `/api/bounties/${testBountyId}/archive`,
      {},
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject archiving completed bounty', response.status === 409);
  } catch (error) {
    recordTest('Reject archiving completed bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Fail - Archive as non-owner
  // Create another bounty owned by user 1
  let otherBountyId = '';
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Another bounty for archive test',
        description: 'This bounty is owned by user 1 and user 2 will try to archive it.',
        amount: 50,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    if (response.status === 201) {
      otherBountyId = response.data.id;
      createdBountyIds.push(response.data.id);  // Track for cleanup
    }
  } catch (error) {
    logError('Failed to create second bounty for archive test');
  }

  if (otherBountyId) {
    try {
      const response = await makeRequest(
        'POST',
        `/api/bounties/${otherBountyId}/archive`,
        {},
        { Authorization: `Bearer ${secondUserToken}` }
      );

      recordTest('Reject archive by non-owner', response.status === 403);
    } catch (error) {
      recordTest('Reject archive by non-owner', false, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // Test 4: Fail - Archive without authentication
  if (otherBountyId) {
    try {
      const response = await makeRequest(
        'POST',
        `/api/bounties/${otherBountyId}/archive`,
        {}
      );

      recordTest('Reject archive without auth', response.status === 401);
    } catch (error) {
      recordTest('Reject archive without auth', false, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

/**
 * Test: Delete Bounty
 */
async function testDeleteBounty() {
  logSection('Test: Delete Bounty');

  // Create a new bounty for deletion tests
  let deleteBountyId = '';
  try {
    const response = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Bounty to be deleted',
        description: 'This bounty will be deleted during testing to verify the delete functionality works correctly.',
        amount: 75,
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    if (response.status === 201) {
      deleteBountyId = response.data.id;
      createdBountyIds.push(response.data.id);  // Track for cleanup
      logInfo('Created bounty for deletion tests');
    }
  } catch (error) {
    logError('Failed to create bounty for deletion tests');
  }

  // Test 1: Fail - Delete as non-owner
  try {
    const response = await makeRequest(
      'DELETE',
      `/api/bounties/${deleteBountyId}`,
      undefined,
      { Authorization: `Bearer ${secondUserToken}` }
    );

    recordTest('Reject delete by non-owner', response.status === 403);
  } catch (error) {
    recordTest('Reject delete by non-owner', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 2: Delete bounty as owner
  try {
    const response = await makeRequest(
      'DELETE',
      `/api/bounties/${deleteBountyId}`,
      undefined,
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Delete bounty as owner', response.status === 200);
  } catch (error) {
    recordTest('Delete bounty as owner', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 3: Fail - Delete non-existent bounty
  try {
    const response = await makeRequest(
      'DELETE',
      `/api/bounties/${deleteBountyId}`,
      undefined,
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject deleting non-existent bounty', response.status === 404);
  } catch (error) {
    recordTest('Reject deleting non-existent bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }

  // Test 4: Fail - Delete without authentication
  try {
    const response = await makeRequest(
      'DELETE',
      `/api/bounties/${testBountyId}`,
      undefined
    );

    recordTest('Reject delete without auth', response.status === 401);
  } catch (error) {
    recordTest('Reject delete without auth', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test: Update completed bounty (should fail)
 */
async function testUpdateCompletedBounty() {
  logSection('Test: Update Completed Bounty');

  // Test 1: Fail - Update completed bounty
  try {
    const response = await makeRequest(
      'PATCH',
      `/api/bounties/${testBountyId}`,
      {
        title: 'Trying to update completed bounty',
      },
      { Authorization: `Bearer ${testAccessToken}` }
    );

    recordTest('Reject updating completed bounty', response.status === 409);
  } catch (error) {
    recordTest('Reject updating completed bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Cleanup test data
 */
async function cleanupTestData() {
  logSection('Cleanup: Removing Test Data');
  
  let cleanedCount = 0;
  let failedCount = 0;
  
  // Clean up bounties
  for (const bountyId of createdBountyIds) {
    try {
      // Try to delete the bounty (may already be deleted in tests)
      const response = await makeRequest(
        'DELETE',
        `/api/bounties/${bountyId}`,
        undefined,
        { Authorization: `Bearer ${testAccessToken}` }
      );
      
      if (response.status === 200 || response.status === 404) {
        cleanedCount++;
      } else {
        failedCount++;
      }
    } catch (error) {
      // Ignore errors during cleanup - bounty may already be deleted
      failedCount++;
    }
  }
  
  logInfo(`Cleaned up ${cleanedCount} bounties, ${failedCount} already removed or failed`);
  
  // Note: User cleanup is typically handled by the auth system or database cascades
  // Test users can be left for manual cleanup or database reset
}

/**
 * Print test summary
 */
function printSummary() {
  logSection('Test Summary');
  
  log(`Total Tests: ${testResults.passed + testResults.failed}`, colors.cyan);
  log(`Passed: ${testResults.passed}`, colors.green);
  log(`Failed: ${testResults.failed}`, colors.red);
  
  if (testResults.failed > 0) {
    log('\nFailed Tests:', colors.red);
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => {
        log(`  - ${t.name}${t.error ? ': ' + t.error : ''}`, colors.red);
      });
  }
  
  const successRate = Math.round((testResults.passed / (testResults.passed + testResults.failed)) * 100);
  log(`\nSuccess Rate: ${successRate}%`, successRate === 100 ? colors.green : colors.yellow);
}

/**
 * Main test runner
 */
async function runTests() {
  logSection('Consolidated Bounty Routes Test Suite');
  logInfo(`Testing API at: ${API_BASE_URL}`);
  
  try {
    await setupTestUsers();
    await testCreateBounty();
    await testListBounties();
    await testGetBounty();
    await testUpdateBounty();
    await testAcceptBounty();
    await testCompleteBounty();
    await testUpdateCompletedBounty();
    await testArchiveBounty();
    await testDeleteBounty();
    
    printSummary();
    
    // Cleanup test data before exit
    await cleanupTestData();
    
    // Exit with appropriate code
    process.exit(testResults.failed > 0 ? 1 : 0);
  } catch (error) {
    logError(`Test suite failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// Run the tests
runTests();
