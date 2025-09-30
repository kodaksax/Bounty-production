import { completionReleaseService } from './services/completion-release-service';
import { outboxService } from './services/outbox-service';
import { outboxWorker } from './services/outbox-worker';
import { db } from './db/connection';
import { users, bounties, walletTransactions } from './db/schema';
import { eq } from 'drizzle-orm';

async function testCompletionRelease() {
  console.log('🧪 Testing Completion Release Functionality\n');

  try {
    // 1. Create test users
    console.log('1️⃣ Creating test users...');
    
    const creator = await db.insert(users).values({
      handle: 'bounty_creator',
      stripe_account_id: 'acct_creator_test_123',
    }).returning();

    const hunter = await db.insert(users).values({
      handle: 'bounty_hunter',
      stripe_account_id: 'acct_hunter_test_456',
    }).returning();

    console.log(`✅ Created creator: ${creator[0].id} and hunter: ${hunter[0].id}`);

    // 2. Create test bounty
    console.log('\n2️⃣ Creating test bounty...');
    
    const bounty = await db.insert(bounties).values({
      creator_id: creator[0].id,
      hunter_id: hunter[0].id,
      title: 'Test Completion Release Bounty',
      description: 'A test bounty for completion release functionality',
      amount_cents: 10000, // $100
      status: 'in_progress',
      payment_intent_id: 'pi_test_payment_intent_123',
    }).returning();

    console.log(`✅ Created bounty: ${bounty[0].id} with amount $100`);

    // 3. Test completion release
    console.log('\n3️⃣ Testing completion release...');
    
    const releaseResult = await completionReleaseService.processCompletionRelease({
      bountyId: bounty[0].id,
      hunterId: hunter[0].id,
      paymentIntentId: 'pi_test_payment_intent_123',
      platformFeePercentage: 5, // 5%
    });

    console.log('Release result:', releaseResult);

    if (releaseResult.success) {
      console.log(`✅ Completion release successful!`);
      console.log(`💰 Release amount: $${releaseResult.releaseAmount}`);
      console.log(`💳 Platform fee: $${releaseResult.platformFee}`);
      console.log(`🔗 Transfer ID: ${releaseResult.transferId}`);
    } else {
      console.log(`❌ Completion release failed: ${releaseResult.error}`);
    }

    // 4. Test double release prevention
    console.log('\n4️⃣ Testing double release prevention...');
    
    const doubleReleaseResult = await completionReleaseService.processCompletionRelease({
      bountyId: bounty[0].id,
      hunterId: hunter[0].id,
      paymentIntentId: 'pi_test_payment_intent_123',
    });

    if (!doubleReleaseResult.success && doubleReleaseResult.error?.includes('already processed')) {
      console.log('✅ Double release prevention working correctly');
    } else {
      console.log('❌ Double release prevention failed');
    }

    // 5. Check wallet transactions
    console.log('\n5️⃣ Checking wallet transactions...');
    
    const transactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.bounty_id, bounty[0].id));

    console.log(`Found ${transactions.length} wallet transactions:`);
    transactions.forEach(tx => {
      console.log(`  - ${tx.type}: $${tx.amount_cents / 100} (${tx.user_id === 'platform' ? 'Platform' : 'Hunter'})`);
    });

    // 6. Test outbox event creation and processing
    console.log('\n6️⃣ Testing outbox event processing...');
    
    // Create an outbox event for retry scenario
    const outboxEvent = await outboxService.createEvent({
      type: 'COMPLETION_RELEASE',
      payload: {
        bountyId: 'test_bounty_outbox',
        hunterId: hunter[0].id,
        paymentIntentId: 'pi_test_outbox_123',
        title: 'Test Outbox Bounty',
      },
    });

    console.log(`✅ Created outbox event: ${outboxEvent.id}`);

    // 7. Test status check
    console.log('\n7️⃣ Testing status checks...');
    
    const isReleased = await completionReleaseService.isAlreadyReleased(bounty[0].id);
    const releaseTransaction = await completionReleaseService.getReleaseTransaction(bounty[0].id);

    console.log(`Is bounty released: ${isReleased}`);
    console.log(`Release transaction:`, releaseTransaction ? {
      id: releaseTransaction.id,
      amount: releaseTransaction.amount_cents / 100,
      stripe_transfer_id: releaseTransaction.stripe_transfer_id,
    } : 'None');

    console.log('\n🎉 All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
if (require.main === module) {
  testCompletionRelease().then(() => {
    console.log('\n✅ Test script completed');
    process.exit(0);
  }).catch((error) => {
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
  });
}

export { testCompletionRelease };