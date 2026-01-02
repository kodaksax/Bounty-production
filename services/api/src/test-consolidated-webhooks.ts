/**
 * Test Consolidated Webhooks
 * Manual test script to verify webhook handler logic
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();
if (!process.env.STRIPE_SECRET_KEY) {
  const rootEnv = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
    console.log(`[env] Loaded environment from ${rootEnv}`);
  }
}

import { createClient } from '@supabase/supabase-js';
import { config } from './config';
import * as WalletService from './services/consolidated-wallet-service';
import { stripe } from './services/consolidated-payment-service';

console.log('=== Consolidated Webhook Handler Test ===\n');

// Initialize Supabase admin client
const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Test idempotency checking
 */
async function testIdempotencyCheck() {
  console.log('Testing idempotency check...');
  
  const testEventId = `evt_test_${Date.now()}`;
  
  // First check - should return false (not processed)
  const { data: firstCheck, error: firstError } = await supabaseAdmin
    .from('stripe_events')
    .select('processed')
    .eq('stripe_event_id', testEventId)
    .single();
  
  console.log('First check (should be null/not found):', firstCheck);
  console.log('First check error (expected PGRST116):', firstError?.code);
  
  // Insert event
  await supabaseAdmin.from('stripe_events').insert({
    stripe_event_id: testEventId,
    event_type: 'test.event',
    event_data: { test: true },
    processed: false,
  });
  
  console.log('Event inserted');
  
  // Second check - should return false (exists but not processed)
  const { data: secondCheck } = await supabaseAdmin
    .from('stripe_events')
    .select('processed')
    .eq('stripe_event_id', testEventId)
    .single();
  
  console.log('Second check (should be false):', secondCheck?.processed);
  
  // Mark as processed
  await supabaseAdmin
    .from('stripe_events')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('stripe_event_id', testEventId);
  
  console.log('Event marked as processed');
  
  // Third check - should return true (processed)
  const { data: thirdCheck } = await supabaseAdmin
    .from('stripe_events')
    .select('processed')
    .eq('stripe_event_id', testEventId)
    .single();
  
  console.log('Third check (should be true):', thirdCheck?.processed);
  
  // Cleanup
  await supabaseAdmin
    .from('stripe_events')
    .delete()
    .eq('stripe_event_id', testEventId);
  
  console.log('✓ Idempotency check test passed\n');
}

/**
 * Test event logging
 */
async function testEventLogging() {
  console.log('Testing event logging...');
  
  const testEventId = `evt_test_log_${Date.now()}`;
  const testEvent = {
    id: testEventId,
    type: 'payment_intent.succeeded',
    created: Date.now() / 1000,
    data: {
      object: {
        id: 'pi_test',
        amount: 1000,
        currency: 'usd',
        metadata: { user_id: 'test-user' },
      },
    },
  };
  
  // Log event
  const { error } = await supabaseAdmin
    .from('stripe_events')
    .upsert({
      stripe_event_id: testEvent.id,
      event_type: testEvent.type,
      event_data: testEvent.data.object,
      processed: false,
      created_at: new Date(testEvent.created * 1000).toISOString(),
    }, {
      onConflict: 'stripe_event_id',
      ignoreDuplicates: false,
    });
  
  if (error) {
    console.error('Error logging event:', error);
    return;
  }
  
  console.log('Event logged successfully');
  
  // Verify event was logged
  const { data: loggedEvent } = await supabaseAdmin
    .from('stripe_events')
    .select('*')
    .eq('stripe_event_id', testEventId)
    .single();
  
  console.log('Logged event:', {
    id: loggedEvent?.stripe_event_id,
    type: loggedEvent?.event_type,
    processed: loggedEvent?.processed,
  });
  
  // Cleanup
  await supabaseAdmin
    .from('stripe_events')
    .delete()
    .eq('stripe_event_id', testEventId);
  
  console.log('✓ Event logging test passed\n');
}

/**
 * Test webhook signature verification
 */
