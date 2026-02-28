#!/usr/bin/env node

/**
 * HTTPS Enforcement Test Script
 * Tests the CWE-319 security fix for HTTPS enforcement in production
 * 
 * This script validates:
 * 1. HTTP requests are rejected in production mode
 * 2. HTTPS requests are accepted (via X-Forwarded-Proto)
 * 3. HSTS and security headers are set in production
 * 4. Development mode allows HTTP requests
 */

const http = require('http');

// Test configuration
const TEST_PORT = 3001;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function makeRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: path,
      method: 'GET',
      headers: headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function runTests() {
  log('\n🧪 HTTPS Enforcement Test Suite', colors.blue);
  log('='.repeat(60), colors.blue);
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  // Test 1: Check if server is running
  log('\n📋 Test 1: Server Health Check', colors.yellow);
  try {
    const response = await makeRequest('/health');
    if (response.statusCode === 200 || response.statusCode === 403) {
      log('✅ Server is responding', colors.green);
      results.passed++;
      results.tests.push({ name: 'Server Health Check', status: 'PASSED' });
    } else {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  } catch (error) {
    log(`❌ Server is not responding: ${error.message}`, colors.red);
    log('⚠️  Make sure the server is running with: npm start', colors.yellow);
    results.failed++;
    results.tests.push({ name: 'Server Health Check', status: 'FAILED', error: error.message });
    process.exit(1);
  }

  // Check environment mode
  log('\n📋 Detecting Server Mode...', colors.yellow);
  const healthResponse = await makeRequest('/health');
  const isProduction = healthResponse.statusCode === 403;
  
  if (isProduction) {
    log('🔒 Server is in PRODUCTION mode (HTTPS enforcement active)', colors.green);
  } else {
    log('⚠️  Server is in DEVELOPMENT mode (HTTPS enforcement disabled)', colors.yellow);
  }

  // Test 2: HTTP request in production should be rejected
  log('\n📋 Test 2: HTTP Request Rejection (Production)', colors.yellow);
  if (isProduction) {
    try {
      const response = await makeRequest('/health');
      if (response.statusCode === 403) {
        const body = JSON.parse(response.body);
        if (body.error === 'HTTPS required' && body.code === 'INSECURE_CONNECTION') {
          log('✅ HTTP request correctly rejected with 403 Forbidden', colors.green);
          log(`   Message: "${body.message}"`, colors.blue);
          results.passed++;
          results.tests.push({ name: 'HTTP Request Rejection', status: 'PASSED' });
        } else {
          throw new Error('Incorrect error response format');
        }
      } else {
        throw new Error(`Expected 403, got ${response.statusCode}`);
      }
    } catch (error) {
      log(`❌ Failed: ${error.message}`, colors.red);
      results.failed++;
      results.tests.push({ name: 'HTTP Request Rejection', status: 'FAILED', error: error.message });
    }
  } else {
    log('⏭️  Skipped (not in production mode)', colors.yellow);
    results.tests.push({ name: 'HTTP Request Rejection', status: 'SKIPPED' });
  }

  // Test 3: HTTPS request with X-Forwarded-Proto should be accepted
  log('\n📋 Test 3: HTTPS Request Acceptance (X-Forwarded-Proto)', colors.yellow);
  if (isProduction) {
    try {
      const response = await makeRequest('/health', {
        'X-Forwarded-Proto': 'https'
      });
      if (response.statusCode === 200) {
        log('✅ HTTPS request (via X-Forwarded-Proto) correctly accepted', colors.green);
        results.passed++;
        results.tests.push({ name: 'HTTPS Request Acceptance', status: 'PASSED' });
      } else {
        throw new Error(`Expected 200, got ${response.statusCode}`);
      }
    } catch (error) {
      log(`❌ Failed: ${error.message}`, colors.red);
      results.failed++;
      results.tests.push({ name: 'HTTPS Request Acceptance', status: 'FAILED', error: error.message });
    }
  } else {
    log('⏭️  Skipped (not in production mode)', colors.yellow);
    results.tests.push({ name: 'HTTPS Request Acceptance', status: 'SKIPPED' });
  }

  // Test 4: Security headers in production
  log('\n📋 Test 4: Security Headers (HSTS, etc.)', colors.yellow);
  if (isProduction) {
    try {
      const response = await makeRequest('/health', {
        'X-Forwarded-Proto': 'https'
      });
      
      const requiredHeaders = {
        'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'x-xss-protection': '1; mode=block'
      };

      let allHeadersPresent = true;
      for (const [header, expectedValue] of Object.entries(requiredHeaders)) {
        if (response.headers[header] === expectedValue) {
          log(`   ✅ ${header}: ${response.headers[header]}`, colors.green);
        } else {
          log(`   ❌ ${header}: Missing or incorrect`, colors.red);
          allHeadersPresent = false;
        }
      }

      if (allHeadersPresent) {
        log('✅ All security headers present and correct', colors.green);
        results.passed++;
        results.tests.push({ name: 'Security Headers', status: 'PASSED' });
      } else {
        throw new Error('Some security headers missing or incorrect');
      }
    } catch (error) {
      log(`❌ Failed: ${error.message}`, colors.red);
      results.failed++;
      results.tests.push({ name: 'Security Headers', status: 'FAILED', error: error.message });
    }
  } else {
    log('⏭️  Skipped (not in production mode)', colors.yellow);
    results.tests.push({ name: 'Security Headers', status: 'SKIPPED' });
  }

  // Test 5: Development mode allows HTTP
  log('\n📋 Test 5: Development Mode HTTP Access', colors.yellow);
  if (!isProduction) {
    try {
      const response = await makeRequest('/health');
      if (response.statusCode === 200) {
        log('✅ HTTP request allowed in development mode', colors.green);
        results.passed++;
        results.tests.push({ name: 'Development Mode HTTP', status: 'PASSED' });
      } else {
        throw new Error(`Expected 200, got ${response.statusCode}`);
      }
    } catch (error) {
      log(`❌ Failed: ${error.message}`, colors.red);
      results.failed++;
      results.tests.push({ name: 'Development Mode HTTP', status: 'FAILED', error: error.message });
    }
  } else {
    log('⏭️  Skipped (not in development mode)', colors.yellow);
    results.tests.push({ name: 'Development Mode HTTP', status: 'SKIPPED' });
  }

  // Summary
  log('\n' + '='.repeat(60), colors.blue);
  log('📊 Test Summary', colors.blue);
  log('='.repeat(60), colors.blue);
  
  results.tests.forEach(test => {
    const icon = test.status === 'PASSED' ? '✅' : test.status === 'FAILED' ? '❌' : '⏭️';
    const color = test.status === 'PASSED' ? colors.green : test.status === 'FAILED' ? colors.red : colors.yellow;
    log(`${icon} ${test.name}: ${test.status}`, color);
    if (test.error) {
      log(`   Error: ${test.error}`, colors.red);
    }
  });

  log('\n' + '-'.repeat(60), colors.blue);
  log(`Total: ${results.passed + results.failed} tests`, colors.blue);
  log(`Passed: ${results.passed}`, colors.green);
  log(`Failed: ${results.failed}`, results.failed > 0 ? colors.red : colors.green);
  log('-'.repeat(60) + '\n', colors.blue);

  if (results.failed > 0) {
    log('❌ Some tests failed', colors.red);
    process.exit(1);
  } else {
    log('✅ All tests passed!', colors.green);
    log('\n💡 To test production mode:', colors.yellow);
    log('   1. Stop the server', colors.yellow);
    log('   2. Set NODE_ENV=production in server/.env', colors.yellow);
    log('   3. Restart server and run tests again', colors.yellow);
    process.exit(0);
  }
}

// Run tests
log('\n🚀 Starting HTTPS Enforcement Tests...', colors.blue);
log('   Target: ' + BASE_URL, colors.blue);
runTests().catch(error => {
  log(`\n❌ Test suite failed: ${error.message}`, colors.red);
  process.exit(1);
});
