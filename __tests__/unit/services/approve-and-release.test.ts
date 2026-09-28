// jest.mock is hoisted above these imports by ts-jest's built-in jest-hoist
// transformer (the same mechanism babel-plugin-jest-hoist provides for
// babel-jest), so the mock factory runs before completion-approval.ts's own
// `require('./analytics-service')` resolves. It is written above the imports
// anyway so the ordering doesn't rely on that hoisting to read correctly.
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn(() => Promise.resolve()) },
}));

import { approveAndRelease } from '../../../lib/services/completion-approval';
import { analyticsService } from '../../../lib/services/analytics-service';

const trackEvent = analyticsService.trackEvent as jest.Mock;

beforeEach(() => {
  trackEvent.mockClear();
});

describe('approveAndRelease', () => {
  test('calls release before approval and notifies hunter', async () => {
    const calls: string[] = [];

    const releaseFn = jest.fn(async () => {
      calls.push('release');
      return true;
    });
    const approveFn = jest.fn(async () => {
      calls.push('approve');
      return true;
    });
    const notifyFn = jest.fn(async () => {
      calls.push('notify');
    });

    const ok = await approveAndRelease({
      bountyId: 'b1',
      hunterId: 'h1',
      title: 't1',
      isForHonor: false,
      releaseFn,
      approveFn,
      notifyFn,
    });

    expect(ok).toBe(true);
    expect(releaseFn).toHaveBeenCalled();
    expect(approveFn).toHaveBeenCalled();
    expect(notifyFn).toHaveBeenCalled();
    // Ensure order
    expect(calls).toEqual(['release', 'approve', 'notify']);
  });

  test('does not approve when release fails', async () => {
    const calls: string[] = [];

    const releaseFn = jest.fn(async () => {
      calls.push('release');
      return false;
    });
    const approveFn = jest.fn(async () => {
      calls.push('approve');
      return true;
    });
    const notifyFn = jest.fn(async () => {
      calls.push('notify');
    });

    const ok = await approveAndRelease({
      bountyId: 'b2',
      hunterId: 'h2',
      title: 't2',
      isForHonor: false,
      releaseFn,
      approveFn,
      notifyFn,
    });

    expect(ok).toBe(false);
    expect(approveFn).not.toHaveBeenCalled();
    expect(releaseFn).toHaveBeenCalled();
    expect(notifyFn).not.toHaveBeenCalled();
    expect(calls).toEqual(['release']);
  });

  test('does not approve when release throws', async () => {
    const approveFn = jest.fn(async () => true);
    const releaseFn = jest.fn(async () => {
      throw new Error('release transport timeout');
    });

    await expect(
      approveAndRelease({
        bountyId: 'b3',
        hunterId: 'h3',
        title: 't3',
        isForHonor: false,
        releaseFn,
        approveFn,
      })
    ).rejects.toThrow('release transport timeout');

    expect(approveFn).not.toHaveBeenCalled();
    expect(releaseFn).toHaveBeenCalled();
  });

  test('emits escrow_released with bounty, amount and both person ids once release settles', async () => {
    const ok = await approveAndRelease({
      bountyId: 'b4',
      hunterId: 'h4',
      title: 't4',
      isForHonor: false,
      amount: 25,
      posterId: 'p4',
      releaseFn: jest.fn(async () => true),
      approveFn: jest.fn(async () => true),
    });

    expect(ok).toBe(true);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('escrow_released', {
      bounty_id: 'b4',
      bountyId: 'b4',
      amount: 25,
      hunter_person_id: 'h4',
      poster_person_id: 'p4',
      via: 'approve_submission',
    });
  });

  test('emits payment_failed at the release stage, never escrow_released, when release is not confirmed', async () => {
    await approveAndRelease({
      bountyId: 'b5',
      hunterId: 'h5',
      title: 't5',
      isForHonor: false,
      releaseFn: jest.fn(async () => false),
      approveFn: jest.fn(async () => true),
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ bounty_id: 'b5', stage: 'release', reason: 'release_not_confirmed' })
    );
  });

  test('emits payment_failed when release throws', async () => {
    await expect(
      approveAndRelease({
        bountyId: 'b6',
        hunterId: 'h6',
        title: 't6',
        isForHonor: false,
        releaseFn: jest.fn(async () => {
          throw new Error('boom');
        }),
        approveFn: jest.fn(async () => true),
      })
    ).rejects.toThrow('boom');

    expect(trackEvent).toHaveBeenCalledWith(
      'payment_failed',
      expect.objectContaining({ bounty_id: 'b6', stage: 'release', reason: 'boom' })
    );
    expect(trackEvent).not.toHaveBeenCalledWith('escrow_released', expect.anything());
  });

  test('emits nothing for honor bounties, which have no release', async () => {
    const ok = await approveAndRelease({
      bountyId: 'b7',
      hunterId: 'h7',
      title: 't7',
      isForHonor: true,
      releaseFn: jest.fn(async () => true),
      approveFn: jest.fn(async () => true),
    });

    expect(ok).toBe(true);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
