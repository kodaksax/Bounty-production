// __tests__/lib/posthog.test.ts
// Tests for the PostHog analytics wrapper in lib/posthog.ts

describe('lib/posthog — no POSTHOG_KEY (default test env)', () => {
  let posthogModule: typeof import('../../lib/posthog');

  beforeAll(() => {
    // EXPO_PUBLIC_POSTHOG_KEY is not set in the test environment, so _posthog is null.
    posthogModule = require('../../lib/posthog');
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('getPostHog returns null when key is not set', () => {
    expect(posthogModule.getPostHog()).toBeNull();
  });

  test('isPostHogReady returns false when key is not set', () => {
    expect(posthogModule.isPostHogReady()).toBe(false);
  });

  test('capture is a no-op when client is null', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => posthogModule.capture('test_event', { foo: 'bar' })).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('capture logs a warning in __DEV__ when client is null', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    posthogModule.capture('test_event');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('capture called before client ready'),
      'test_event'
    );
    consoleSpy.mockRestore();
  });

  test('identify is a no-op when client is null', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => posthogModule.identify('user-1', { name: 'Test' })).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('identify logs a warning in __DEV__ when client is null', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    posthogModule.identify('user-1');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('identify called before client ready')
    );
    consoleSpy.mockRestore();
  });

  test('setPersonProperties is a no-op when client is null', () => {
    expect(() => posthogModule.setPersonProperties({ plan: 'pro' })).not.toThrow();
  });

  test('register is a no-op when client is null', () => {
    expect(() => posthogModule.register({ app_version: '1.0' })).not.toThrow();
  });

  test('screen falls back to capture when client is null', () => {
    // screen() calls capture() internally when _posthog is null
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => posthogModule.screen('HomeScreen', { referrer: 'push' })).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('reset is a no-op when client is null', () => {
    expect(() => posthogModule.reset()).not.toThrow();
  });

  test('flush resolves without throwing when client is null', async () => {
    await expect(posthogModule.flush()).resolves.toBeUndefined();
  });

  test('default export returns null when key is not set', () => {
    const getPostHog = posthogModule.default;
    expect(typeof getPostHog).toBe('function');
    expect(getPostHog()).toBeNull();
  });
});

