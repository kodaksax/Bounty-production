/**
 * Auth Rate Limiting Code Validation Test
 * Validates that rate limiting is properly implemented in the codebase
 * without requiring a running server.
 * 
 * Run with: node tests/auth-rate-limiting-validation.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test configuration
const SERVER_FILE = path.join(__dirname, '../api/server.js');

/**
 * Read the server.js file content
 */
function readServerFile() {
  try {
    return fs.readFileSync(SERVER_FILE, 'utf8');
  } catch (error) {
    console.error('Error reading server.js:', error.message);
    process.exit(1);
  }
}

/**
 * Test suite
 */
function runTests() {
  console.log('🧪 Auth Rate Limiting Code Validation\n');
  console.log('Validating rate limiting implementation in api/server.js\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const serverContent = readServerFile();
  let passed = 0;
  let failed = 0;

  // Test 1: Check that express-rate-limit is imported
  console.log('Test 1: express-rate-limit is imported');
  try {
    assert.ok(
      serverContent.includes("require('express-rate-limit')"),
      'express-rate-limit should be imported'
    );
    console.log('✅ express-rate-limit is properly imported\n');
    passed++;
  } catch (error) {
    console.log('❌ express-rate-limit import missing:', error.message, '\n');
    failed++;
  }

  // Test 2: Check that authRateLimiter is defined
  console.log('Test 2: authRateLimiter middleware is defined');
  try {
    assert.ok(
      serverContent.includes('authRateLimiter'),
      'authRateLimiter should be defined'
    );
    assert.ok(
      serverContent.includes('windowMs'),
      'Rate limiter should have windowMs configured'
    );
    assert.ok(
      serverContent.includes('max:'),
      'Rate limiter should have max requests configured'
    );
    console.log('✅ authRateLimiter middleware is properly defined\n');
    passed++;
  } catch (error) {
    console.log('❌ authRateLimiter definition issue:', error.message, '\n');
    failed++;
  }

  // Test 3: Check rate limiting on /app/auth/sign-up-form
  console.log('Test 3: Rate limiting on /app/auth/sign-up-form');
  try {
    const signUpFormRegex = /app\.post\(['"]\/app\/auth\/sign-up-form['"],\s*authRateLimiter/;
    assert.ok(
      signUpFormRegex.test(serverContent),
      'authRateLimiter should be applied to /app/auth/sign-up-form'
    );
    console.log('✅ /app/auth/sign-up-form is protected\n');
    passed++;
  } catch (error) {
    console.log('❌ /app/auth/sign-up-form not protected:', error.message, '\n');
    failed++;
  }

  // Test 4: Check rate limiting on /app/auth/sign-in-form
  console.log('Test 4: Rate limiting on /app/auth/sign-in-form');
  try {
    const signInFormRegex = /app\.post\(['"]\/app\/auth\/sign-in-form['"],\s*authRateLimiter/;
    assert.ok(
      signInFormRegex.test(serverContent),
      'authRateLimiter should be applied to /app/auth/sign-in-form'
    );
    console.log('✅ /app/auth/sign-in-form is protected\n');
    passed++;
  } catch (error) {
    console.log('❌ /app/auth/sign-in-form not protected:', error.message, '\n');
    failed++;
  }

  // Test 5: Check rate limiting on /auth/register
  console.log('Test 5: Rate limiting on /auth/register');
  try {
    const registerRegex = /app\.post\(['"]\/auth\/register['"],\s*authRateLimiter/;
    assert.ok(
      registerRegex.test(serverContent),
      'authRateLimiter should be applied to /auth/register'
    );
    console.log('✅ /auth/register is protected\n');
    passed++;
  } catch (error) {
    console.log('❌ /auth/register not protected:', error.message, '\n');
    failed++;
  }

  // Test 6: Check rate limiting on /auth/sign-in
  console.log('Test 6: Rate limiting on /auth/sign-in');
  try {
    const signInRegex = /app\.post\(['"]\/auth\/sign-in['"],\s*authRateLimiter/;
    assert.ok(
      signInRegex.test(serverContent),
      'authRateLimiter should be applied to /auth/sign-in'
    );
    console.log('✅ /auth/sign-in is protected\n');
    passed++;
  } catch (error) {
    console.log('❌ /auth/sign-in not protected:', error.message, '\n');
    failed++;
  }

  // Test 7: Check rate limiting on /auth/identifier-sign-up
  console.log('Test 7: Rate limiting on /auth/identifier-sign-up');
  try {
    const identifierSignUpRegex = /app\.post\(['"]\/auth\/identifier-sign-up['"],\s*authRateLimiter/;
    assert.ok(
      identifierSignUpRegex.test(serverContent),
      'authRateLimiter should be applied to /auth/identifier-sign-up'
    );
    console.log('✅ /auth/identifier-sign-up is protected\n');
    passed++;
  } catch (error) {
    console.log('❌ /auth/identifier-sign-up not protected:', error.message, '\n');
    failed++;
  }

  // Test 8: Verify rate limit configuration is secure
  console.log('Test 8: Rate limit configuration is secure');
  try {
    // Extract the rate limiter configuration
    const configMatch = serverContent.match(/const authRateLimiter = rateLimit\(\{([\s\S]*?)\}\);/);
    
    assert.ok(configMatch, 'authRateLimiter configuration should be found');
    
    const config = configMatch[1];
    
    // Check for reasonable window (should be at least 5 minutes)
    const windowMatch = config.match(/windowMs:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
    if (windowMatch) {
      const windowMs = parseInt(windowMatch[1]) * parseInt(windowMatch[2]) * parseInt(windowMatch[3]);
      const windowMinutes = windowMs / (60 * 1000);
      assert.ok(
        windowMinutes >= 5,
        `Window should be at least 5 minutes (found ${windowMinutes})`
      );
      console.log(`  Window: ${windowMinutes} minutes ✓`);
    }
    
    // Check for low max requests (should be 10 or less for auth)
    const maxMatch = config.match(/max:\s*(\d+)/);
    if (maxMatch) {
      const max = parseInt(maxMatch[1]);
      assert.ok(
        max <= 10,
        `Max requests should be 10 or less for auth endpoints (found ${max})`
      );
      console.log(`  Max requests: ${max} ✓`);
    }
    
    // Check for proper error handling
    assert.ok(
      config.includes('message') || config.includes('handler'),
      'Should have custom error message or handler'
    );
    console.log('  Custom error handling: ✓');
    
    console.log('✅ Rate limit configuration is secure\n');
    passed++;
  } catch (error) {
    console.log('❌ Rate limit configuration issue:', error.message, '\n');
    failed++;
  }

  // Test 9: Verify 429 status code is used
  console.log('Test 9: 429 status code for rate limit exceeded');
  try {
    assert.ok(
      serverContent.includes('429') || serverContent.includes('Too Many Requests'),
      'Should return 429 status code or "Too Many Requests" message'
    );
    console.log('✅ Proper HTTP 429 response configured\n');
    passed++;
  } catch (error) {
    console.log('❌ 429 status code not configured:', error.message, '\n');
    failed++;
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed === 0) {
    console.log('🎉 All validation tests passed!\n');
    console.log('✅ Rate limiting is properly implemented on all auth endpoints');
    console.log('✅ Configuration meets security requirements');
    console.log('✅ All legacy auth endpoints are protected against brute force\n');
    return 0;
  } else {
    console.log('⚠️  Some validation tests failed. Please review.\n');
    return 1;
  }
}

// Run tests if this is the main module
if (require.main === module) {
  const exitCode = runTests();
  process.exit(exitCode);
}

module.exports = { runTests };
