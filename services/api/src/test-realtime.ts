import { realtimeService } from './services/realtime-service';

// Test realtime publishing
async function testRealtimePublishing() {
  console.log('🧪 Testing realtime publishing...');

  // Test publishing a bounty status change
  await realtimeService.publishBountyStatusChange('test-bounty-123', 'in_progress');
  
  // Test stats
  const stats = realtimeService.getStats();
  console.log('📊 Realtime service stats:', stats);
  
  console.log('✅ Realtime publishing test completed');
}

testRealtimePublishing().catch(console.error);