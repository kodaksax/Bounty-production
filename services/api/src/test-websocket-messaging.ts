/**
 * WebSocket Messaging Integration Test
 * 
 * This script tests the WebSocket messaging endpoints and functionality.
 * Run with: tsx src/test-websocket-messaging.ts
 */

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3001';
const WS_URL = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

interface TestResult {
  name: string;
  success: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  const icon = result.success ? '✅' : '❌';
  const duration = result.duration ? ` (${result.duration}ms)` : '';
  console.log(`${icon} ${result.name}${duration}: ${result.message}`);
  results.push(result);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testHealthEndpoint() {
  const start = Date.now();
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'ok') {
      logResult({
        name: 'Health Check',
        success: true,
        message: 'API server is running',
        duration: Date.now() - start,
      });
      return true;
    } else {
      logResult({
        name: 'Health Check',
        success: false,
        message: `Unexpected response: ${JSON.stringify(data)}`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Health Check',
      success: false,
      message: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

async function testMessagingStats() {
  const start = Date.now();
  try {
    const response = await fetch(`${API_URL}/messages/stats`);
    const data = await response.json();
    
    if (response.ok && typeof data.totalClients === 'number') {
      logResult({
        name: 'Messaging Stats',
        success: true,
        message: `Stats endpoint working. Clients: ${data.totalClients}, Rooms: ${data.totalRooms}`,
        duration: Date.now() - start,
      });
      return true;
    } else {
      logResult({
        name: 'Messaging Stats',
        success: false,
        message: `Unexpected response: ${JSON.stringify(data)}`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Messaging Stats',
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

async function testWebSocketConnectionNoAuth() {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(`${WS_URL}/messages/subscribe`);
      let messageReceived = false;

      ws.on('open', () => {
        console.log('  WebSocket opened (should receive error)');
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        console.log('  Received:', message.type);
        
        if (message.type === 'error' && message.message.includes('Authentication')) {
          messageReceived = true;
          logResult({
            name: 'WebSocket Auth Check',
            success: true,
            message: 'Correctly rejected connection without token',
            duration: Date.now() - start,
          });
          ws.close();
          resolve(true);
        }
      });

      ws.on('error', (error) => {
        console.log('  WebSocket error (expected):', error.message);
      });

      ws.on('close', () => {
        if (!messageReceived) {
          logResult({
            name: 'WebSocket Auth Check',
            success: false,
            message: 'Connection closed without error message',
            duration: Date.now() - start,
          });
          resolve(false);
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!messageReceived) {
          logResult({
            name: 'WebSocket Auth Check',
            success: false,
            message: 'Timeout waiting for error message',
            duration: Date.now() - start,
          });
          ws.close();
          resolve(false);
        }
      }, 5000);
    } catch (error) {
      logResult({
        name: 'WebSocket Auth Check',
        success: false,
        message: `Failed to create connection: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      });
      resolve(false);
    }
  });
}

async function testRESTEndpoints() {
  console.log('\n📋 Testing REST Endpoints...\n');
  
  // Test without auth - should fail
  const start = Date.now();
  try {
    const response = await fetch(`${API_URL}/api/conversations`);
    
    if (response.status === 401) {
      logResult({
        name: 'GET /api/conversations (no auth)',
        success: true,
        message: 'Correctly requires authentication',
        duration: Date.now() - start,
      });
    } else {
      logResult({
        name: 'GET /api/conversations (no auth)',
        success: false,
        message: `Expected 401, got ${response.status}`,
        duration: Date.now() - start,
      });
    }
  } catch (error) {
    logResult({
      name: 'GET /api/conversations (no auth)',
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
  }
}

async function runTests() {
  console.log('🧪 WebSocket Messaging Integration Tests\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`WebSocket URL: ${WS_URL}\n`);
  
  // Test 1: Health check
  console.log('🏥 Testing Health Endpoint...\n');
  const healthOk = await testHealthEndpoint();
  
  if (!healthOk) {
    console.log('\n❌ API server is not reachable. Please start the server and try again.');
    console.log('   Run: cd services/api && npm run dev\n');
    process.exit(1);
  }
  
  // Test 2: Messaging stats
  console.log('\n📊 Testing Messaging Stats Endpoint...\n');
  await testMessagingStats();
  
  // Test 3: WebSocket connection without auth
  console.log('\n🔌 Testing WebSocket Connection (No Auth)...\n');
  await testWebSocketConnectionNoAuth();
  
  // Test 4: REST endpoints
  await testRESTEndpoints();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const total = results.length;
  
  console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}\n`);
  
  if (failed === 0) {
    console.log('✅ All tests passed!\n');
    console.log('Next steps:');
    console.log('1. Test with authenticated WebSocket connection');
    console.log('2. Test sending and receiving messages');
    console.log('3. Test typing indicators');
    console.log('4. Test presence tracking\n');
  } else {
    console.log('❌ Some tests failed. Check the output above for details.\n');
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
