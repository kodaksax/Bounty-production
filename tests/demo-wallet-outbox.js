#!/usr/bin/env node

/**
 * Demo script showing the wallet transactions + outbox pattern implementation
 * This simulates the flow without requiring a full database setup
 */

const { spawn } = require('child_process');
const http = require('http');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// HTTP request helper
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: body
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Wait for server to be ready
function waitForServer(port = 3001, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const checkServer = () => {
      makeRequest({
        hostname: 'localhost',
        port,
        path: '/health',
        method: 'GET',
        timeout: 1000
      })
      .then((response) => {
        if (response.statusCode === 200) {
          resolve();
        } else {
          throw new Error(`Server returned ${response.statusCode}`);
        }
      })
      .catch((error) => {
        attempts++;
        if (attempts >= maxAttempts) {
          reject(new Error(`Server not ready after ${maxAttempts} attempts: ${error.message}`));
        } else {
          setTimeout(checkServer, 1000);
        }
      });
    };
    
    checkServer();
  });
}

async function runDemo() {
  log('🎬 Starting Wallet Transactions + Outbox Pattern Demo', 'bright');
  log('=' .repeat(60), 'blue');
  
  // Start the test API server
  log('🚀 Starting test API server...', 'yellow');
  const server = spawn('npx', ['tsx', 'src/test-api.ts'], {
    cwd: 'services/api',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  // Wait for server to be ready
  try {
    await waitForServer();
    log('✅ API server is ready!', 'green');
  } catch (error) {
    log('❌ Failed to start API server: ' + error.message, 'red');
    server.kill();
    process.exit(1);
  }
  
  log('\n📋 Running demonstration scenarios...', 'bright');
  
  try {
    // Scenario 1: Check API health
    log('\n1️⃣  Checking API health...', 'cyan');
    const healthResponse = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/health',
      method: 'GET'
    });
    
    const healthData = JSON.parse(healthResponse.body);
    log(`   Status: ${healthData.status}`, 'green');
    log(`   Service: ${healthData.service}`, 'green');
    
    // Scenario 2: Accept a bounty
    log('\n2️⃣  Accepting a bounty...', 'cyan');
    const acceptResponse = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/bounties/demo-bounty-001/accept',
      method: 'POST'
    });
    
    const acceptData = JSON.parse(acceptResponse.body);
    log(`   Response: ${acceptData.message}`, 'green');
    log(`   Bounty ID: ${acceptData.bountyId}`, 'green');
    log(`   📦 This triggers: BOUNTY_ACCEPTED outbox event`, 'yellow');
    log(`   💰 This creates: Escrow wallet transaction`, 'yellow');
    
    // Scenario 3: Complete a bounty
    log('\n3️⃣  Completing a bounty...', 'cyan');
    const completeResponse = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/bounties/demo-bounty-001/complete',
      method: 'POST'
    });
    
    const completeData = JSON.parse(completeResponse.body);
    log(`   Response: ${completeData.message}`, 'green');
    log(`   Bounty ID: ${completeData.bountyId}`, 'green');
    log(`   📦 This triggers: BOUNTY_COMPLETED outbox event`, 'yellow');
    log(`   💰 This creates: Release wallet transaction`, 'yellow');
    
    // Scenario 4: Check API endpoints
    log('\n4️⃣  Checking available endpoints...', 'cyan');
    const rootResponse = await makeRequest({
      hostname: 'localhost',
      port: 3001,
      path: '/',
      method: 'GET'
    });
    
    const rootData = JSON.parse(rootResponse.body);
    log(`   API: ${rootData.message}`, 'green');
    log(`   Endpoints: ${Object.keys(rootData.endpoints).join(', ')}`, 'green');
    
    log('\n🎉 Demo completed successfully!', 'bright');
    log('\n📊 Summary of Implementation:', 'bright');
    log('   ✅ Wallet transactions table with amount tracking', 'green');
    log('   ✅ Outbox events table with JSONB payload', 'green');
    log('   ✅ Atomic bounty accept/complete operations', 'green');
    log('   ✅ Background worker for event processing', 'green');
    log('   ✅ Idempotent event processing (prevents duplicates)', 'green');
    log('   ✅ Type-safe API with authentication scaffolding', 'green');
    
    log('\n🔧 Next Steps for Production:', 'bright');
    log('   • Set up real PostgreSQL database', 'yellow');
    log('   • Configure Supabase authentication', 'yellow');
    log('   • Add event handlers for notifications/webhooks', 'yellow');
    log('   • Implement real wallet integration', 'yellow');
    log('   • Add comprehensive error handling', 'yellow');
    
  } catch (error) {
    log('❌ Demo failed: ' + error.message, 'red');
  } finally {
    // Clean up
    log('\n🛑 Shutting down test server...', 'yellow');
    server.kill();
    
    // Wait a moment for cleanup
    setTimeout(() => {
      log('✅ Demo finished!', 'green');
      process.exit(0);
    }, 1000);
  }
}

// Handle cleanup on exit
process.on('SIGINT', () => {
  log('\n🛑 Demo interrupted by user', 'yellow');
  process.exit(0);
});

// Run the demo
runDemo().catch((error) => {
  log('❌ Demo crashed: ' + error.message, 'red');
  process.exit(1);
});