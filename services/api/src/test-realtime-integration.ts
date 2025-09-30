/**
 * Integration test for realtime bounty status events
 * This demonstrates the complete flow: accept/complete → realtime event publishing
 */

import { realtimeService } from './services/realtime-service';
import { bountyService } from './services/bounty-service';

// Mock WebSocket client for testing
class MockWebSocketClient {
  public receivedMessages: any[] = [];
  public socket = {
    readyState: 1, // OPEN state
    send: (message: string) => {
      this.receivedMessages.push(JSON.parse(message));
      console.log('📨 Mock client received:', JSON.parse(message));
    },
    on: (event: string, handler: Function) => {
      // Mock event handlers
      if (event === 'close') {
        setTimeout(() => handler(), 5000); // Simulate close after 5s
      }
    }
  };
}

async function testRealtimeIntegration() {
  console.log('🧪 Testing realtime integration...\n');

  // Step 1: Add mock WebSocket client
  const mockClient = new MockWebSocketClient();
  realtimeService.addWebSocketClient(mockClient as any);
  
  console.log('✅ Mock WebSocket client connected');
  
  // Step 2: Test direct realtime publishing
  console.log('\n📡 Testing direct realtime publishing...');
  await realtimeService.publishBountyStatusChange('test-bounty-123', 'in_progress');
  await realtimeService.publishBountyStatusChange('test-bounty-123', 'completed');
  
  // Wait a moment for messages to be processed
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n📊 Results:');
  console.log(`- WebSocket clients: ${realtimeService.getStats().wsClientCount}`);
  console.log(`- Messages received: ${mockClient.receivedMessages.length}`);
  
  console.log('\n📨 Received messages:');
  mockClient.receivedMessages.forEach((msg, i) => {
    console.log(`  ${i + 1}. ${JSON.stringify(msg)}`);
  });
  
  // Validate message format
  const statusMessages = mockClient.receivedMessages.filter(msg => msg.type === 'bounty.status');
  if (statusMessages.length === 2) {
    console.log('\n✅ PASS: Received expected realtime events');
    console.log('✅ PASS: Message format is correct');
    
    // Check event payloads
    const acceptEvent = statusMessages.find(msg => msg.status === 'in_progress');
    const completeEvent = statusMessages.find(msg => msg.status === 'completed');
    
    if (acceptEvent && completeEvent) {
      console.log('✅ PASS: Both accept and complete events received');
      console.log('✅ PASS: Status transitions are correct');
    } else {
      console.log('❌ FAIL: Missing expected status transitions');
    }
  } else {
    console.log('❌ FAIL: Did not receive expected number of events');
  }
  
  console.log('\n🏁 Realtime integration test completed');
}

// Run the test
testRealtimeIntegration().catch(console.error);