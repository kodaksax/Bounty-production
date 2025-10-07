/**
 * Onboarding Validation Tests
 * Simple validation tests that can run with Node.js
 * Run with: node tests/onboarding-validation.test.js
 */

// Mock AsyncStorage for Node environment
const mockStorage = {};
const AsyncStorage = {
  getItem: (key) => Promise.resolve(mockStorage[key] || null),
  setItem: (key, value) => {
    mockStorage[key] = value;
    return Promise.resolve();
  },
  removeItem: (key) => {
    delete mockStorage[key];
    return Promise.resolve();
  },
};

// Mock react-native-async-storage module
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === '@react-native-async-storage/async-storage') {
    return { default: AsyncStorage };
  }
  return originalRequire.apply(this, arguments);
};

// Simple test framework
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    testsFailed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toContain(substring) {
      if (typeof actual !== 'string' || !actual.includes(substring)) {
        throw new Error(`Expected "${actual}" to contain "${substring}"`);
      }
    },
    toHaveLength(length) {
      if (!actual || actual.length !== length) {
        throw new Error(`Expected length ${length} but got ${actual ? actual.length : 0}`);
      }
    },
    toBeLessThan(value) {
      if (actual >= value) {
        throw new Error(`Expected ${actual} to be less than ${value}`);
      }
    },
    not: {
      toContain(substring) {
        if (typeof actual === 'string' && actual.includes(substring)) {
          throw new Error(`Expected "${actual}" not to contain "${substring}"`);
        }
      }
    }
  };
}

function describe(suiteName, fn) {
  console.log(`\n${suiteName}:`);
  fn();
}

function beforeEach(fn) {
  // Simple implementation - would need to be more sophisticated in real test framework
}

// Import the functions to test
const { 
  validateUsername, 
  isUsernameUnique,
  formatPhone,
  sanitizePhone,
  checkProfileCompleteness,
} = require('../lib/services/userProfile');

describe('Username Validation', () => {
  test('validates correct username format', () => {
    expect(validateUsername('johndoe').valid).toBe(true);
    expect(validateUsername('user123').valid).toBe(true);
    expect(validateUsername('test_user').valid).toBe(true);
  });

  test('rejects username that is too short', () => {
    const result = validateUsername('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least 3 characters');
  });

  test('rejects username that is too long', () => {
    const result = validateUsername('thisusernameiswaytoolongforourvalidation');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('20 characters or less');
  });

  test('rejects username with uppercase letters', () => {
    const result = validateUsername('JohnDoe');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase');
  });

  test('rejects username with special characters', () => {
    const result = validateUsername('john-doe');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase letters, numbers, and underscores');
  });

  test('rejects username with spaces', () => {
    const result = validateUsername('john doe');
    expect(result.valid).toBe(false);
  });
});

describe('Username Uniqueness', () => {
  // Clear mock storage before tests
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);

  test('returns true for new username', async () => {
    const isUnique = await isUsernameUnique('newuser');
    expect(isUnique).toBe(true);
  });

  test('returns false for existing username', async () => {
    // Set up existing profiles
    mockStorage['BE:allProfiles'] = JSON.stringify({
      'user1': { username: 'existinguser' },
    });

    const isUnique = await isUsernameUnique('existinguser');
    expect(isUnique).toBe(false);
  });

  test('returns true for same user updating their own username', async () => {
    mockStorage['BE:allProfiles'] = JSON.stringify({
      'current-user': { username: 'myusername' },
    });

    const isUnique = await isUsernameUnique('myusername', 'current-user');
    expect(isUnique).toBe(true);
  });
});

describe('Phone Number Handling', () => {
  test('formats US phone number correctly', () => {
    expect(formatPhone('4155551234')).toBe('+14155551234');
    expect(formatPhone('(415) 555-1234')).toBe('+14155551234');
    expect(formatPhone('415-555-1234')).toBe('+14155551234');
  });

  test('handles international phone numbers', () => {
    expect(formatPhone('+441234567890')).toBe('+441234567890');
    expect(formatPhone('441234567890')).toBe('+441234567890');
  });

  test('sanitizes phone number for logging', () => {
    const sanitized = sanitizePhone('+14155551234');
    expect(sanitized).not.toContain('555');
    expect(sanitized).toContain('***');
    expect(sanitized).toBe('+14***34');
  });

  test('handles empty phone number', () => {
    expect(sanitizePhone('')).toBe('');
    expect(sanitizePhone(undefined)).toBe('');
  });
});

describe('Profile Completeness', () => {
  test('marks profile as incomplete without username', () => {
    const result = checkProfileCompleteness(null);
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('username');
  });

  test('marks profile as incomplete with empty object', () => {
    const result = checkProfileCompleteness({});
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('username');
  });

  test('marks profile as complete with username', () => {
    const result = checkProfileCompleteness({ username: 'johndoe' });
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  test('marks profile as complete with username and optional fields', () => {
    const result = checkProfileCompleteness({
      username: 'johndoe',
      displayName: 'John Doe',
      location: 'San Francisco',
      phone: '+14155551234',
    });
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });
});

describe('Phone Privacy', () => {
  test('phone number is never in plain text in sanitized output', () => {
    const phone = '+14155551234';
    const sanitized = sanitizePhone(phone);
    
    // Ensure critical digits are masked
    expect(sanitized).not.toContain('1555');
    expect(sanitized).not.toContain('5551234');
  });

  test('sanitized phone is suitable for logging', () => {
    const phones = [
      '+14155551234',
      '+441234567890',
      '+33612345678',
    ];

    phones.forEach(phone => {
      const sanitized = sanitizePhone(phone);
      expect(sanitized).toContain('***');
      expect(sanitized.length).toBeLessThan(phone.length);
    });
  });
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log(`${'='.repeat(50)}`);

if (testsFailed > 0) {
  process.exit(1);
}
