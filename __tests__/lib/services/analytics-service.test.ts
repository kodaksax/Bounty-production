// __tests__/lib/services/analytics-service.test.ts
// Tests for AnalyticsService in lib/services/analytics-service.ts

jest.mock('../../../lib/posthog', () => ({
  isPostHogReady: jest.fn(),
  capture: jest.fn(),
  flush: jest.fn().mockResolvedValue(undefined),
  identify: jest.fn(),
  reset: jest.fn(),
  screen: jest.fn(),
  setPersonProperties: jest.fn(),
}));

import {
  isPostHogReady,
  capture as posthogCapture,
  flush as posthogFlush,
  identify as posthogIdentify,
  reset as posthogReset,
  screen as posthogScreen,
  setPersonProperties as posthogSetPersonProperties,
} from '../../../lib/posthog';
import { analyticsService } from '../../../lib/services/analytics-service';

const mockIsReady = isPostHogReady as jest.MockedFunction<typeof isPostHogReady>;
const mockCapture = posthogCapture as jest.MockedFunction<typeof posthogCapture>;
const mockFlush = posthogFlush as jest.MockedFunction<typeof posthogFlush>;
const mockIdentify = posthogIdentify as jest.MockedFunction<typeof posthogIdentify>;
const mockReset = posthogReset as jest.MockedFunction<typeof posthogReset>;
const mockScreen = posthogScreen as jest.MockedFunction<typeof posthogScreen>;
const mockSetPersonProperties = posthogSetPersonProperties as jest.MockedFunction<typeof posthogSetPersonProperties>;

beforeEach(() => {
  jest.clearAllMocks();
  // Reset singleton state between tests
  // @ts-ignore — accessing private for test purposes
  analyticsService['initialized'] = false;
  // @ts-ignore
  analyticsService['userId'] = null;
});

describe('initialize()', () => {
  test('initializes successfully when PostHog is ready', async () => {
    mockIsReady.mockReturnValue(true);
    await analyticsService.initialize();
    expect(analyticsService.isInitialized()).toBe(true);
  });

  test('initializes even when PostHog is not ready (warns)', async () => {
    mockIsReady.mockReturnValue(false);
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await analyticsService.initialize();
    expect(analyticsService.isInitialized()).toBe(true);
    consoleSpy.mockRestore();
  });

  test('skips initialization if already initialized', async () => {
    mockIsReady.mockReturnValue(true);
    await analyticsService.initialize();
    await analyticsService.initialize();
    // isPostHogReady should only have been called once (second call exits early)
    expect(mockIsReady).toHaveBeenCalledTimes(1);
  });

  test('skips initialization when legacy token is placeholder', async () => {
    // Passing the exact placeholder should skip the init warn path
    await analyticsService.initialize('YOUR_MIXPANEL_TOKEN');
    expect(analyticsService.isInitialized()).toBe(true);
  });
});

