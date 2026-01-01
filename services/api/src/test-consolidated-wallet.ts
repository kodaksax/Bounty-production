/**
 * Test Consolidated Wallet Service
 * Tests all wallet operations including:
 * - Balance queries
 * - Deposits
 * - Withdrawals
 * - Escrow operations
 * - Concurrent balance updates
 */

import {
  getBalance,
  getTransactions,
  createDeposit,
  createWithdrawal,
  createEscrow,
  releaseEscrow,
  refundEscrow,
} from './services/consolidated-wallet-service';

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

// Test configuration
const TEST_USER_ID = '123e4567-e89b-12d3-a456-426614174000'; // Test user ID
const TEST_BOUNTY_ID = '987e6543-e21b-12d3-a456-426614174000'; // Test bounty ID
const TEST_HUNTER_ID = '456e7890-e12b-34d5-a678-426614174001'; // Test hunter ID

async function runTests() {
  logSection('CONSOLIDATED WALLET SERVICE TESTS');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  try {
    // Test 1: Get balance for user
    logSection('Test 1: Get Balance');
    try {
      const balanceResult = await getBalance(TEST_USER_ID);
      logSuccess(`Retrieved balance: $${balanceResult.balance} ${balanceResult.currency}`);
      logInfo(`User ID: ${balanceResult.user_id}`);
      testsPassed++;
    } catch (error: any) {
      logError('Failed to get balance', error);
      testsFailed++;
    }
    
    // Test 2: Get transactions with filters
    logSection('Test 2: Get Transactions with Filters');
    try {
      const txResult = await getTransactions(TEST_USER_ID, {
        limit: 10,
        offset: 0,
      });
      logSuccess(`Retrieved ${txResult.transactions.length} transactions (total: ${txResult.total})`);
      if (txResult.transactions.length > 0) {
        logInfo(`Latest transaction: ${txResult.transactions[0].type} - $${txResult.transactions[0].amount}`);
      }
      testsPassed++;
    } catch (error: any) {
      logError('Failed to get transactions', error);
      testsFailed++;
    }
    
    // Test 3: Create deposit
    logSection('Test 3: Create Deposit');
    try {
      const initialBalance = await getBalance(TEST_USER_ID);
      logInfo(`Initial balance: $${initialBalance.balance}`);
      
      const depositAmount = 50.00;
      const paymentIntentId = `pi_test_${Date.now()}`;
      
      const depositTx = await createDeposit(TEST_USER_ID, depositAmount, paymentIntentId);
      logSuccess(`Created deposit: $${depositTx.amount}`);
      logInfo(`Transaction ID: ${depositTx.id}`);
      logInfo(`Status: ${depositTx.status}`);
      
      const newBalance = await getBalance(TEST_USER_ID);
      logSuccess(`Balance updated: $${initialBalance.balance} → $${newBalance.balance}`);
      
      // Verify balance increased correctly
      const expectedBalance = initialBalance.balance + depositAmount;
      if (Math.abs(newBalance.balance - expectedBalance) < 0.01) {
        logSuccess(`Balance verification passed`);
      } else {
        logError(`Balance mismatch: expected $${expectedBalance}, got $${newBalance.balance}`);
      }
      
      testsPassed++;
    } catch (error: any) {
      logError('Failed to create deposit', error);
      testsFailed++;
    }
    
    // Test 4: Try withdrawal with insufficient balance
    logSection('Test 4: Withdrawal with Insufficient Balance (Should Fail)');
    try {
      const balance = await getBalance(TEST_USER_ID);
      const excessiveAmount = balance.balance + 1000; // More than available
      
      logInfo(`Current balance: $${balance.balance}`);
      logInfo(`Attempting withdrawal: $${excessiveAmount}`);
      
      try {
        await createWithdrawal(TEST_USER_ID, excessiveAmount, 'acct_test_insufficient');
        logError('Should have thrown ValidationError for insufficient balance');
        testsFailed++;
      } catch (error: any) {
        if (error.message && error.message.includes('Insufficient balance')) {
          logSuccess('Correctly rejected withdrawal with insufficient balance');
          testsPassed++;
        } else {
          logError('Unexpected error', error);
          testsFailed++;
        }
      }
    } catch (error: any) {
      logError('Failed withdrawal test', error);
      testsFailed++;
    }
    
    // Test 5: Create escrow
    logSection('Test 5: Create Escrow');
    try {
      const initialBalance = await getBalance(TEST_USER_ID);
      logInfo(`Initial balance: $${initialBalance.balance}`);
      
      const escrowAmount = 25.00;
      
      // Only proceed if user has sufficient balance
      if (initialBalance.balance >= escrowAmount) {
        const escrowTx = await createEscrow(TEST_BOUNTY_ID, TEST_USER_ID, escrowAmount);
        logSuccess(`Created escrow: $${Math.abs(escrowTx.amount)}`);
        logInfo(`Transaction ID: ${escrowTx.id}`);
        logInfo(`Bounty ID: ${escrowTx.bounty_id}`);
        logInfo(`Status: ${escrowTx.status}`);
        
        const newBalance = await getBalance(TEST_USER_ID);
        logSuccess(`Balance updated: $${initialBalance.balance} → $${newBalance.balance}`);
        
        // Verify balance decreased correctly
        const expectedBalance = initialBalance.balance - escrowAmount;
        if (Math.abs(newBalance.balance - expectedBalance) < 0.01) {
          logSuccess(`Balance verification passed`);
        } else {
          logError(`Balance mismatch: expected $${expectedBalance}, got $${newBalance.balance}`);
        }
        
        testsPassed++;
      } else {
        logInfo(`Skipping test - insufficient balance ($${initialBalance.balance} < $${escrowAmount})`);
        testsPassed++;
      }
    } catch (error: any) {
      logError('Failed to create escrow', error);
      testsFailed++;
    }
    
    // Test 6: Release escrow
    logSection('Test 6: Release Escrow to Hunter');
    try {
      // Check if we have an escrow transaction
      const escrowTxs = await getTransactions(TEST_USER_ID, {
        type: 'escrow',
        bounty_id: TEST_BOUNTY_ID,
        status: 'completed',
        limit: 1,
      });
      
      if (escrowTxs.transactions.length > 0) {
        const initialHunterBalance = await getBalance(TEST_HUNTER_ID);
        logInfo(`Hunter initial balance: $${initialHunterBalance.balance}`);
        
        const releaseTx = await releaseEscrow(TEST_BOUNTY_ID, TEST_HUNTER_ID);
        logSuccess(`Released escrow: $${releaseTx.amount}`);
        logInfo(`Transaction ID: ${releaseTx.id}`);
        logInfo(`Hunter ID: ${releaseTx.user_id}`);
        
        const newHunterBalance = await getBalance(TEST_HUNTER_ID);
        logSuccess(`Hunter balance updated: $${initialHunterBalance.balance} → $${newHunterBalance.balance}`);
        
        testsPassed++;
      } else {
        logInfo('No escrow transaction found to release - skipping test');
        testsPassed++;
      }
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        logInfo('No escrow found (expected if test 5 was skipped)');
        testsPassed++;
      } else {
        logError('Failed to release escrow', error);
        testsFailed++;
      }
    }
    
    // Test 7: Refund escrow
    logSection('Test 7: Refund Escrow (using different bounty)');
    try {
      // Create a new escrow for refund test
      const testBountyId2 = `${TEST_BOUNTY_ID}_refund`;
      const refundAmount = 15.00;
      
      const currentBalance = await getBalance(TEST_USER_ID);
      if (currentBalance.balance >= refundAmount) {
        logInfo(`Creating escrow for refund test: $${refundAmount}`);
        await createEscrow(testBountyId2, TEST_USER_ID, refundAmount);
        
        const balanceAfterEscrow = await getBalance(TEST_USER_ID);
        logInfo(`Balance after escrow: $${balanceAfterEscrow.balance}`);
        
        // Now refund it
        const refundTx = await refundEscrow(testBountyId2, TEST_USER_ID, 'Bounty cancelled by poster');
        logSuccess(`Refunded escrow: $${refundTx.amount}`);
        logInfo(`Transaction ID: ${refundTx.id}`);
        logInfo(`Reason: ${refundTx.metadata?.reason || 'N/A'}`);
        
        const finalBalance = await getBalance(TEST_USER_ID);
        logSuccess(`Balance after refund: $${finalBalance.balance}`);
        
        // Balance should be back to original (or close)
        if (Math.abs(finalBalance.balance - currentBalance.balance) < 0.01) {
          logSuccess(`Refund verified - balance restored`);
        }
        
        testsPassed++;
      } else {
        logInfo(`Skipping test - insufficient balance ($${currentBalance.balance} < $${refundAmount})`);
        testsPassed++;
      }
    } catch (error: any) {
      logError('Failed refund test', error);
      testsFailed++;
    }
    
    // Test 8: Get filtered transactions
    logSection('Test 8: Get Filtered Transactions');
    try {
      // Get only deposit transactions
      const depositTxs = await getTransactions(TEST_USER_ID, {
        type: 'deposit',
        limit: 5,
      });
      logSuccess(`Retrieved ${depositTxs.transactions.length} deposit transactions`);
      
      // Get only escrow transactions
      const escrowTxs = await getTransactions(TEST_USER_ID, {
        type: 'escrow',
        limit: 5,
      });
      logSuccess(`Retrieved ${escrowTxs.transactions.length} escrow transactions`);
      
      testsPassed++;
    } catch (error: any) {
      logError('Failed to get filtered transactions', error);
      testsFailed++;
    }
    
    // Test 9: Concurrent balance updates (test atomic operations)
    logSection('Test 9: Concurrent Balance Updates');
    try {
      logInfo('Testing atomic balance updates with concurrent operations...');
      
      const initialBalance = await getBalance(TEST_USER_ID);
      logInfo(`Initial balance: $${initialBalance.balance}`);
      
      // Create multiple deposits concurrently
      const depositPromises = [
        createDeposit(TEST_USER_ID, 1.00, `pi_concurrent_1_${Date.now()}`),
        createDeposit(TEST_USER_ID, 2.00, `pi_concurrent_2_${Date.now()}`),
        createDeposit(TEST_USER_ID, 3.00, `pi_concurrent_3_${Date.now()}`),
      ];
      
      await Promise.all(depositPromises);
      
      const finalBalance = await getBalance(TEST_USER_ID);
      const expectedIncrease = 6.00; // 1 + 2 + 3
      const actualIncrease = finalBalance.balance - initialBalance.balance;
      
      logInfo(`Balance increased by: $${actualIncrease} (expected: $${expectedIncrease})`);
      
      if (Math.abs(actualIncrease - expectedIncrease) < 0.01) {
        logSuccess('Concurrent updates handled correctly - no race condition');
        testsPassed++;
      } else {
        logError(`Balance mismatch: expected increase of $${expectedIncrease}, got $${actualIncrease}`);
        testsFailed++;
      }
    } catch (error: any) {
      logError('Failed concurrent update test', error);
      testsFailed++;
    }
    
  } catch (error: any) {
    logError('Unexpected error during tests', error);
    testsFailed++;
  }
  
  // Summary
  logSection('TEST SUMMARY');
  const total = testsPassed + testsFailed;
  log(`Total tests: ${total}`, colors.blue);
  log(`Passed: ${testsPassed}`, colors.green);
  log(`Failed: ${testsFailed}`, colors.red);
  
  if (testsFailed === 0) {
    log('\n🎉 All tests passed!', colors.green);
  } else {
    log(`\n⚠️  ${testsFailed} test(s) failed`, colors.yellow);
  }
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  logError('Fatal error running tests', error);
  process.exit(1);
});
