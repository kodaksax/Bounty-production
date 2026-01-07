/**
 * Redis Integration Test Script
 * Tests Redis connection, caching operations, and cache invalidation
 */

import redisService, { CacheKeyPrefix, cacheInvalidation } from './services/redis-service';

interface TestProfile {
  id: string;
  username: string;
  email: string;
}

interface TestBounty {
  id: string;
  title: string;
  amount: number;
  status: string;
}

async function runTests() {
  console.log('=== Redis Integration Tests ===\n');

  try {
    // Test 1: Basic connection
    console.log('Test 1: Checking Redis connection...');
    const stats = await redisService.getStats();
    if (stats) {
      console.log('✅ Redis connected successfully');
      console.log(`   Keys in database: ${stats.keys}`);
      console.log(`   Memory used: ${stats.memory}\n`);
    } else {
      console.log('❌ Redis not available\n');
      return;
    }

    // Test 2: Profile caching
    console.log('Test 2: Testing profile caching...');
    const testProfile: TestProfile = {
      id: 'test-profile-123',
      username: 'testuser',
      email: 'test@example.com',
    };

    // Set profile in cache
    const setResult = await redisService.set(
      testProfile.id,
      testProfile,
      CacheKeyPrefix.PROFILE
    );
    console.log(`   Set profile: ${setResult ? '✅' : '❌'}`);

    // Get profile from cache
    const cachedProfile = await redisService.get<TestProfile>(
      testProfile.id,
      CacheKeyPrefix.PROFILE
    );
    const profileMatch = cachedProfile?.username === testProfile.username;
    console.log(`   Retrieved profile: ${cachedProfile ? '✅' : '❌'}`);
    console.log(`   Data matches: ${profileMatch ? '✅' : '❌'}\n`);

    // Test 3: Profile cache invalidation
    console.log('Test 3: Testing profile cache invalidation...');
    await cacheInvalidation.invalidateProfile(testProfile.id);
    const profileAfterInvalidation = await redisService.get<TestProfile>(
      testProfile.id,
      CacheKeyPrefix.PROFILE
    );
    console.log(`   Profile invalidated: ${!profileAfterInvalidation ? '✅' : '❌'}\n`);

    // Test 4: Bounty caching
    console.log('Test 4: Testing bounty caching...');
    const testBounty: TestBounty = {
      id: 'test-bounty-456',
      title: 'Test Bounty',
      amount: 100,
      status: 'open',
    };

    await redisService.set(
      testBounty.id,
      testBounty,
      CacheKeyPrefix.BOUNTY
    );
    const cachedBounty = await redisService.get<TestBounty>(
      testBounty.id,
      CacheKeyPrefix.BOUNTY
    );
    const bountyMatch = cachedBounty?.title === testBounty.title;
    console.log(`   Set & retrieved bounty: ${bountyMatch ? '✅' : '❌'}\n`);

    // Test 5: Bounty list caching
    console.log('Test 5: Testing bounty list caching...');
    const bountyList = {
      bounties: [testBounty],
      pagination: { page: 1, limit: 20, total: 1 },
    };
    const listKey = 'status:open:cat:all:user:all:accepted:all:page:1:limit:20:sort:created_at:desc';
    
    await redisService.set(
      listKey,
      bountyList,
      CacheKeyPrefix.BOUNTY_LIST
    );
    const cachedList = await redisService.get<any>(
      listKey,
      CacheKeyPrefix.BOUNTY_LIST
    );
    console.log(`   Set & retrieved bounty list: ${cachedList ? '✅' : '❌'}\n`);

    // Test 6: Bulk invalidation
    console.log('Test 6: Testing bulk cache invalidation...');
    
    // Add multiple bounty list cache entries
    await redisService.set('list-1', { test: 1 }, CacheKeyPrefix.BOUNTY_LIST);
    await redisService.set('list-2', { test: 2 }, CacheKeyPrefix.BOUNTY_LIST);
    await redisService.set('list-3', { test: 3 }, CacheKeyPrefix.BOUNTY_LIST);
    
    await cacheInvalidation.invalidateBountyLists();
    
    // Verify all were deleted
    const list1 = await redisService.get('list-1', CacheKeyPrefix.BOUNTY_LIST);
    const list2 = await redisService.get('list-2', CacheKeyPrefix.BOUNTY_LIST);
    const list3 = await redisService.get('list-3', CacheKeyPrefix.BOUNTY_LIST);
    const allDeleted = !list1 && !list2 && !list3;
    console.log(`   Invalidated bounty list entries: ${allDeleted ? '✅' : '❌'}\n`);

    // Test 7: TTL verification
    console.log('Test 7: Testing TTL settings...');
    await redisService.set('ttl-test', { data: 'test' }, CacheKeyPrefix.PROFILE);
    const exists = await redisService.exists('ttl-test', CacheKeyPrefix.PROFILE);
    console.log(`   Key created with TTL: ${exists ? '✅' : '❌'}\n`);

    // Test 8: Cache stats after operations
    console.log('Test 8: Final cache statistics...');
    const finalStats = await redisService.getStats();
    if (finalStats) {
      console.log(`   Keys in cache: ${finalStats.keys}`);
      console.log(`   Memory used: ${finalStats.memory}`);
      console.log('   ✅ Stats retrieved successfully\n');
    }

    console.log('=== All Tests Completed ===\n');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    // Cleanup
    console.log('Cleaning up test data...');
    await redisService.del('test-profile-123', CacheKeyPrefix.PROFILE);
    await redisService.del('test-bounty-456', CacheKeyPrefix.BOUNTY);
    await redisService.del('ttl-test', CacheKeyPrefix.PROFILE);
    await redisService.delPattern('*', CacheKeyPrefix.BOUNTY_LIST);
    
    // Close Redis connection
    await redisService.close();
    console.log('✅ Cleanup complete\n');
  }
}

// Run tests
runTests()
  .then(() => {
    console.log('Test suite finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