describe('identifyUser()', () => {
  test('sets userId and calls posthogIdentify', async () => {
    await analyticsService.identifyUser('user-abc');
    expect(analyticsService.getUserId()).toBe('user-abc');
    expect(mockIdentify).toHaveBeenCalledWith('user-abc', undefined);
  });

  test('passes properties to posthogIdentify', async () => {
    await analyticsService.identifyUser('user-xyz', { email: 'test@example.com' });
    expect(mockIdentify).toHaveBeenCalledWith('user-xyz', { email: 'test@example.com' });
  });

  test('handles posthogIdentify throwing gracefully', async () => {
    mockIdentify.mockImplementationOnce(() => { throw new Error('identify failed'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(analyticsService.identifyUser('user-fail')).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('trackEvent()', () => {
  test('calls posthogCapture with enriched properties', async () => {
    await analyticsService.trackEvent('bounty_created', { bounty_id: '42' });

    expect(mockCapture).toHaveBeenCalledWith(
      'bounty_created',
      expect.objectContaining({
        bounty_id: '42',
        platform: 'ios',
        timestamp: expect.any(String),
      })
    );
  });

  test('includes userId in enriched properties after identify', async () => {
    await analyticsService.identifyUser('user-99');
    await analyticsService.trackEvent('bounty_viewed');

    expect(mockCapture).toHaveBeenCalledWith(
      'bounty_viewed',
      expect.objectContaining({ userId: 'user-99' })
    );
  });

  test('works without optional properties', async () => {
    await analyticsService.trackEvent('app_opened');
    expect(mockCapture).toHaveBeenCalledWith('app_opened', expect.any(Object));
  });

  test('handles posthogCapture throwing gracefully', async () => {
    mockCapture.mockImplementationOnce(() => { throw new Error('capture error'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(analyticsService.trackEvent('payment_failed')).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });

  test('tracks all AnalyticsEvent types without throwing', async () => {
    const events = [
      'app_opened', 'user_signed_up', 'user_logged_in', 'user_logged_out',
      'bounty_created', 'bounty_accepted', 'bounty_completed', 'bounty_cancelled',
      'payment_initiated', 'payment_completed', 'payment_failed',
      'message_sent', 'conversation_started',
      'profile_viewed', 'profile_updated',
      'dispute_opened', 'dispute_resolved',
      'search_performed', 'filter_applied',
    ] as const;

    for (const event of events) {
      // @ts-ignore — testing all events
      await expect(analyticsService.trackEvent(event)).resolves.toBeUndefined();
    }
  });
});

describe('updateUserProperties()', () => {
  test('calls posthogSetPersonProperties with given properties', async () => {
    await analyticsService.updateUserProperties({ plan: 'premium', verified: true });
    expect(mockSetPersonProperties).toHaveBeenCalledWith({ plan: 'premium', verified: true });
  });

  test('handles posthogSetPersonProperties throwing gracefully', async () => {
    mockSetPersonProperties.mockImplementationOnce(() => { throw new Error('props failed'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      analyticsService.updateUserProperties({ plan: 'pro' })
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('incrementUserProperty()', () => {
  test('calls posthogCapture with user_property_incremented event', async () => {
    await analyticsService.incrementUserProperty('bounties_posted', 1);
    expect(mockCapture).toHaveBeenCalledWith('user_property_incremented', {
      property: 'bounties_posted',
      increment: 1,
      userId: null,
    });
  });

  test('uses default increment of 1', async () => {
    await analyticsService.incrementUserProperty('messages_sent');
    expect(mockCapture).toHaveBeenCalledWith(
      'user_property_incremented',
      expect.objectContaining({ increment: 1 })
    );
  });

  test('uses specified increment value', async () => {
    await analyticsService.incrementUserProperty('login_count', 5);
    expect(mockCapture).toHaveBeenCalledWith(
      'user_property_incremented',
      expect.objectContaining({ increment: 5 })
    );
  });

  test('handles posthogCapture throwing gracefully', async () => {
    mockCapture.mockImplementationOnce(() => { throw new Error('fail'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      analyticsService.incrementUserProperty('fail_prop')
    ).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('trackScreenView()', () => {
  test('calls posthogScreen with screen name', async () => {
    await analyticsService.trackScreenView('HomeScreen');
    expect(mockScreen).toHaveBeenCalledWith('HomeScreen', { screen_name: 'HomeScreen' });
  });

  test('merges additional properties', async () => {
    await analyticsService.trackScreenView('BountyDetail', { bounty_id: '77' });
    expect(mockScreen).toHaveBeenCalledWith(
      'BountyDetail',
      expect.objectContaining({ screen_name: 'BountyDetail', bounty_id: '77' })
    );
  });

  test('handles posthogScreen throwing gracefully', async () => {
    mockScreen.mockImplementationOnce(() => { throw new Error('screen fail'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(analyticsService.trackScreenView('ErrorScreen')).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('trackTiming()', () => {
  test('calls posthogCapture with duration_ms property', async () => {
    await analyticsService.trackTiming('api_response_time', 350, { endpoint: '/bounties' });
    expect(mockCapture).toHaveBeenCalledWith(
      'api_response_time',
      expect.objectContaining({ duration_ms: 350, endpoint: '/bounties' })
    );
  });

  test('works without optional properties', async () => {
    await analyticsService.trackTiming('load_time', 200);
    expect(mockCapture).toHaveBeenCalledWith(
      'load_time',
      expect.objectContaining({ duration_ms: 200 })
    );
  });

  test('handles posthogCapture throwing gracefully', async () => {
    mockCapture.mockImplementationOnce(() => { throw new Error('fail'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(analyticsService.trackTiming('slow_op', 5000)).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('reset()', () => {
  test('clears userId and calls posthogReset', async () => {
    await analyticsService.identifyUser('user-to-clear');
    expect(analyticsService.getUserId()).toBe('user-to-clear');

    await analyticsService.reset();
    expect(analyticsService.getUserId()).toBeNull();
    expect(mockReset).toHaveBeenCalled();
  });

  test('handles posthogReset throwing gracefully', async () => {
    mockReset.mockImplementationOnce(() => { throw new Error('reset fail'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(analyticsService.reset()).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('flush()', () => {
  test('calls posthogFlush', async () => {
    mockFlush.mockResolvedValue(undefined);
    await analyticsService.flush();
    expect(mockFlush).toHaveBeenCalled();
  });

  test('handles posthogFlush throwing gracefully', async () => {
    mockFlush.mockRejectedValueOnce(new Error('flush fail'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(analyticsService.flush()).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe('getUserId()', () => {
  test('returns null initially', () => {
    expect(analyticsService.getUserId()).toBeNull();
  });

  test('returns the userId after identifyUser', async () => {
    await analyticsService.identifyUser('user-200');
    expect(analyticsService.getUserId()).toBe('user-200');
  });
});

describe('isInitialized()', () => {
  test('returns false before initialize is called', () => {
    expect(analyticsService.isInitialized()).toBe(false);
  });

  test('returns true after initialize is called', async () => {
    mockIsReady.mockReturnValue(true);
    await analyticsService.initialize();
    expect(analyticsService.isInitialized()).toBe(true);
  });
});
