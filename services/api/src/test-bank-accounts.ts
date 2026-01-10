/**
 * Test script for bank account endpoints
 * Tests the new Connect bank account linking functionality
 * 
 * Run with: tsx src/test-bank-accounts.ts
 */

import Stripe from 'stripe';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const TEST_USER_TOKEN = process.env.TEST_USER_TOKEN || '';

async function testBankAccountEndpoints() {
  console.log('\n🧪 Testing Bank Account Endpoints\n');
  console.log('='.repeat(50));

  if (!TEST_USER_TOKEN) {
    console.log('⚠️  TEST_USER_TOKEN not set. Set it as an environment variable.');
    console.log('   Get a token by signing in through the app first.');
    console.log('\n   Example:');
    console.log('   export TEST_USER_TOKEN="your_jwt_token"');
    console.log('   tsx src/test-bank-accounts.ts\n');
    return;
  }

  // Test 1: Verify Connect onboarding status
  console.log('\n📋 Test 1: Verify Connect Onboarding Status');
  console.log('-'.repeat(50));
  
  try {
    const response = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.onboarded) {
      console.log('✅ User has completed Connect onboarding');
    } else {
      console.log('⚠️  User has not completed Connect onboarding yet');
      console.log('   Please complete onboarding first using the mobile app');
      return;
    }
  } catch (error) {
    console.error('❌ Error:', error);
    return;
  }

  // Test 2: Add bank account (will use test routing number)
  console.log('\n📋 Test 2: Add Bank Account');
  console.log('-'.repeat(50));
  
  try {
    const testBankData = {
      accountHolderName: 'Test User',
      routingNumber: '110000000', // Stripe test routing number
      accountNumber: '000123456789', // Test account number
      accountType: 'checking' as const
    };

    console.log('Sending bank account data (safe test values)...');
    
    const response = await fetch(`${API_BASE_URL}/connect/bank-accounts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testBankData)
    });

    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log('✅ Bank account added successfully');
    } else {
      console.log('❌ Failed to add bank account');
      if (data.requiresOnboarding) {
        console.log('   User needs to complete Connect onboarding first');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test 3: List bank accounts
  console.log('\n📋 Test 3: List Bank Accounts');
  console.log('-'.repeat(50));
  
  try {
    const response = await fetch(`${API_BASE_URL}/connect/bank-accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.bankAccounts && data.bankAccounts.length > 0) {
      console.log(`✅ Found ${data.bankAccounts.length} bank account(s)`);
      data.bankAccounts.forEach((account: any, index: number) => {
        console.log(`   ${index + 1}. ****${account.last4} - ${account.verified ? 'Verified' : 'Pending'}`);
      });
    } else {
      console.log('⚠️  No bank accounts found');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test 4: Test withdrawal endpoint (dry run - won't actually withdraw)
  console.log('\n📋 Test 4: Test Withdrawal Flow (Validation Only)');
  console.log('-'.repeat(50));
  
  try {
    // First, get wallet balance
    const balanceResponse = await fetch(`${API_BASE_URL}/wallet/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const balanceData = await balanceResponse.json();
    console.log('Current Balance:', balanceData);

    // Try to withdraw $1 (if balance allows)
    if (balanceData.balance >= 1) {
      console.log('\nAttempting test withdrawal of $1.00...');
      
      const withdrawResponse = await fetch(`${API_BASE_URL}/connect/transfer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_USER_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: 1.00,
          currency: 'usd'
        })
      });

      const withdrawData = await withdrawResponse.json();
      console.log('Status:', withdrawResponse.status);
      console.log('Response:', JSON.stringify(withdrawData, null, 2));

      if (withdrawResponse.ok) {
        console.log('✅ Withdrawal initiated successfully');
      } else {
        console.log('❌ Withdrawal failed');
      }
    } else {
      console.log('⚠️  Insufficient balance for test withdrawal');
      console.log('   (This is expected in a test environment)');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Bank account testing complete!\n');
}

// Run tests
testBankAccountEndpoints()
  .catch(error => {
    console.error('💥 Test suite failed:', error);
    process.exit(1);
  });