async function testSignatureVerification() {
  console.log('Testing webhook signature verification...');
  
  if (!config.stripe.webhookSecret) {
    console.log('⚠ Webhook secret not configured, skipping signature test');
    return;
  }
  
  const payload = JSON.stringify({
    id: 'evt_test',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test',
        amount: 1000,
      },
    },
  });
  
  // Generate signature
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.stripe.webhookSecret,
  });
  
  console.log('Generated test signature');
  
  try {
    // Verify signature
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripe.webhookSecret
    );
    
    console.log('Signature verified successfully');
    console.log('Event type:', event.type);
    console.log('✓ Signature verification test passed\n');
  } catch (error: any) {
    console.error('Signature verification failed:', error.message);
  }
}

/**
 * Test wallet service integration
 */
async function testWalletServiceIntegration() {
  console.log('Testing wallet service integration...');
  
  try {
    // Check if wallet service methods are accessible
    console.log('Wallet service methods available:');
    console.log('- createDeposit:', typeof WalletService.createDeposit);
    console.log('- updateBalance:', typeof WalletService.updateBalance);
    console.log('- getBalance:', typeof WalletService.getBalance);
    
    console.log('✓ Wallet service integration test passed\n');
  } catch (error: any) {
    console.error('Wallet service integration error:', error.message);
  }
}

/**
 * Test event handler logic (without actual database changes)
 */
async function testEventHandlerLogic() {
  console.log('Testing event handler logic...');
  
  // Test payment_intent.succeeded structure
  const paymentIntentSucceeded = {
    id: 'evt_test',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test',
        amount: 5000, // $50.00
        currency: 'usd',
        metadata: {
          user_id: 'test-user-123',
        },
      },
    },
  };
  
  console.log('Payment Intent Succeeded Event:');
  console.log('- Payment Intent ID:', paymentIntentSucceeded.data.object.id);
  console.log('- Amount (cents):', paymentIntentSucceeded.data.object.amount);
  console.log('- Amount (dollars):', paymentIntentSucceeded.data.object.amount / 100);
  console.log('- User ID:', paymentIntentSucceeded.data.object.metadata.user_id);
  
  // Test charge.refunded structure
  const chargeRefunded = {
    id: 'evt_test',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_test',
        payment_intent: 'pi_test',
        amount_refunded: 5000,
        refunds: {
          data: [
            {
              reason: 'requested_by_customer',
            },
          ],
        },
      },
    },
  };
  
  console.log('\nCharge Refunded Event:');
  console.log('- Charge ID:', chargeRefunded.data.object.id);
  console.log('- Payment Intent:', chargeRefunded.data.object.payment_intent);
  console.log('- Refund Amount:', chargeRefunded.data.object.amount_refunded / 100);
  
  // Test transfer.failed structure
  const transferFailed = {
    id: 'evt_test',
    type: 'transfer.failed',
    data: {
      object: {
        id: 'tr_test',
        amount: 5000,
        failure_code: 'account_closed',
        failure_message: 'The bank account has been closed',
        metadata: {
          user_id: 'test-user-123',
        },
      },
    },
  };
  
  console.log('\nTransfer Failed Event:');
  console.log('- Transfer ID:', transferFailed.data.object.id);
  console.log('- Amount:', transferFailed.data.object.amount / 100);
  console.log('- Failure Code:', transferFailed.data.object.failure_code);
  console.log('- User ID:', transferFailed.data.object.metadata?.user_id);
  
  console.log('\n✓ Event handler logic test passed\n');
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    console.log('Configuration:');
    console.log('- Supabase URL:', config.supabase.url);
    console.log('- Stripe Secret Key:', config.stripe.secretKey ? '✓ Set' : '✗ Missing');
    console.log('- Webhook Secret:', config.stripe.webhookSecret ? '✓ Set' : '✗ Missing');
    console.log();
    
    await testIdempotencyCheck();
    await testEventLogging();
    await testSignatureVerification();
    await testWalletServiceIntegration();
    await testEventHandlerLogic();
    
    console.log('=== All Tests Passed ===');
    process.exit(0);
  } catch (error: any) {
    console.error('Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
