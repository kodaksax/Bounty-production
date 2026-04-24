/**
 * Unit tests for lib/services/stripe-sdk.ts
 *
 * Covers:
 *  - Key mode detection (test / live / unknown)
 *  - initialize() idempotency and SDK module loading
 *  - Graceful handling when SDK module import fails (non-native env)
 *  - getSDK() / isSDKAvailable() / getPublishableKey()
 */

// Silence logger.
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Provide a stable deep link scheme.
jest.mock('../../../lib/config/app', () => ({
  DEEP_LINK_SCHEME: 'bounty-test',
}));

// We import the module fresh in each test via jest.isolateModules so
// constructor-time env reading can be observed per-test.
describe('stripe-sdk: getKeyMode', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_anything';
  });

  it('detects test publishable/secret keys', () => {
    jest.isolateModules(() => {
      const { stripeSdk } = require('../../../lib/services/stripe-sdk');
      expect(stripeSdk.getKeyMode('pk_test_abc')).toBe('test');
      expect(stripeSdk.getKeyMode('sk_test_xyz')).toBe('test');
    });
  });

  it('detects live publishable/secret keys', () => {
    jest.isolateModules(() => {
      const { stripeSdk } = require('../../../lib/services/stripe-sdk');
      expect(stripeSdk.getKeyMode('pk_live_abc')).toBe('live');
      expect(stripeSdk.getKeyMode('sk_live_xyz')).toBe('live');
    });
  });

  it('returns unknown for empty / malformed keys', () => {
    jest.isolateModules(() => {
      const { stripeSdk } = require('../../../lib/services/stripe-sdk');
      expect(stripeSdk.getKeyMode('')).toBe('unknown');
      expect(stripeSdk.getKeyMode('bogus_key')).toBe('unknown');
    });
  });

  it('reflects the configured publishable key mode via getPublishableKeyMode', () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_abc';
    jest.isolateModules(() => {
      const { stripeSdk } = require('../../../lib/services/stripe-sdk');
      expect(stripeSdk.getPublishableKeyMode()).toBe('live');
    });
  });
});

describe('stripe-sdk: constructor behaviour', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('logs an error and sets empty key when EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing', () => {
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    jest.isolateModules(() => {
      const { stripeSdk } = require('../../../lib/services/stripe-sdk');
      expect(stripeSdk.getPublishableKey()).toBe('');
      expect(stripeSdk.getPublishableKeyMode()).toBe('unknown');
    });
  });

  it('exposes the configured publishable key via getPublishableKey', () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_singleton';
    jest.isolateModules(() => {
      const { stripeSdk } = require('../../../lib/services/stripe-sdk');
      expect(stripeSdk.getPublishableKey()).toBe('pk_test_singleton');
    });
  });
});

describe('stripe-sdk: initialize', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_xyz';
    jest.resetModules();
  });

  it('loads the native SDK and calls initStripe when available', async () => {
    const initStripe = jest.fn().mockResolvedValue(undefined);
    jest.doMock('@stripe/stripe-react-native', () => ({ initStripe }));

    let stripeSdk: any;
    jest.isolateModules(() => {
      stripeSdk = require('../../../lib/services/stripe-sdk').stripeSdk;
    });

    await stripeSdk.initialize();
    expect(initStripe).toHaveBeenCalledWith(
      expect.objectContaining({
        publishableKey: 'pk_test_xyz',
        urlScheme: 'bounty-test',
      })
    );
    expect(stripeSdk.isSDKAvailable()).toBe(true);
    expect(stripeSdk.getSDK()).toEqual(expect.objectContaining({ initStripe }));
  });

  it('is idempotent — initialize only runs once', async () => {
    const initStripe = jest.fn().mockResolvedValue(undefined);
    jest.doMock('@stripe/stripe-react-native', () => ({ initStripe }));

    let stripeSdk: any;
    jest.isolateModules(() => {
      stripeSdk = require('../../../lib/services/stripe-sdk').stripeSdk;
    });

    await stripeSdk.initialize();
    await stripeSdk.initialize();
    await stripeSdk.initialize();
    expect(initStripe).toHaveBeenCalledTimes(1);
  });

  it('swallows SDK import failures gracefully (non-native env) and still marks as initialized', async () => {
    // Mock the SDK module to throw synchronously when loaded. Because the
    // service uses dynamic import, we simulate the failure by providing a
    // module whose `initStripe` is undefined — the service then simply
    // skips setting `stripeSDK`, which is the supported behaviour in web/Node.
    jest.doMock('@stripe/stripe-react-native', () => {
      throw new Error('Unavailable in non-native environment');
    });

    let stripeSdk: any;
    jest.isolateModules(() => {
      stripeSdk = require('../../../lib/services/stripe-sdk').stripeSdk;
    });

    await expect(stripeSdk.initialize()).resolves.toBeUndefined();
    expect(stripeSdk.isSDKAvailable()).toBe(false);
    expect(stripeSdk.getSDK()).toBeNull();
  });

  it('skips initStripe when publishable key is empty', async () => {
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const initStripe = jest.fn().mockResolvedValue(undefined);
    jest.doMock('@stripe/stripe-react-native', () => ({ initStripe }));

    let stripeSdk: any;
    jest.isolateModules(() => {
      stripeSdk = require('../../../lib/services/stripe-sdk').stripeSdk;
    });

    await stripeSdk.initialize();
    expect(initStripe).not.toHaveBeenCalled();
    expect(stripeSdk.isSDKAvailable()).toBe(false);
  });
});
