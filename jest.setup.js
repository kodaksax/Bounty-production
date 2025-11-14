// Jest setup file for global test configuration

// Mock environment variables for tests
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key';
process.env.NODE_ENV = 'test';

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests, but preserve critical errors
const originalError = console.error;
global.console = {
  ...console,
  error: (...args) => {
    // Only suppress specific known noisy errors (customize as needed)
    if (
      typeof args[0] === 'string' &&
      (
        args[0].includes('DeprecationWarning') ||
        args[0].includes('Some known noisy error')
      )
    ) {
      return;
    }
    originalError(...args);
  },
  warn: jest.fn(),
  log: jest.fn(),
};