describe('lib/posthog — with POSTHOG_KEY set', () => {
  const mockCapture = jest.fn();
  const mockIdentify = jest.fn();
  const mockScreen = jest.fn();
  const mockReset = jest.fn();
  const mockFlush = jest.fn().mockResolvedValue(undefined);
  const mockRegister = jest.fn();
  const mockSet = jest.fn();

  const MockPostHog = jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    identify: mockIdentify,
    screen: mockScreen,
    reset: mockReset,
    flush: mockFlush,
    register: mockRegister,
    $set: mockSet,
  }));

  let posthogModule: typeof import('../../lib/posthog');

  beforeAll(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'test-posthog-key';

    jest.mock('posthog-react-native', () => ({ PostHog: MockPostHog }), { virtual: true });

    posthogModule = require('../../lib/posthog');
  });

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getPostHog returns a client instance when key is set', () => {
    expect(posthogModule.getPostHog()).not.toBeNull();
  });

  test('isPostHogReady returns true when client is initialized', () => {
    expect(posthogModule.isPostHogReady()).toBe(true);
  });

  test('capture calls client.capture with event and properties', () => {
    posthogModule.capture('bounty_created', { bounty_id: '123' });
    expect(mockCapture).toHaveBeenCalledWith('bounty_created', { bounty_id: '123' });
  });

  test('capture calls client.capture with event only when no properties', () => {
    posthogModule.capture('app_opened');
    expect(mockCapture).toHaveBeenCalledWith('app_opened', undefined);
  });

  test('identify calls client.identify with userId and properties', () => {
    posthogModule.identify('user-42', { email: 'test@example.com' });
    expect(mockIdentify).toHaveBeenCalledWith('user-42', { email: 'test@example.com' });
  });

  test('identify calls client.identify with only userId', () => {
    posthogModule.identify('user-42');
    expect(mockIdentify).toHaveBeenCalledWith('user-42', undefined);
  });

  test('setPersonProperties calls client.capture with $set payload', () => {
    posthogModule.setPersonProperties({ tier: 'premium' });
    expect(mockCapture).toHaveBeenCalledWith('$set', { $set: { tier: 'premium' } });
  });

  test('register calls client.register', () => {
    posthogModule.register({ app_version: '2.0' });
    expect(mockRegister).toHaveBeenCalledWith({ app_version: '2.0' });
  });

  test('screen calls client.screen', () => {
    posthogModule.screen('HomeScreen', { source: 'tab' });
    expect(mockScreen).toHaveBeenCalledWith('HomeScreen', { source: 'tab' });
  });

  test('reset calls client.reset', () => {
    posthogModule.reset();
    expect(mockReset).toHaveBeenCalled();
  });

  test('flush calls client.flush and resolves', async () => {
    await posthogModule.flush();
    expect(mockFlush).toHaveBeenCalled();
  });

  test('capture handles client.capture throwing gracefully', () => {
    mockCapture.mockImplementationOnce(() => {
      throw new Error('network error');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => posthogModule.capture('test_event')).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('capture failed'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  test('identify handles client.identify throwing gracefully', () => {
    mockIdentify.mockImplementationOnce(() => {
      throw new Error('network error');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => posthogModule.identify('user-1')).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('setPersonProperties handles client.capture throwing gracefully', () => {
    mockCapture.mockImplementationOnce(() => {
      throw new Error('fail');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => posthogModule.setPersonProperties({ a: 'b' })).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('register handles client.register throwing gracefully', () => {
    mockRegister.mockImplementationOnce(() => {
      throw new Error('fail');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => posthogModule.register({ key: 'val' })).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('screen handles client.screen throwing gracefully', () => {
    mockScreen.mockImplementationOnce(() => {
      throw new Error('fail');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => posthogModule.screen('TestScreen')).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('reset handles client.reset throwing gracefully', () => {
    mockReset.mockImplementationOnce(() => {
      throw new Error('fail');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => posthogModule.reset()).not.toThrow();
    consoleSpy.mockRestore();
  });

  test('flush handles client.flush throwing gracefully', async () => {
    mockFlush.mockRejectedValueOnce(new Error('flush failed'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(posthogModule.flush()).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('lib/posthog — screen falls back to capture when screen method missing', () => {
  const mockCapture = jest.fn();
  const MockPostHogNoScreen = jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    identify: jest.fn(),
    reset: jest.fn(),
    flush: jest.fn(),
    register: jest.fn(),
    // no .screen method
  }));

  let posthogModule: typeof import('../../lib/posthog');

  beforeAll(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'test-key-no-screen';
    jest.mock('posthog-react-native', () => ({ PostHog: MockPostHogNoScreen }), { virtual: true });
    posthogModule = require('../../lib/posthog');
  });

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    jest.resetModules();
  });

  test('screen falls back to capture when client lacks .screen method', () => {
    posthogModule.screen('ProfileScreen', { tab: 'info' });
    expect(mockCapture).toHaveBeenCalledWith('screen_view', {
      screen_name: 'ProfileScreen',
      tab: 'info',
    });
  });
});

describe('lib/posthog — initialization failure (require throws)', () => {
  let posthogModule: typeof import('../../lib/posthog');

  beforeAll(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'test-key-broken';
    jest.mock(
      'posthog-react-native',
      () => {
        throw new Error('native module unavailable');
      },
      { virtual: true }
    );
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    posthogModule = require('../../lib/posthog');
    consoleSpy.mockRestore();
  });

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    jest.resetModules();
  });

  test('getPostHog returns null when require throws', () => {
    expect(posthogModule.getPostHog()).toBeNull();
  });

  test('isPostHogReady returns false when initialization failed', () => {
    expect(posthogModule.isPostHogReady()).toBe(false);
  });
});
