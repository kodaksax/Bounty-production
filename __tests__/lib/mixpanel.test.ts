// __tests__/lib/mixpanel.test.ts
// Tests for the Mixpanel compatibility shim in lib/mixpanel.ts

jest.mock('../../lib/posthog', () => ({
  getPostHog: jest.fn(),
  isPostHogReady: jest.fn(),
  capture: jest.fn(),
  identify: jest.fn(),
}));

import getMixpanel, { identify, initMixpanel, isMixpanelReady, track } from '../../lib/mixpanel';
import {
    getPostHog,
    isPostHogReady,
    capture as posthogCapture,
    identify as posthogIdentify,
} from '../../lib/posthog';

const mockGetPostHog = getPostHog as jest.MockedFunction<typeof getPostHog>;
const mockIsPostHogReady = isPostHogReady as jest.MockedFunction<typeof isPostHogReady>;
const mockCapture = posthogCapture as jest.MockedFunction<typeof posthogCapture>;
const mockIdentify = posthogIdentify as jest.MockedFunction<typeof posthogIdentify>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('initMixpanel', () => {
  test('resolves without doing anything (no-op shim)', async () => {
    await expect(initMixpanel()).resolves.toBeUndefined();
  });

  test('resolves regardless of token argument', async () => {
    await expect(initMixpanel()).resolves.toBeUndefined();
  });
});

describe('isMixpanelReady', () => {
  test('returns true when PostHog is ready', () => {
    mockIsPostHogReady.mockReturnValue(true);
    expect(isMixpanelReady()).toBe(true);
    expect(mockIsPostHogReady).toHaveBeenCalled();
  });

  test('returns false when PostHog is not ready', () => {
    mockIsPostHogReady.mockReturnValue(false);
    expect(isMixpanelReady()).toBe(false);
  });
});

describe('identify', () => {
  test('forwards id to posthogIdentify', () => {
    identify('user-123');
    expect(mockIdentify).toHaveBeenCalledWith('user-123', undefined);
  });

  test('forwards id and properties to posthogIdentify', () => {
    identify('user-456', { email: 'test@example.com', plan: 'pro' });
    expect(mockIdentify).toHaveBeenCalledWith('user-456', {
      email: 'test@example.com',
      plan: 'pro',
    });
  });
});

describe('track', () => {
  test('forwards event name to posthogCapture', () => {
    track('bounty_created');
    expect(mockCapture).toHaveBeenCalledWith('bounty_created', undefined);
  });

  test('forwards event name and properties to posthogCapture', () => {
    track('payment_completed', { amount: 50, currency: 'USD' });
    expect(mockCapture).toHaveBeenCalledWith('payment_completed', { amount: 50, currency: 'USD' });
  });
});

describe('getMixpanel (default export)', () => {
  test('returns the PostHog client from getPostHog', () => {
    const mockClient = { capture: jest.fn() };
    mockGetPostHog.mockReturnValue(mockClient);
    expect(getMixpanel()).toBe(mockClient);
    expect(mockGetPostHog).toHaveBeenCalled();
  });

  test('returns null when PostHog client is unavailable', () => {
    mockGetPostHog.mockReturnValue(null);
    expect(getMixpanel()).toBeNull();
  });
});
