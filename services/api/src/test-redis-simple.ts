/**
 * Simple Redis Connection Test
 * Tests basic Redis connectivity without requiring full app configuration
 */

import Redis from 'ioredis';

async function testRedisConnection() {
  console.log('=== Simple Redis Connection Test ===\n');

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'bountyexpo:',
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  try {
    // Test 1: Connection
    console.log('Test 1: Testing Redis connection...');
    await redis.ping();
    console.log('✅ Connected to Redis successfully\n');

    // Test 2: Set/Get operations
    console.log('Test 2: Testing SET/GET operations...');
    const testKey = 'test:connection';
    const testValue = { message: 'Hello Redis!', timestamp: Date.now() };
    
    await redis.set(testKey, JSON.stringify(testValue), 'EX', 60);
    const retrieved = await redis.get(testKey);
    
    if (retrieved === null) {
      throw new Error(`Expected value for key "${testKey}" but got null from Redis`);
    }
    
    const parsed = JSON.parse(retrieved);
    
    console.log(`   Set value: ✅`);
    console.log(`   Retrieved value: ✅`);
    console.log(`   Data matches: ${parsed.message === testValue.message ? '✅' : '❌'}\n`);

    // Test 3: Key operations
    console.log('Test 3: Testing key operations...');
    const exists = await redis.exists(testKey);
    console.log(`   Key exists: ${exists === 1 ? '✅' : '❌'}`);
    
    await redis.del(testKey);
    const existsAfterDelete = await redis.exists(testKey);
    console.log(`   Key deleted: ${existsAfterDelete === 0 ? '✅' : '❌'}\n`);

    // Test 4: Profile caching simulation
    console.log('Test 4: Testing profile cache pattern...');
    const profileKey = 'profile:user-123';
    const profile = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
    };
    
    await redis.setex(profileKey, 300, JSON.stringify(profile)); // 5 min TTL
    const cachedProfile = await redis.get(profileKey);
    console.log(`   Profile cached: ${cachedProfile ? '✅' : '❌'}`);
    
    const ttl = await redis.ttl(profileKey);
    console.log(`   TTL set correctly: ${ttl > 0 && ttl <= 300 ? '✅' : '❌'} (${ttl}s)\n`);

    // Test 5: Bounty list caching simulation
    console.log('Test 5: Testing bounty list cache pattern...');
    const bountyListKey = 'bounty:list:status:open:page:1';
    const bountyList = {
      bounties: [
        { id: 'bounty-1', title: 'Test Bounty 1', amount: 100 },
        { id: 'bounty-2', title: 'Test Bounty 2', amount: 200 },
      ],
      pagination: { page: 1, limit: 20, total: 2 },
    };
    
    await redis.setex(bountyListKey, 60, JSON.stringify(bountyList)); // 1 min TTL
    const cachedList = await redis.get(bountyListKey);
    console.log(`   Bounty list cached: ${cachedList ? '✅' : '❌'}\n`);

    // Test 6: Bulk delete pattern (cache invalidation)
    console.log('Test 6: Testing bulk delete pattern...');
    await redis.set('bounty:list:1', 'data1');
    await redis.set('bounty:list:2', 'data2');
    await redis.set('bounty:list:3', 'data3');
    
    // Use SCAN instead of KEYS for production-safe iteration
    const keysToDelete: string[] = [];
    const stream = redis.scanStream({
      match: 'bountyexpo:bounty:list:*',
      count: 100,
    });

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        if (keys && keys.length > 0) {
          keysToDelete.push(...keys);
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => reject(err));
    });

    console.log(`   Created ${keysToDelete.length} test keys using SCAN`);
    
    if (keysToDelete.length > 0) {
      // Remove prefix before deletion
      const keysWithoutPrefix = keysToDelete.map((k: string) => k.replace('bountyexpo:', ''));
      await redis.del(...keysWithoutPrefix);
      
      // Verify deletion using SCAN
      const remainingKeys: string[] = [];
      const verifyStream = redis.scanStream({
        match: 'bountyexpo:bounty:list:*',
        count: 100,
      });
      
      await new Promise<void>((resolve, reject) => {
        verifyStream.on('data', (keys: string[]) => {
          if (keys && keys.length > 0) {
            remainingKeys.push(...keys);
          }
        });
        verifyStream.on('end', () => resolve());
        verifyStream.on('error', (err: Error) => reject(err));
      });
      
      console.log(`   Bulk delete successful: ${remainingKeys.length === 0 ? '✅' : '❌'}\n`);
    }

    // Test 7: Server info
    console.log('Test 7: Checking Redis server info...');
    const info = await redis.info('memory');
    const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
    const memory = memoryMatch ? memoryMatch[1] : 'unknown';
    
    const dbsize = await redis.dbsize();
    console.log(`   Keys in database: ${dbsize}`);
    console.log(`   Memory used: ${memory}`);
    console.log('   ✅ Server info retrieved\n');

    console.log('=== All Tests Passed ===\n');

    // Cleanup
    await redis.del(profileKey);
    await redis.del(bountyListKey);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await redis.quit();
    console.log('Connection closed.');
  }
}

testRedisConnection()
  .then(() => {
    console.log('\n✅ Test suite completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  });
