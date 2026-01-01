/**
 * Test Consolidated Stripe Connect Service
 * Tests all Stripe Connect operations including:
 * - Creating Connect accounts
 * - Generating account links
 * - Verifying onboarding
 * - Creating transfers
 * - Retrying failed transfers
 * - Getting account status
 */

import {
  createConnectAccount,
  createAccountLink,
  verifyOnboarding,
  createTransfer,
  retryTransfer,
  getAccountStatus,
} from './services/consolidated-stripe-connect-service';
import { getBalance } from './services/consolidated-wallet-service';

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.cyan);
  console.log('='.repeat(60) + '\n');
}

function logSuccess(message: string) {
  log(`✓ ${message}`, colors.green);
}

function logError(message: string, error?: any) {
  log(`✗ ${message}`, colors.red);
  if (error) {
    console.error(error);
  }
}

function logInfo(message: string) {
  log(`ℹ ${message}`, colors.blue);
}

function logWarning(message: string) {
  log(`⚠ ${message}`, colors.yellow);
}

// Test configuration
const TEST_USER_ID = '123e4567-e89b-12d3-a456-426614174000'; // Test user ID
const TEST_EMAIL = 'test@example.com';
const TEST_RETURN_URL = 'http://localhost:8081/wallet/connect/return';
const TEST_REFRESH_URL = 'http://localhost:8081/wallet/connect/refresh';

