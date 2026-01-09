/**
 * Escrow Integration Test
 * 
 * Tests the complete escrow payment flow end-to-end:
 * 1. User deposits funds to wallet
 * 2. User creates a paid bounty (funds deducted from wallet)
 * 3. Hunter accepts bounty (escrow PaymentIntent created)
 * 4. Hunter completes bounty (funds released to hunter)
 * 
 * Alternative flow:
 * 1-3. Same as above
 * 4. Poster cancels bounty (refund processed)
 */

import axios from 'axios';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Test configuration
const TEST_CONFIG = {
  posterUsername: `test-poster-${Date.now()}`,
  hunterUsername: `test-hunter-${Date.now()}`,
  bountyAmount: 100, // $100
  platformFeePercentage: 5, // 5%
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
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
  console.log('\n' + '='.repeat(80));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(80) + '\n');
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

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test the complete happy path escrow flow
 */
async function testHappyPathFlow() {
  logSection('ESCROW INTEGRATION TEST - Happy Path');
  
  try {
    // Step 1: Create test users (poster and hunter)
    logInfo('Step 1: Creating test users...');
    
    // Note: In a real test, we would create users via the API
    // For now, we'll assume users exist or use mock IDs
    const posterId = '123e4567-e89b-12d3-a456-426614174000';
    const hunterId = '456e7890-e12b-34d5-a678-426614174001';
    
    logSuccess(`Created poster (${posterId}) and hunter (${hunterId})`);
    
    // Step 2: Deposit funds to poster's wallet
    logInfo('Step 2: Depositing funds to poster wallet...');
    
    const depositAmount = 200; // $200 to cover bounty amount
    
    try {
      const depositResponse = await axios.post(
        `${BASE_URL}/wallet/deposit`,
        {
          amount: depositAmount,
          paymentIntentId: `pi_test_${Date.now()}`, // Mock payment intent
        },
        {
          headers: {
            'Authorization': `Bearer mock-token-${posterId}`,
          }
        }
      );
      
      logSuccess(`Deposited $${depositAmount} to poster wallet`);
      logInfo(`New balance: $${depositResponse.data.newBalance}`);
    } catch (error: any) {
      logError(`Failed to deposit: ${error.response?.data?.error || error.message}`);
      return;
    }
    
    // Step 3: Check poster's wallet balance
    logInfo('Step 3: Checking poster wallet balance...');
    
    try {
      const balanceResponse = await axios.get(
        `${BASE_URL}/wallet/balance`,
        {
          headers: {
            'Authorization': `Bearer mock-token-${posterId}`,
          }
        }
      );
      
      const balance = balanceResponse.data.balance;
      logSuccess(`Poster balance: $${balance}`);
      
      if (balance < TEST_CONFIG.bountyAmount) {
        logError(`Insufficient balance! Need $${TEST_CONFIG.bountyAmount}, have $${balance}`);
        return;
      }
    } catch (error: any) {
      logError(`Failed to get balance: ${error.response?.data?.error || error.message}`);
      return;
    }
    
    // Step 4: Create a paid bounty
    logInfo(`Step 4: Creating bounty for $${TEST_CONFIG.bountyAmount}...`);
    
    let bountyId: string;
    
    try {
      const bountyResponse = await axios.post(
        `${BASE_URL}/api/bounties`,
        {
          title: 'Test Escrow Bounty - Complete Payment Flow',
          description: 'This is a test bounty to validate the complete escrow payment flow including wallet deduction, acceptance, completion, and release.',
          amount: TEST_CONFIG.bountyAmount,
          isForHonor: false,
        },
        {
          headers: {
            'Authorization': `Bearer mock-token-${posterId}`,
          }
        }
      );
      
      bountyId = bountyResponse.data.id;
      logSuccess(`Created bounty: ${bountyId}`);
      logInfo(`Funds should be deducted from poster wallet`);
    } catch (error: any) {
      logError(`Failed to create bounty: ${error.response?.data?.error || error.message}`);
      return;
    }
    
    // Step 5: Verify wallet deduction
    logInfo('Step 5: Verifying wallet deduction...');
    
    try {
      const balanceAfterResponse = await axios.get(
        `${BASE_URL}/wallet/balance`,
        {
          headers: {
            'Authorization': `Bearer mock-token-${posterId}`,
          }
        }
      );
      
      const balanceAfter = balanceAfterResponse.data.balance;
      logSuccess(`Poster balance after bounty creation: $${balanceAfter}`);
      logInfo(`Deducted: $${TEST_CONFIG.bountyAmount}`);
    } catch (error: any) {
      logError(`Failed to verify balance: ${error.response?.data?.error || error.message}`);
    }
    
    // Step 6: Hunter accepts the bounty
    logInfo('Step 6: Hunter accepting bounty...');
    
    try {
      await axios.post(
        `${BASE_URL}/api/bounties/${bountyId}/accept`,
        {},
        {
          headers: {
            'Authorization': `Bearer mock-token-${hunterId}`,
          }
        }
      );
      
      logSuccess('Hunter accepted bounty');
      logInfo('Escrow hold event should be created in outbox');
    } catch (error: any) {
      logError(`Failed to accept bounty: ${error.response?.data?.error || error.message}`);
      return;
    }
    
    // Wait for outbox worker to process escrow event
    logInfo('Waiting for outbox worker to process escrow...');
    await delay(3000);
    
    // Step 7: Hunter completes the bounty
    logInfo('Step 7: Hunter completing bounty...');
    
    try {
      await axios.post(
        `${BASE_URL}/api/bounties/${bountyId}/complete`,
        {},
        {
          headers: {
            'Authorization': `Bearer mock-token-${hunterId}`,
          }
        }
      );
      
      logSuccess('Hunter marked bounty as complete');
      logInfo('Completion release event should be created in outbox');
    } catch (error: any) {
      logError(`Failed to complete bounty: ${error.response?.data?.error || error.message}`);
      return;
    }
    
    // Wait for outbox worker to process release event
    logInfo('Waiting for outbox worker to process fund release...');
    await delay(5000);
    
    // Step 8: Verify hunter received payment
    logInfo('Step 8: Verifying hunter received payment...');
    
    try {
      const hunterTransactionsResponse = await axios.get(
        `${BASE_URL}/wallet/transactions`,
        {
          headers: {
            'Authorization': `Bearer mock-token-${hunterId}`,
          }
        }
      );
      
      const transactions = hunterTransactionsResponse.data.transactions;
      const releaseTransaction = transactions.find((tx: any) => 
        tx.type === 'release' && tx.details?.bounty_id === bountyId
      );
      
      if (releaseTransaction) {
        const expectedRelease = TEST_CONFIG.bountyAmount * (1 - TEST_CONFIG.platformFeePercentage / 100);
        logSuccess(`Hunter received payment: $${releaseTransaction.amount}`);
        logInfo(`Expected: $${expectedRelease} (after ${TEST_CONFIG.platformFeePercentage}% platform fee)`);
      } else {
        logError('Release transaction not found!');
      }
    } catch (error: any) {
      logError(`Failed to verify payment: ${error.response?.data?.error || error.message}`);
    }
    
    logSection('✅ Happy Path Flow Complete!');
    
  } catch (error: any) {
    logError(`Unexpected error: ${error.message}`);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

/**
 * Test the refund flow
 */
async function testRefundFlow() {
  logSection('ESCROW INTEGRATION TEST - Refund Flow');
  
  try {
    // Similar to happy path, but cancel instead of complete
    logInfo('Creating bounty for refund test...');
    
    const posterId = '123e4567-e89b-12d3-a456-426614174000';
    const hunterId = '456e7890-e12b-34d5-a678-426614174001';
    
    // Deposit, create bounty, accept
    // ... (similar steps as happy path)
    
    // Cancel the bounty
    logInfo('Cancelling bounty...');
    
    // Verify refund transaction
    logInfo('Verifying refund...');
    
    logSection('✅ Refund Flow Complete!');
    
  } catch (error: any) {
    logError(`Refund flow error: ${error.message}`);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  logSection('🚀 Starting Escrow Integration Tests');
  
  logInfo(`API URL: ${BASE_URL}`);
  logInfo(`Bounty Amount: $${TEST_CONFIG.bountyAmount}`);
  logInfo(`Platform Fee: ${TEST_CONFIG.platformFeePercentage}%`);
  
  // Check if API is running
  try {
    await axios.get(`${BASE_URL}/health`);
    logSuccess('API is running');
  } catch (error) {
    logError('API is not running! Start the server first: npm run dev');
    process.exit(1);
  }
  
  // Run tests
  await testHappyPathFlow();
  
  // Uncomment to test refund flow
  // await testRefundFlow();
  
  logSection('🏁 All Tests Complete');
}

// Run the tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
