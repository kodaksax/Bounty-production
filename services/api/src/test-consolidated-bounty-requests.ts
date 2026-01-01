/**
 * Test script for consolidated bounty request routes
 * Tests all endpoints with various scenarios
 * 
 * Run with: npm run test:bounty-requests
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
let posterToken = '';
let posterUserId = '';
let hunterToken = '';
let hunterUserId = '';
let testBountyId = '';
let testRequestId = '';
let secondRequestId = '';

/**
 * Generate a secure test password
 */
function generateTestPassword(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `Test${random}${timestamp}!`;
}

/**
 * Setup: Create test users and bounty
 */
async function setupTestData() {
  logSection('Setup: Creating Test Users and Bounty');

  try {
    const timestamp = Date.now();
    
    // Create poster (bounty owner)
    const posterEmail = `poster_${timestamp}@example.com`;
    const posterPassword = generateTestPassword();
    
    const posterRegister = await makeRequest('POST', '/auth/register', {
      email: posterEmail,
      password: posterPassword,
      username: `poster_${timestamp}`,
    });

    if (posterRegister.status === 201) {
      logSuccess(`Created poster: ${posterEmail}`);
      posterUserId = posterRegister.data.userId;

      const posterSignIn = await makeRequest('POST', '/auth/sign-in', {
        email: posterEmail,
        password: posterPassword,
      });

      if (posterSignIn.status === 200) {
        posterToken = posterSignIn.data.session.access_token;
        logSuccess('Obtained poster access token');
      }
    }

    // Create hunter (applicant)
    const hunterEmail = `hunter_${timestamp}@example.com`;
    const hunterPassword = generateTestPassword();
    
    const hunterRegister = await makeRequest('POST', '/auth/register', {
      email: hunterEmail,
      password: hunterPassword,
      username: `hunter_${timestamp}`,
    });

    if (hunterRegister.status === 201) {
      logSuccess(`Created hunter: ${hunterEmail}`);
      hunterUserId = hunterRegister.data.userId;

      const hunterSignIn = await makeRequest('POST', '/auth/sign-in', {
        email: hunterEmail,
        password: hunterPassword,
      });

      if (hunterSignIn.status === 200) {
        hunterToken = hunterSignIn.data.session.access_token;
        logSuccess('Obtained hunter access token');
      }
    }

    // Create a test bounty
    const bountyResponse = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Test Bounty for Applications',
        description: 'This is a test bounty to accept applications. It has a long enough description to pass validation requirements.',
        amount: 100,
        isForHonor: false,
      },
      { Authorization: `Bearer ${posterToken}` }
    );

    if (bountyResponse.status === 201) {
      testBountyId = bountyResponse.data.id;
      logSuccess(`Created test bounty: ${testBountyId}`);
    } else {
      throw new Error('Failed to create test bounty');
    }

  } catch (error) {
    logError(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

/**
 * Test 1: Create bounty request as hunter
 */
async function testCreateRequest() {
  logSection('Test 1: Create Bounty Request');

  try {
    const response = await makeRequest(
      'POST',
      '/api/bounty-requests',
      {
        bounty_id: testBountyId,
        message: 'I am very interested in this bounty and have relevant experience with similar projects. I believe I can complete this task efficiently and meet all requirements.',
      },
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Should create bounty request with valid data',
      response.status === 201 && response.data.id
    );

    if (response.status === 201) {
      testRequestId = response.data.id;
      logInfo(`Created request ID: ${testRequestId}`);
    }
  } catch (error) {
    recordTest('Should create bounty request with valid data', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 2: Try to apply to own bounty (should fail)
 */
async function testCannotApplyToOwnBounty() {
  logSection('Test 2: Cannot Apply to Own Bounty');

  try {
    const response = await makeRequest(
      'POST',
      '/api/bounty-requests',
      {
        bounty_id: testBountyId,
        message: 'I am trying to apply to my own bounty, which should not be allowed.',
      },
      { Authorization: `Bearer ${posterToken}` }
    );

    recordTest(
      'Should reject application to own bounty',
      response.status === 400
    );
  } catch (error) {
    recordTest('Should reject application to own bounty', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 3: Try to apply twice (should fail)
 */
async function testCannotApplyTwice() {
  logSection('Test 3: Cannot Apply Twice to Same Bounty');

  try {
    const response = await makeRequest(
      'POST',
      '/api/bounty-requests',
      {
        bounty_id: testBountyId,
        message: 'This is a second application to the same bounty, which should not be allowed.',
      },
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Should reject duplicate application',
      response.status === 409
    );
  } catch (error) {
    recordTest('Should reject duplicate application', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 4: List bounty requests
 */
async function testListRequests() {
  logSection('Test 4: List Bounty Requests');

  try {
    // List as poster (should see requests for their bounty)
    const posterResponse = await makeRequest(
      'GET',
      `/api/bounty-requests?bounty_id=${testBountyId}`,
      undefined,
      { Authorization: `Bearer ${posterToken}` }
    );

    recordTest(
      'Poster should see requests for their bounty',
      posterResponse.status === 200 && posterResponse.data.requests.length > 0
    );

    // List as hunter (should see their own applications)
    const hunterResponse = await makeRequest(
      'GET',
      '/api/bounty-requests',
      undefined,
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Hunter should see their own applications',
      hunterResponse.status === 200 && hunterResponse.data.requests.length > 0
    );
  } catch (error) {
    recordTest('List bounty requests', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 5: Get specific request
 */
async function testGetRequest() {
  logSection('Test 5: Get Specific Request');

  try {
    // Get as poster
    const posterResponse = await makeRequest(
      'GET',
      `/api/bounty-requests/${testRequestId}`,
      undefined,
      { Authorization: `Bearer ${posterToken}` }
    );

    recordTest(
      'Poster should be able to view request',
      posterResponse.status === 200 && posterResponse.data.id === testRequestId
    );

    // Get as hunter
    const hunterResponse = await makeRequest(
      'GET',
      `/api/bounty-requests/${testRequestId}`,
      undefined,
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Hunter should be able to view their own request',
      hunterResponse.status === 200 && hunterResponse.data.id === testRequestId
    );
  } catch (error) {
    recordTest('Get specific request', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 6: Get requests by user
 */
async function testGetRequestsByUser() {
  logSection('Test 6: Get Requests by User');

  try {
    const response = await makeRequest(
      'GET',
      `/api/bounty-requests/user/${hunterUserId}`,
      undefined,
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Should get requests by user ID',
      response.status === 200 && Array.isArray(response.data)
    );
  } catch (error) {
    recordTest('Get requests by user', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 7: Try to accept as non-owner (should fail)
 */
async function testCannotAcceptAsNonOwner() {
  logSection('Test 7: Cannot Accept as Non-Owner');

  try {
    const response = await makeRequest(
      'PATCH',
      `/api/bounty-requests/${testRequestId}`,
      { status: 'accepted' },
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Should reject acceptance by non-owner',
      response.status === 403
    );
  } catch (error) {
    recordTest('Cannot accept as non-owner', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 8: Accept request as bounty owner
 */
async function testAcceptRequest() {
  logSection('Test 8: Accept Request as Bounty Owner');

  try {
    const response = await makeRequest(
      'PATCH',
      `/api/bounty-requests/${testRequestId}`,
      { status: 'accepted' },
      { Authorization: `Bearer ${posterToken}` }
    );

    recordTest(
      'Should accept request as bounty owner',
      response.status === 200 && response.data.status === 'accepted'
    );

    if (response.status === 200) {
      logInfo('Request accepted successfully');
      
      // Verify bounty status updated
      const bountyResponse = await makeRequest(
        'GET',
        `/api/bounties/${testBountyId}`,
        undefined,
        { Authorization: `Bearer ${posterToken}` }
      );

      recordTest(
        'Bounty status should be in_progress after acceptance',
        bountyResponse.data.status === 'in_progress' && bountyResponse.data.accepted_by === hunterUserId
      );
    }
  } catch (error) {
    recordTest('Accept request as bounty owner', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 9: Create and withdraw request
 */
async function testWithdrawRequest() {
  logSection('Test 9: Withdraw Request');

  try {
    // Create a new bounty for this test
    const bountyResponse = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Test Bounty for Withdrawal',
        description: 'This is a test bounty to test withdrawal functionality. It has a long enough description to pass validation.',
        amount: 50,
        isForHonor: false,
      },
      { Authorization: `Bearer ${posterToken}` }
    );

    if (bountyResponse.status !== 201) {
      throw new Error('Failed to create test bounty for withdrawal');
    }

    const newBountyId = bountyResponse.data.id;

    // Create a request
    const requestResponse = await makeRequest(
      'POST',
      '/api/bounty-requests',
      {
        bounty_id: newBountyId,
        message: 'This is a test application that will be withdrawn. It needs to be long enough to pass validation.',
      },
      { Authorization: `Bearer ${hunterToken}` }
    );

    if (requestResponse.status !== 201) {
      throw new Error('Failed to create test request for withdrawal');
    }

    const withdrawRequestId = requestResponse.data.id;

    // Withdraw the request
    const withdrawResponse = await makeRequest(
      'PATCH',
      `/api/bounty-requests/${withdrawRequestId}`,
      { status: 'withdrawn' },
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Hunter should be able to withdraw their request',
      withdrawResponse.status === 200 && withdrawResponse.data.status === 'withdrawn'
    );
  } catch (error) {
    recordTest('Withdraw request', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 10: Delete pending request
 */
async function testDeleteRequest() {
  logSection('Test 10: Delete Pending Request');

  try {
    // Create a new bounty for this test
    const bountyResponse = await makeRequest(
      'POST',
      '/api/bounties',
      {
        title: 'Test Bounty for Deletion',
        description: 'This is a test bounty to test deletion functionality. It has a long enough description to pass validation.',
        amount: 75,
        isForHonor: false,
      },
      { Authorization: `Bearer ${posterToken}` }
    );

    if (bountyResponse.status !== 201) {
      throw new Error('Failed to create test bounty for deletion');
    }

    const newBountyId = bountyResponse.data.id;

    // Create a request
    const requestResponse = await makeRequest(
      'POST',
      '/api/bounty-requests',
      {
        bounty_id: newBountyId,
        message: 'This is a test application that will be deleted. It needs to be long enough to pass validation.',
      },
      { Authorization: `Bearer ${hunterToken}` }
    );

    if (requestResponse.status !== 201) {
      throw new Error('Failed to create test request for deletion');
    }

    const deleteRequestId = requestResponse.data.id;

    // Delete the request
    const deleteResponse = await makeRequest(
      'DELETE',
      `/api/bounty-requests/${deleteRequestId}`,
      undefined,
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Hunter should be able to delete their pending request',
      deleteResponse.status === 200 && deleteResponse.data.success === true
    );

    // Verify it's gone
    const getResponse = await makeRequest(
      'GET',
      `/api/bounty-requests/${deleteRequestId}`,
      undefined,
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Deleted request should return 404',
      getResponse.status === 404
    );
  } catch (error) {
    recordTest('Delete pending request', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Test 11: Try to delete accepted request (should fail)
 */
async function testCannotDeleteAcceptedRequest() {
  logSection('Test 11: Cannot Delete Accepted Request');

  try {
    const deleteResponse = await makeRequest(
      'DELETE',
      `/api/bounty-requests/${testRequestId}`,
      undefined,
      { Authorization: `Bearer ${hunterToken}` }
    );

    recordTest(
      'Should not be able to delete accepted request',
      deleteResponse.status === 409
    );
  } catch (error) {
    recordTest('Cannot delete accepted request', false, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Print test summary
 */
function printSummary() {
  logSection('Test Summary');
  
  const total = testResults.passed + testResults.failed;
  const passRate = total > 0 ? ((testResults.passed / total) * 100).toFixed(2) : '0.00';

  log(`Total Tests: ${total}`);
  log(`Passed: ${testResults.passed}`, colors.green);
  log(`Failed: ${testResults.failed}`, colors.red);
  log(`Pass Rate: ${passRate}%`, testResults.failed === 0 ? colors.green : colors.yellow);

  if (testResults.failed > 0) {
    log('\nFailed Tests:', colors.red);
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => {
        log(`  - ${t.name}${t.error ? ': ' + t.error : ''}`, colors.red);
      });
  }
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('CONSOLIDATED BOUNTY REQUEST ROUTES TEST SUITE', colors.cyan);
  log('='.repeat(60) + '\n', colors.cyan);

  try {
    await setupTestData();
    
    await testCreateRequest();
    await testCannotApplyToOwnBounty();
    await testCannotApplyTwice();
    await testListRequests();
    await testGetRequest();
    await testGetRequestsByUser();
    await testCannotAcceptAsNonOwner();
    await testAcceptRequest();
    await testWithdrawRequest();
    await testDeleteRequest();
    await testCannotDeleteAcceptedRequest();

    printSummary();

    // Exit with appropriate code
    process.exit(testResults.failed === 0 ? 0 : 1);
  } catch (error) {
    logError(`\nTest suite failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    printSummary();
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}
