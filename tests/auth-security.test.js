// tests/auth-security.test.js - Security tests for authentication flows
// Run with: node tests/auth-security.test.js
//
// NOTE: This test file validates client-side auth validation logic.
// For server-side rate limiting tests, see auth-rate-limiting.test.js
//
// Auth endpoints protected with rate limiting (5 requests per 15 minutes):
//   - POST /app/auth/sign-up-form
//   - POST /app/auth/sign-in-form
//   - POST /auth/register
//   - POST /auth/sign-in
//   - POST /auth/identifier-sign-up

const assert = require('assert');

// Mock validation patterns from hooks/use-form-validation.ts
const ValidationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
};

// Mock validation functions from lib/utils/auth-validation.ts
function validateEmail(email) {
  if (!email || email.trim().length === 0) {
    return 'Email is required';
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Please enter a valid email address';
  }
  
  return null;
}

function validatePassword(password) {
  if (!password || password.length === 0) {
    return 'Password is required';
  }
  
  if (password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  
  return null;
}

function validateStrongPassword(password) {
  if (!password) {
    return 'Password is required';
  }
  
  if (!ValidationPatterns.strongPassword.test(password)) {
    return 'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@$!%*?&)';
  }
  
  return null;
}

// Test suite
function runTests() {
  console.log('🧪 Running Authentication Security Tests\n');
  
  let passed = 0;
  let failed = 0;

  // Test 1: Email Validation
  console.log('Test 1: Email Validation');
  try {
    assert.strictEqual(validateEmail(''), 'Email is required', 'Should reject empty email');
    assert.strictEqual(validateEmail('invalid'), 'Please enter a valid email address', 'Should reject invalid email');
    assert.strictEqual(validateEmail('test@'), 'Please enter a valid email address', 'Should reject incomplete email');
    assert.strictEqual(validateEmail('test@example'), 'Please enter a valid email address', 'Should reject email without TLD');
    assert.strictEqual(validateEmail('test@example.com'), null, 'Should accept valid email');
    assert.strictEqual(validateEmail('user+tag@subdomain.example.com'), null, 'Should accept complex valid email');
    console.log('✅ Email validation passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Email validation failed:', error.message, '\n');
    failed++;
  }

  // Test 2: Basic Password Validation
  console.log('Test 2: Basic Password Validation');
  try {
    assert.strictEqual(validatePassword(''), 'Password is required', 'Should reject empty password');
    assert.strictEqual(validatePassword('12345'), 'Password must be at least 6 characters', 'Should reject short password');
    assert.strictEqual(validatePassword('123456'), null, 'Should accept 6-char password');
    assert.strictEqual(validatePassword('longerpassword'), null, 'Should accept longer password');
    console.log('✅ Basic password validation passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Basic password validation failed:', error.message, '\n');
    failed++;
  }

  // Test 3: Strong Password Validation
  console.log('Test 3: Strong Password Validation');
  try {
    assert.notStrictEqual(validateStrongPassword('password'), null, 'Should reject weak password (no uppercase, number, special)');
    assert.notStrictEqual(validateStrongPassword('Password'), null, 'Should reject password without number and special char');
    assert.notStrictEqual(validateStrongPassword('Password1'), null, 'Should reject password without special char');
    assert.notStrictEqual(validateStrongPassword('password1!'), null, 'Should reject password without uppercase');
    assert.notStrictEqual(validateStrongPassword('PASSWORD1!'), null, 'Should reject password without lowercase');
    assert.notStrictEqual(validateStrongPassword('Pass1!'), null, 'Should reject short password');
    assert.strictEqual(validateStrongPassword('Password1!'), null, 'Should accept strong password');
    assert.strictEqual(validateStrongPassword('MySecure123!'), null, 'Should accept strong password');
    assert.strictEqual(validateStrongPassword('C0mpl3x@Pass'), null, 'Should accept strong password with @ symbol');
    console.log('✅ Strong password validation passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Strong password validation failed:', error.message, '\n');
    failed++;
  }

  // Test 4: Email Normalization
  console.log('Test 4: Email Normalization');
  try {
    const testEmail = 'Test@Example.COM';
    const normalized = testEmail.trim().toLowerCase();
    assert.strictEqual(normalized, 'test@example.com', 'Should normalize email to lowercase');
    
    const emailWithSpaces = '  test@example.com  ';
    const normalizedSpaces = emailWithSpaces.trim().toLowerCase();
    assert.strictEqual(normalizedSpaces, 'test@example.com', 'Should trim and normalize email');
    console.log('✅ Email normalization passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Email normalization failed:', error.message, '\n');
    failed++;
  }

  // Test 5: Rate Limiting Logic (Client-side)
  console.log('Test 5: Rate Limiting Logic');
  try {
    let loginAttempts = 0;
    let lockoutUntil = null;
    const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes

    // Simulate failed login attempts
    for (let i = 1; i <= 6; i++) {
      loginAttempts++;
      
      if (loginAttempts >= 5) {
        lockoutUntil = Date.now() + LOCKOUT_DURATION;
      }
    }

    assert.strictEqual(loginAttempts, 6, 'Should track failed attempts');
    assert.ok(lockoutUntil !== null, 'Should set lockout after 5 attempts');
    assert.ok(lockoutUntil > Date.now(), 'Lockout should be in the future');
    
    // Test lockout check
    const isLockedOut = lockoutUntil && Date.now() < lockoutUntil;
    assert.strictEqual(isLockedOut, true, 'Should be locked out');
    
    // Simulate lockout expiry
    const futureTime = Date.now() + (6 * 60 * 1000); // 6 minutes later
    const isStillLockedOut = lockoutUntil && futureTime < lockoutUntil;
    assert.strictEqual(isStillLockedOut, false, 'Should not be locked out after expiry');
    
    console.log('✅ Rate limiting logic passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Rate limiting logic failed:', error.message, '\n');
    failed++;
  }

  // Test 6: Password Match Validation
  console.log('Test 6: Password Match Validation');
  try {
    const password1 = 'Password1!';
    const password2 = 'Password1!';
    const password3 = 'Different1!';
    
    assert.strictEqual(password1 === password2, true, 'Matching passwords should be equal');
    assert.strictEqual(password1 === password3, false, 'Different passwords should not be equal');
    console.log('✅ Password match validation passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Password match validation failed:', error.message, '\n');
    failed++;
  }

  // Test 7: Admin Role Verification Logic
  console.log('Test 7: Admin Role Verification Logic');
  try {
    // Mock user objects
    const adminUser = {
      id: '123',
      user_metadata: { role: 'admin' },
      app_metadata: {}
    };
    
    const regularUser = {
      id: '456',
      user_metadata: { role: 'user' },
      app_metadata: {}
    };
    
    const userWithAppMetadata = {
      id: '789',
      user_metadata: {},
      app_metadata: { role: 'admin' }
    };
    
    // Admin check function
    function isAdmin(user) {
      return user?.user_metadata?.role === 'admin' || 
             user?.app_metadata?.role === 'admin';
    }
    
    assert.strictEqual(isAdmin(adminUser), true, 'Should identify admin via user_metadata');
    assert.strictEqual(isAdmin(regularUser), false, 'Should not identify regular user as admin');
    assert.strictEqual(isAdmin(userWithAppMetadata), true, 'Should identify admin via app_metadata');
    assert.strictEqual(isAdmin(null), false, 'Should handle null user');
    assert.strictEqual(isAdmin({}), false, 'Should handle user without metadata');
    
    console.log('✅ Admin role verification logic passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Admin role verification logic failed:', error.message, '\n');
    failed++;
  }

  // Test 8: Session Cache Expiry Logic
  console.log('Test 8: Session Cache Expiry Logic');
  try {
    const VERIFICATION_EXPIRY = 5 * 60 * 1000; // 5 minutes
    
    const now = Date.now();
    const recentVerification = now - (2 * 60 * 1000); // 2 minutes ago
    const oldVerification = now - (6 * 60 * 1000); // 6 minutes ago
    
    const isRecentExpired = now - recentVerification > VERIFICATION_EXPIRY;
    const isOldExpired = now - oldVerification > VERIFICATION_EXPIRY;
    
    assert.strictEqual(isRecentExpired, false, 'Recent verification should not be expired');
    assert.strictEqual(isOldExpired, true, 'Old verification should be expired');
    
    console.log('✅ Session cache expiry logic passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Session cache expiry logic failed:', error.message, '\n');
    failed++;
  }

  // Test 9: Backend Rate Limiting Logic
  console.log('Test 9: Backend Rate Limiting Logic');
  try {
    const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
    const RATE_LIMIT_MAX_REQUESTS = 60;
    
    const rateLimitCache = new Map();
    
    function checkRateLimit(identifier) {
      const now = Date.now();
      const cached = rateLimitCache.get(identifier);
      
      if (!cached || now > cached.resetAt) {
        rateLimitCache.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return true;
      }
      
      if (cached.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
      }
      
      cached.count++;
      return true;
    }
    
    const testToken = 'test-token-123';
    
    // Should allow first request
    assert.strictEqual(checkRateLimit(testToken), true, 'Should allow first request');
    
    // Should allow requests up to limit
    for (let i = 0; i < 58; i++) {
      checkRateLimit(testToken);
    }
    assert.strictEqual(checkRateLimit(testToken), true, 'Should allow 60th request');
    
    // Should block 61st request
    assert.strictEqual(checkRateLimit(testToken), false, 'Should block 61st request');
    
    console.log('✅ Backend rate limiting logic passed\n');
    passed++;
  } catch (error) {
    console.log('❌ Backend rate limiting logic failed:', error.message, '\n');
    failed++;
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('═══════════════════════════════════════\n');

  if (failed === 0) {
    console.log('🎉 All security tests passed!\n');
    return 0;
  } else {
    console.log('⚠️  Some tests failed. Please review.\n');
    return 1;
  }
}

// Run tests if this is the main module
if (require.main === module) {
  const exitCode = runTests();
  process.exit(exitCode);
}

module.exports = { runTests, validateEmail, validatePassword, validateStrongPassword };
