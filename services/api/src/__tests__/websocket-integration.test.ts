/**
 * WebSocket Integration Tests
 * 
 * Comprehensive tests for WebSocket services (real-time events and messaging).
 * Tests authentication, connection management, message delivery, and error handling.
 * 
 * Run with: tsx src/__tests__/websocket-integration.test.ts
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
  category: string;
  success: boolean;
  message: string;
  duration?: number;
  details?: any;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  const icon = result.success ? '✅' : '❌';
  const duration = result.duration ? ` (${result.duration}ms)` : '';
  console.log(`${icon} [${result.category}] ${result.name}${duration}`);
  if (result.message) {
    console.log(`   ${result.message}`);
  }
  if (result.details) {
    console.log(`   Details:`, JSON.stringify(result.details, null, 2));
  }
  results.push(result);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// AUTHENTICATION TESTS
// ============================================================================

async function testHealthEndpoint() {
  const start = Date.now();
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'ok') {
      logResult({
        name: 'Health Check',
        category: 'Infrastructure',
        success: true,
        message: `API server is healthy - ${data.service} v${data.version}`,
        duration: Date.now() - start,
        details: { database: data.database, idempotency: data.idempotency }
      });
      return true;
    } else {
      logResult({
        name: 'Health Check',
        category: 'Infrastructure',
        success: false,
        message: `Unexpected response: ${JSON.stringify(data)}`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Health Check',
      category: 'Infrastructure',
      success: false,
      message: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

async function testRealtimeEventConnection() {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(`${WS_URL}/events/subscribe`);
      let messageReceived = false;

      ws.on('open', () => {
        console.log('  ✓ Realtime WebSocket opened');
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        console.log('  ✓ Received connection message:', message.type);
        
        if (message.type === 'connection' && message.message.includes('BountyExpo')) {
          messageReceived = true;
          logResult({
            name: 'Realtime Events Connection (No Auth)',
            category: 'Authentication',
            success: true,
            message: 'Successfully connected to realtime events endpoint',
            duration: Date.now() - start,
            details: message
          });
          ws.close();
          resolve(true);
        }
      });

      ws.on('error', (error) => {
        console.log('  ✗ WebSocket error:', error.message);
        if (!messageReceived) {
          logResult({
            name: 'Realtime Events Connection (No Auth)',
            category: 'Authentication',
            success: false,
            message: `WebSocket error: ${error.message}`,
            duration: Date.now() - start,
          });
          resolve(false);
        }
      });

      ws.on('close', () => {
        if (!messageReceived) {
          logResult({
            name: 'Realtime Events Connection (No Auth)',
            category: 'Authentication',
            success: false,
            message: 'Connection closed without receiving confirmation',
            duration: Date.now() - start,
          });
          resolve(false);
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!messageReceived) {
          logResult({
            name: 'Realtime Events Connection (No Auth)',
            category: 'Authentication',
            success: false,
            message: 'Timeout waiting for connection message',
            duration: Date.now() - start,
          });
          ws.close();
          resolve(false);
        }
      }, 5000);
    } catch (error) {
      logResult({
        name: 'Realtime Events Connection (No Auth)',
        category: 'Authentication',
        success: false,
        message: `Failed to create connection: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      });
      resolve(false);
    }
  });
}

async function testMessagingConnectionNoAuth() {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(`${WS_URL}/messages/subscribe`);
      let messageReceived = false;

      ws.on('open', () => {
        console.log('  ✓ Messaging WebSocket opened (should be rejected)');
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        console.log('  ✓ Received error message:', message.type);
        
        if (message.type === 'error' && message.message.includes('Authentication')) {
          messageReceived = true;
          logResult({
            name: 'Messaging Connection (No Auth)',
            category: 'Authentication',
            success: true,
            message: 'Correctly rejected connection without auth token',
            duration: Date.now() - start,
            details: message
          });
          ws.close();
          resolve(true);
        }
      });

      ws.on('error', (error) => {
        console.log('  ✗ WebSocket error (expected):', error.message);
      });

      ws.on('close', () => {
        if (!messageReceived) {
          logResult({
            name: 'Messaging Connection (No Auth)',
            category: 'Authentication',
            success: false,
            message: 'Connection closed without proper error message',
            duration: Date.now() - start,
          });
          resolve(false);
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!messageReceived) {
          logResult({
            name: 'Messaging Connection (No Auth)',
            category: 'Authentication',
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
        name: 'Messaging Connection (No Auth)',
        category: 'Authentication',
        success: false,
        message: `Failed to create connection: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      });
      resolve(false);
    }
  });
}

async function testMessagingConnectionInvalidToken() {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(`${WS_URL}/messages/subscribe?token=invalid-token-12345`);
      let messageReceived = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'error' && 
            (message.message.includes('Authentication failed') || 
             message.message.includes('Invalid'))) {
          messageReceived = true;
          logResult({
            name: 'Messaging Connection (Invalid Token)',
            category: 'Authentication',
            success: true,
            message: 'Correctly rejected connection with invalid token',
            duration: Date.now() - start,
          });
          ws.close();
          resolve(true);
        }
      });

      ws.on('error', (error) => {
        console.log('  ✗ WebSocket error (expected):', error.message);
      });

      ws.on('close', () => {
        if (!messageReceived) {
          logResult({
            name: 'Messaging Connection (Invalid Token)',
            category: 'Authentication',
            success: false,
            message: 'Connection closed without proper error message',
            duration: Date.now() - start,
          });
          resolve(false);
        }
      });

      setTimeout(() => {
        if (!messageReceived) {
          logResult({
            name: 'Messaging Connection (Invalid Token)',
            category: 'Authentication',
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
        name: 'Messaging Connection (Invalid Token)',
        category: 'Authentication',
        success: false,
        message: `Failed to create connection: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      });
      resolve(false);
    }
  });
}

// ============================================================================
// CONNECTION MANAGEMENT TESTS
// ============================================================================

async function testMultipleConnections() {
  const start = Date.now();
  try {
    const connections: WebSocket[] = [];
    const connectionCount = 5;
    let openCount = 0;

    await Promise.all(
      Array.from({ length: connectionCount }, () => {
        return new Promise<void>((resolve) => {
          const ws = new WebSocket(`${WS_URL}/events/subscribe`);
          
          ws.on('open', () => {
            openCount++;
            connections.push(ws);
          });
          
          ws.on('message', () => {
            resolve();
          });
          
          ws.on('error', () => {
            resolve();
          });

          setTimeout(() => resolve(), 2000);
        });
      })
    );

    // Close all connections
    connections.forEach(ws => ws.close());

    if (openCount === connectionCount) {
      logResult({
        name: 'Multiple Concurrent Connections',
        category: 'Connection Management',
        success: true,
        message: `Successfully opened ${openCount} concurrent connections`,
        duration: Date.now() - start,
      });
      return true;
    } else {
      logResult({
        name: 'Multiple Concurrent Connections',
        category: 'Connection Management',
        success: false,
        message: `Only ${openCount}/${connectionCount} connections succeeded`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Multiple Concurrent Connections',
      category: 'Connection Management',
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

async function testConnectionCleanup() {
  const start = Date.now();
  try {
    // Get initial stats
    const statsBefore = await fetch(`${API_URL}/events/stats`).then(r => r.json());
    const clientsBefore = statsBefore.events.wsClientCount;

    // Open and close connections
    const ws1 = new WebSocket(`${WS_URL}/events/subscribe`);
    await new Promise(resolve => ws1.on('open', resolve));
    await sleep(100);
    
    const statsAfterOpen = await fetch(`${API_URL}/events/stats`).then(r => r.json());
    const clientsAfterOpen = statsAfterOpen.events.wsClientCount;

    ws1.close();
    await sleep(500); // Wait for cleanup

    const statsAfterClose = await fetch(`${API_URL}/events/stats`).then(r => r.json());
    const clientsAfterClose = statsAfterClose.events.wsClientCount;

    if (clientsAfterOpen > clientsBefore && clientsAfterClose <= clientsBefore) {
      logResult({
        name: 'Connection Cleanup',
        category: 'Connection Management',
        success: true,
        message: `Connections properly cleaned up (before: ${clientsBefore}, open: ${clientsAfterOpen}, after: ${clientsAfterClose})`,
        duration: Date.now() - start,
      });
      return true;
    } else {
      logResult({
        name: 'Connection Cleanup',
        category: 'Connection Management',
        success: false,
        message: `Cleanup may not be working (before: ${clientsBefore}, open: ${clientsAfterOpen}, after: ${clientsAfterClose})`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Connection Cleanup',
      category: 'Connection Management',
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

// ============================================================================
// STATS & MONITORING TESTS
// ============================================================================

async function testEventsStatsEndpoint() {
  const start = Date.now();
  try {
    const response = await fetch(`${API_URL}/events/stats`);
    const data = await response.json();
    
    if (response.ok && 
        typeof data.events === 'object' &&
        typeof data.messaging === 'object') {
      logResult({
        name: 'Events Stats Endpoint',
        category: 'Monitoring',
        success: true,
        message: 'Stats endpoint working properly',
        duration: Date.now() - start,
        details: {
          events: data.events,
          messaging: data.messaging
        }
      });
      return true;
    } else {
      logResult({
        name: 'Events Stats Endpoint',
        category: 'Monitoring',
        success: false,
        message: `Unexpected response format`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Events Stats Endpoint',
      category: 'Monitoring',
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

async function testMessagingStatsEndpoint() {
  const start = Date.now();
  try {
    const response = await fetch(`${API_URL}/messages/stats`);
    const data = await response.json();
    
    if (response.ok && 
        typeof data.totalClients === 'number' &&
        typeof data.totalRooms === 'number' &&
        typeof data.onlineUsers === 'number') {
      logResult({
        name: 'Messaging Stats Endpoint',
        category: 'Monitoring',
        success: true,
        message: `Stats working - Clients: ${data.totalClients}, Rooms: ${data.totalRooms}, Online: ${data.onlineUsers}`,
        duration: Date.now() - start,
        details: data
      });
      return true;
    } else {
      logResult({
        name: 'Messaging Stats Endpoint',
        category: 'Monitoring',
        success: false,
        message: `Unexpected response format`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Messaging Stats Endpoint',
      category: 'Monitoring',
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

async function testMalformedMessage() {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(`${WS_URL}/events/subscribe`);
      let connected = false;

      ws.on('open', () => {
        connected = true;
        // Send malformed JSON
        ws.send('not-valid-json-{{{');
        
        // Wait a bit to see if connection survives
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            logResult({
              name: 'Malformed Message Handling',
              category: 'Error Handling',
              success: true,
              message: 'Connection survived malformed message',
              duration: Date.now() - start,
            });
            ws.close();
            resolve(true);
          } else {
            logResult({
              name: 'Malformed Message Handling',
              category: 'Error Handling',
              success: false,
              message: 'Connection was closed after malformed message',
              duration: Date.now() - start,
            });
            resolve(false);
          }
        }, 1000);
      });

      ws.on('error', (error) => {
        if (!connected) {
          logResult({
            name: 'Malformed Message Handling',
            category: 'Error Handling',
            success: false,
            message: `Connection error: ${error.message}`,
            duration: Date.now() - start,
          });
          resolve(false);
        }
      });

      setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);
    } catch (error) {
      logResult({
        name: 'Malformed Message Handling',
        category: 'Error Handling',
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      });
      resolve(false);
    }
  });
}

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

async function testConnectionLatency() {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(`${WS_URL}/events/subscribe`);

      ws.on('open', () => {
        const latency = Date.now() - start;
        
        if (latency < 1000) { // Should connect in less than 1 second
          logResult({
            name: 'Connection Latency',
            category: 'Performance',
            success: true,
            message: `Connected in ${latency}ms (target: <1000ms)`,
            duration: latency,
          });
          ws.close();
          resolve(true);
        } else {
          logResult({
            name: 'Connection Latency',
            category: 'Performance',
            success: false,
            message: `Connection took ${latency}ms (target: <1000ms)`,
            duration: latency,
          });
          ws.close();
          resolve(false);
        }
      });

      ws.on('error', (error) => {
        logResult({
          name: 'Connection Latency',
          category: 'Performance',
          success: false,
          message: `Connection error: ${error.message}`,
          duration: Date.now() - start,
        });
        resolve(false);
      });

      setTimeout(() => {
        logResult({
          name: 'Connection Latency',
          category: 'Performance',
          success: false,
          message: 'Connection timeout',
          duration: Date.now() - start,
        });
        ws.close();
        resolve(false);
      }, 5000);
    } catch (error) {
      logResult({
        name: 'Connection Latency',
        category: 'Performance',
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      });
      resolve(false);
    }
  });
}

async function testReconnection() {
  const start = Date.now();
  try {
    let reconnectCount = 0;
    const maxReconnects = 3;

    for (let i = 0; i < maxReconnects; i++) {
      const ws = new WebSocket(`${WS_URL}/events/subscribe`);
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          reconnectCount++;
          ws.close();
          resolve();
        });
        
        ws.on('error', () => resolve());
        
        setTimeout(() => resolve(), 2000);
      });
      
      await sleep(100); // Small delay between reconnects
    }

    if (reconnectCount === maxReconnects) {
      logResult({
        name: 'Reconnection Handling',
        category: 'Performance',
        success: true,
        message: `Successfully reconnected ${reconnectCount} times`,
        duration: Date.now() - start,
      });
      return true;
    } else {
      logResult({
        name: 'Reconnection Handling',
        category: 'Performance',
        success: false,
        message: `Only ${reconnectCount}/${maxReconnects} reconnections succeeded`,
        duration: Date.now() - start,
      });
      return false;
    }
  } catch (error) {
    logResult({
      name: 'Reconnection Handling',
      category: 'Performance',
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    });
    return false;
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   WebSocket Integration Tests - Phase 4 Verification          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`WebSocket URL: ${WS_URL}\n`);
  
  // 1. Infrastructure Tests
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 INFRASTRUCTURE TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const healthOk = await testHealthEndpoint();
  
  if (!healthOk) {
    console.log('\n❌ API server is not reachable. Please start the server and try again.');
    console.log('   Run: cd services/api && npm run dev\n');
    process.exit(1);
  }
  
  // 2. Authentication Tests
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 AUTHENTICATION TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  await testRealtimeEventConnection();
  await testMessagingConnectionNoAuth();
  await testMessagingConnectionInvalidToken();
  
  // 3. Connection Management Tests
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔌 CONNECTION MANAGEMENT TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  await testMultipleConnections();
  await testConnectionCleanup();
  
  // 4. Monitoring Tests
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 MONITORING TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  await testEventsStatsEndpoint();
  await testMessagingStatsEndpoint();
  
  // 5. Error Handling Tests
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  ERROR HANDLING TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  await testMalformedMessage();
  
  // 6. Performance Tests
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚡ PERFORMANCE TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  await testConnectionLatency();
  await testReconnection();
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const byCategory = results.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = { passed: 0, failed: 0 };
    if (r.success) acc[r.category].passed++;
    else acc[r.category].failed++;
    return acc;
  }, {} as Record<string, { passed: number; failed: number }>);
  
  console.log('Results by Category:');
  Object.entries(byCategory).forEach(([category, counts]) => {
    const total = counts.passed + counts.failed;
    const icon = counts.failed === 0 ? '✅' : '⚠️';
    console.log(`  ${icon} ${category}: ${counts.passed}/${total} passed`);
  });
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const total = results.length;
  const successRate = ((passed / total) * 100).toFixed(1);
  
  console.log(`\nOverall: ${passed}/${total} tests passed (${successRate}%)`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed!\n');
    console.log('WebSocket services are working correctly with the consolidated backend.\n');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed. Review the output above for details.\n`);
  }
  
  return failed === 0;
}

// Run tests
runAllTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  });
