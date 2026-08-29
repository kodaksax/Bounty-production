// __tests__/lib/analytics/lifecycle.test.ts
//
// Contract for the marketplace-activation milestone helpers in
// lib/analytics/lifecycle.ts:
//   - poster_activated / hunter_activated fire at most ONCE per (user, device)
//   - the AsyncStorage guard is written before the event, so a crash can only
//     ever drop the event, never duplicate it
//   - analytics failures are swallowed (best-effort, never block the caller)

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    updateUserProperties: jest.fn().mockResolvedValue(undefined),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { markHunterActivated, markPosterActivated } from 'lib/analytics/lifecycle';
import { analyticsService } from 'lib/services/analytics-service';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockTrack = analyticsService.trackEvent as jest.Mock;
const mockSetProps = analyticsService.updateUserProperties as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

describe('markPosterActivated', () => {
  it('emits poster_activated and sets person props on first call', async () => {
    await markPosterActivated('user-1', { bounty_id: 'b-9', amount: 40 });

    expect(mockTrack).toHaveBeenCalledWith(
      'poster_activated',
      expect.objectContaining({ role: 'poster', bounty_id: 'b-9', amount: 40 })
    );
    expect(mockSetProps).toHaveBeenCalledWith(
      expect.objectContaining({ poster_activated: true })
    );
  });

  it('writes the AsyncStorage guard before emitting the event', async () => {
    const order: string[] = [];
    mockSetItem.mockImplementation(async () => {
      order.push('guard');
    });
    mockTrack.mockImplementation(async () => {
      order.push('event');
    });

    await markPosterActivated('user-1');

    expect(order).toEqual(['guard', 'event']);
  });

  it('does not emit again when the guard key already exists', async () => {
    mockGetItem.mockResolvedValue('2026-08-28T00:00:00.000Z');

    await markPosterActivated('user-1');

    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('scopes the guard key per user', async () => {
    await markPosterActivated('user-1');
    await markPosterActivated('user-2');

    expect(mockSetItem).toHaveBeenCalledWith(
      '@bounty/activation/poster/user-1',
      expect.any(String)
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      '@bounty/activation/poster/user-2',
      expect.any(String)
    );
    expect(mockTrack).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent calls for the same key to a single emit', async () => {
    // getItem stays null for both callers (the same-process race the in-flight
    // guard exists to close); resolve it on a later tick so both calls are
    // genuinely in flight together.
    let resolveGet: (v: unknown) => void = () => {};
    mockGetItem.mockImplementation(
      () => new Promise((res) => { resolveGet = res; })
    );

    const a = markPosterActivated('user-1');
    const b = markPosterActivated('user-1');
    resolveGet(null);
    await Promise.all([a, b]);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('allows a later call through once the first has finished (persisted guard then applies)', async () => {
    mockGetItem.mockResolvedValueOnce(null); // first call: not yet activated
    await markPosterActivated('user-1');
    expect(mockTrack).toHaveBeenCalledTimes(1);

    mockGetItem.mockResolvedValueOnce('2026-08-28T00:00:00.000Z'); // now persisted
    await markPosterActivated('user-1');
    expect(mockTrack).toHaveBeenCalledTimes(1); // still 1 — short-circuited by the stored guard
  });

  it('never throws when analytics fails', async () => {
    mockTrack.mockRejectedValueOnce(new Error('posthog down'));
    await expect(markPosterActivated('user-1')).resolves.toBeUndefined();
  });

  it('never throws when AsyncStorage fails', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(markPosterActivated('user-1')).resolves.toBeUndefined();
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe('markHunterActivated', () => {
  it('emits hunter_activated with role and passthrough props', async () => {
    await markHunterActivated('user-7', { bounty_id: 'b-1', application_id: 'r-2' });

    expect(mockTrack).toHaveBeenCalledWith(
      'hunter_activated',
      expect.objectContaining({
        role: 'hunter',
        bounty_id: 'b-1',
        application_id: 'r-2',
      })
    );
  });

  it('falls back to an anon guard key when no userId is given', async () => {
    await markHunterActivated();
    expect(mockSetItem).toHaveBeenCalledWith(
      '@bounty/activation/hunter/anon',
      expect.any(String)
    );
  });
});