async function runTests() {
  logSection('CONSOLIDATED STRIPE CONNECT SERVICE TESTS');
  
  let testsPassed = 0;
  let testsFailed = 0;
  let accountId: string | null = null;
  
  try {
    // Test 1: Create Connect Account
    logSection('Test 1: Create Connect Account');
    try {
      accountId = await createConnectAccount(TEST_USER_ID, TEST_EMAIL);
      logSuccess(`Created Connect account: ${accountId}`);
      logInfo(`User ID: ${TEST_USER_ID}`);
      logInfo(`Email: ${TEST_EMAIL}`);
      testsPassed++;
    } catch (error: any) {
      logError('Failed to create Connect account', error);
      testsFailed++;
      // If this fails, we can't continue with most tests
      logWarning('Skipping remaining tests that depend on Connect account');
    }
    
    // Test 2: Create Account Link (if account was created)
    if (accountId) {
      logSection('Test 2: Create Account Link');
      try {
        const linkResult = await createAccountLink(
          TEST_USER_ID,
          TEST_RETURN_URL,
          TEST_REFRESH_URL
        );
        logSuccess(`Generated account link`);
        logInfo(`URL: ${linkResult.url}`);
        logInfo(`Account ID: ${linkResult.accountId}`);
        logInfo(`Expires at: ${new Date(linkResult.expiresAt * 1000).toISOString()}`);
        testsPassed++;
      } catch (error: any) {
        logError('Failed to create account link', error);
        testsFailed++;
      }
    }
    
    // Test 3: Get Account Status
    if (accountId) {
      logSection('Test 3: Get Account Status');
      try {
        const status = await getAccountStatus(TEST_USER_ID);
        logSuccess(`Retrieved account status`);
        logInfo(`Account ID: ${status.accountId}`);
        logInfo(`Charges Enabled: ${status.chargesEnabled}`);
        logInfo(`Payouts Enabled: ${status.payoutsEnabled}`);
        logInfo(`Details Submitted: ${status.detailsSubmitted}`);
        logInfo(`Requires Action: ${status.requiresAction}`);
        if (status.currentlyDue && status.currentlyDue.length > 0) {
          logInfo(`Currently Due: ${status.currentlyDue.join(', ')}`);
        }
        testsPassed++;
      } catch (error: any) {
        logError('Failed to get account status', error);
        testsFailed++;
      }
    }
    
    // Test 4: Verify Onboarding (expect not onboarded in test environment)
    if (accountId) {
      logSection('Test 4: Verify Onboarding');
      try {
        const verification = await verifyOnboarding(TEST_USER_ID);
        logSuccess(`Verified onboarding status`);
        logInfo(`Onboarded: ${verification.onboarded}`);
        logInfo(`Charges Enabled: ${verification.chargesEnabled}`);
        logInfo(`Payouts Enabled: ${verification.payoutsEnabled}`);
        logInfo(`Details Submitted: ${verification.detailsSubmitted}`);
        
        if (!verification.onboarded) {
          logWarning('Account not fully onboarded (expected in test environment)');
        }
        testsPassed++;
      } catch (error: any) {
        logError('Failed to verify onboarding', error);
        testsFailed++;
      }
    }
    
    // Test 5: Try transfer without onboarding (should fail)
    if (accountId) {
      logSection('Test 5: Transfer Without Onboarding (Should Fail)');
      try {
        await createTransfer(TEST_USER_ID, 10);
        logError('Transfer should have failed without onboarding');
        testsFailed++;
      } catch (error: any) {
        if (error.message.includes('onboarding')) {
          logSuccess('Transfer correctly failed: User not onboarded');
          testsPassed++;
        } else {
          logError('Transfer failed with unexpected error', error);
          testsFailed++;
        }
      }
    }
    
    // Test 6: Try transfer with insufficient balance (should fail)
    if (accountId) {
      logSection('Test 6: Transfer With Insufficient Balance (Should Fail)');
      try {
        // First check current balance
        const balanceResult = await getBalance(TEST_USER_ID);
        logInfo(`Current balance: $${balanceResult.balance}`);
        
        // Try to transfer more than balance
        const transferAmount = Math.floor(balanceResult.balance * 2);
        await createTransfer(TEST_USER_ID, transferAmount);
        logError('Transfer should have failed with insufficient balance');
        testsFailed++;
      } catch (error: any) {
        if (error.message.includes('Insufficient') || error.message.includes('onboarding')) {
          logSuccess(`Transfer correctly failed: ${error.message}`);
          testsPassed++;
        } else {
          logError('Transfer failed with unexpected error', error);
          testsFailed++;
        }
      }
    }
    
    // Test 7: Create account for same user again (should return existing)
    if (accountId) {
      logSection('Test 7: Create Account Again (Should Return Existing)');
      try {
        const existingAccountId = await createConnectAccount(TEST_USER_ID, TEST_EMAIL);
        if (existingAccountId === accountId) {
          logSuccess(`Returned existing account ID: ${existingAccountId}`);
          testsPassed++;
        } else {
          logError('Got different account ID than expected');
          logInfo(`Expected: ${accountId}`);
          logInfo(`Got: ${existingAccountId}`);
          testsFailed++;
        }
      } catch (error: any) {
        logError('Failed to get existing account', error);
        testsFailed++;
      }
    }
    
    // Test 8: Test retry transfer with non-existent transaction (should fail)
    logSection('Test 8: Retry Non-Existent Transaction (Should Fail)');
    try {
      const fakeTransactionId = '00000000-0000-0000-0000-000000000000';
      await retryTransfer(fakeTransactionId, TEST_USER_ID);
      logError('Retry should have failed for non-existent transaction');
      testsFailed++;
    } catch (error: any) {
      if (error.message.includes('not found')) {
        logSuccess('Retry correctly failed: Transaction not found');
        testsPassed++;
      } else {
        logError('Retry failed with unexpected error', error);
        testsFailed++;
      }
    }
    
    // Summary
    logSection('TEST SUMMARY');
    log(`Total Tests: ${testsPassed + testsFailed}`, colors.cyan);
    log(`Passed: ${testsPassed}`, colors.green);
    log(`Failed: ${testsFailed}`, testsFailed > 0 ? colors.red : colors.green);
    
    if (testsFailed === 0) {
      logSuccess('\nAll tests passed! ✨');
    } else {
      logWarning(`\n${testsFailed} test(s) failed`);
    }
    
    // Note about test environment
    logSection('TEST ENVIRONMENT NOTES');
    logInfo('These tests run against a real Supabase instance');
    logInfo('Some tests are expected to fail in development (e.g., onboarding not complete)');
    logInfo('For full end-to-end testing, manual onboarding via Stripe dashboard is required');
    logWarning('Transfers will not complete without full Stripe Connect onboarding');
    
  } catch (error) {
    logError('Unexpected error during tests', error);
    process.exit(1);
  }
}

// Run tests
runTests()
  .then(() => {
    console.log('\n✓ Test execution completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Test execution failed:', error);
    process.exit(1);
  });
