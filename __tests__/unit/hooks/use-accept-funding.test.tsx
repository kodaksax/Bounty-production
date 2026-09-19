// The pay-at-accept gate state machine (hooks/useAcceptFunding).
//
// This is the seam between "the poster tapped Select" and "the acceptance is
// attempted". The invariants under test:
//
//   * a bounty that needs no funding resolves TRUE with no UI at all, so
//     existing posters gain zero friction;
//   * when the balance covers it, ONE tap ("Confirm & hire") resolves true;
//   * when it is short, the gate opens straight on the pay sheet — no
//     "insufficient" summary, no keypad — and resolves true ON ITS OWN once
//     the SERVER says the shortfall is covered, never off the amount the
//     sheet reported;
//   * a cancelled or failed charge resolves nothing and leaves the sheet up:
//     the bounty stays open, nothing is charged;
//   * a partial deposit re-prompts for the remainder;
//   * backing out — by tapping cancel, by unmounting, or by backgrounding —
//     emits accept_funding_abandoned; cancel and unmount also resolve false so
//     the caller never accepts anything;
//   * failures are surfaced by bucketed reason and only funding failures
//     reopen the gate in place.

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockGetRequirement = jest.fn();
const mockTrackEvent = jest.fn();

// lib/supabase pulls in expo-secure-store/Platform at import time; the funding
// service only needs `supabase.rpc` here, and every RPC in this suite is stubbed
// at the service boundary below anyway.
jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn().mockResolvedValue({ data: null, error: null }) },
}));

jest.mock('lib/services/bounty-funding-service', () => {
  const actual = jest.requireActual('lib/services/bounty-funding-service');
  return {
    ...actual,
    // Only the network read is stubbed. classifyAcceptFundingError,
    // describeAcceptFundingFailure and amountBucket run for real, so this suite
    // exercises the same classification the app ships.
    getBountyFundingRequirement: (...args: unknown[]) => mockGetRequirement(...args),
  };
});

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));

// react-native (including Alert.alert and AppState as jest.fns) is already
// mocked globally in jest.setup.js — mocking it again here would strip
// Platform/StyleSheet from everything that imports it transitively.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native');
const mockAlert = RN.Alert.alert as jest.Mock;
const mockAppStateListen = RN.AppState.addEventListener as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAcceptFunding } = require('hooks/useAcceptFunding');

const NEEDS_FUNDING = {
  bountyId: 'b1',
  fundingMode: 'at_accept' as const,
  requiresFunding: true,
  amountRequired: 50,
  alreadyFunded: false,
  posterBalance: 50,
  shortfall: 0,
};

const NEEDS_TOPUP = { ...NEEDS_FUNDING, posterBalance: 20, shortfall: 30 };
const COVERED_AFTER_TOPUP = { ...NEEDS_FUNDING, posterBalance: 50, shortfall: 0 };

const NO_FUNDING = {
  bountyId: 'b2',
  fundingMode: 'at_post' as const,
  requiresFunding: false,
  amountRequired: 0,
  alreadyFunded: true,
  posterBalance: 0,
  shortfall: 0,
};

const eventNames = () => mockTrackEvent.mock.calls.map(c => c[0]);
const propsFor = (name: string) => mockTrackEvent.mock.calls.find(c => c[0] === name)?.[1];
const allPropsFor = (name: string) =>
  mockTrackEvent.mock.calls.filter(c => c[0] === name).map(c => c[1]);

// No real waiting in the settle poll: the hook accepts the cadence as options
// precisely so tests can exercise the poll without fake timers.
const FAST = { settlePollAttempts: 2, settlePollDelayMs: 1 };

/** Opens the gate and returns a probe for the still-pending promise. */
function openGate(result: { current: any }, requirement: unknown, context = {}) {
  mockGetRequirement.mockResolvedValueOnce(requirement);
  const probe = { settled: false, resolved: undefined as boolean | undefined };
  act(() => {
    void result.current.ensureFunded('b1', { variant: 'deferred', ...context }).then((v: boolean) => {
      probe.settled = true;
      probe.resolved = v;
    });
  });
  return probe;
}

describe('useAcceptFunding', () => {
  beforeEach(() => {
    mockGetRequirement.mockReset();
    mockTrackEvent.mockReset();
    mockAlert.mockReset();
    mockAppStateListen.mockClear();
  });

  test('a bounty needing no funding resolves true with no gate shown', async () => {
    mockGetRequirement.mockResolvedValue(NO_FUNDING);
    const { result } = renderHook(() => useAcceptFunding(FAST));

    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.ensureFunded('b2');
    });

    expect(resolved).toBe(true);
    expect(result.current.gate.active).toBe(false);
    // No experiment UI, and no experiment events, for existing posters.
    expect(eventNames()).not.toContain('accept_funding_required');
  });

  describe('balance covers the amount', () => {
    test('shows the confirmation and resolves true on the single confirm tap', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_FUNDING, {
        hunterName: 'Ada',
        hunterAvatar: 'https://cdn/ada.png',
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));
      expect(result.current.gate.active).toBe(true);
      expect(result.current.gate.hunterName).toBe('Ada');
      expect(result.current.gate.hunterAvatar).toBe('https://cdn/ada.png');
      expect(result.current.gate.requirement?.amountRequired).toBe(50);
      // Crucially: still unresolved. Nothing may be accepted yet.
      expect(probe.settled).toBe(false);

      await act(async () => {
        result.current.gate.onConfirm();
      });

      expect(probe.resolved).toBe(true);
      expect(result.current.gate.active).toBe(false);
      expect(propsFor('accept_funding_required')).toMatchObject({ balanceCovers: true });
      expect(propsFor('accept_funding_started')).toMatchObject({ paymentRequired: false });
    });

    test('backing out resolves false, charges nothing, and emits abandoned', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_FUNDING);
      await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));

      await act(async () => {
        result.current.gate.onCancel();
      });

      expect(probe.resolved).toBe(false);
      expect(result.current.gate.active).toBe(false);
      expect(propsFor('accept_funding_abandoned')).toMatchObject({
        stage: 'confirm',
        trigger: 'cancel',
      });
    });
  });

  describe('balance is short: the pay sheet', () => {
    test('opens directly on the pay sheet — no shortfall summary, no keypad', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      openGate(result, NEEDS_TOPUP);

      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));
      expect(result.current.gate.active).toBe(true);
      expect(result.current.gate.requirement?.shortfall).toBe(30);
      expect(result.current.gate.remainderAfterDeposit).toBe(false);
      expect(propsFor('accept_funding_required')).toMatchObject({ balanceCovers: false });
    });

    test('resolves true only after the SERVER reports the shortfall covered, with no further tap', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      act(() => result.current.gate.onPaymentStarted('card'));
      expect(propsFor('accept_funding_started')).toMatchObject({
        paymentRequired: true,
        paymentMethod: 'card',
      });
      // Handing the shortfall to Stripe does not resolve anything.
      expect(probe.settled).toBe(false);

      // The sheet says $30 was captured; the server is the one that decides.
      mockGetRequirement.mockResolvedValueOnce(COVERED_AFTER_TOPUP);
      await act(async () => {
        result.current.gate.onPaymentSucceeded(30);
      });

      await waitFor(() => expect(probe.resolved).toBe(true));
      expect(result.current.gate.active).toBe(false);
      // One read to open, one to settle — the typed/reported amount was never
      // used to decide.
      expect(mockGetRequirement).toHaveBeenCalledTimes(2);
    });

    test('a captured payment the server has not seen yet is waited for, then resolves', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      // /wallet/deposit failed and the webhook is slow: the first re-read
      // still shows the old balance; the next one has the money.
      mockGetRequirement
        .mockResolvedValueOnce(NEEDS_TOPUP)
        .mockResolvedValueOnce(COVERED_AFTER_TOPUP);

      await act(async () => {
        result.current.gate.onPaymentSucceeded(30);
      });

      await waitFor(() => expect(probe.resolved).toBe(true));
      expect(mockGetRequirement).toHaveBeenCalledTimes(3);
      // While waiting the gate was visibly settling, never back on the sheet.
      expect(allPropsFor('accept_funding_failed')).toHaveLength(0);
    });

    test('a partial deposit re-prompts for the remainder instead of resolving', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      // $10 landed (balance 20 -> 30); $20 still short.
      const PARTIAL = { ...NEEDS_TOPUP, posterBalance: 30, shortfall: 20 };
      mockGetRequirement.mockResolvedValue(PARTIAL);

      await act(async () => {
        result.current.gate.onPaymentSucceeded(10);
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));
      expect(result.current.gate.requirement?.shortfall).toBe(20);
      expect(result.current.gate.remainderAfterDeposit).toBe(true);
      expect(probe.settled).toBe(false);
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'partial_deposit' });

      // ...and the remainder going through resolves it.
      mockGetRequirement.mockResolvedValue(COVERED_AFTER_TOPUP);
      await act(async () => {
        result.current.gate.onPaymentSucceeded(20);
      });
      await waitFor(() => expect(probe.resolved).toBe(true));
    });

    test('a deposit that never shows up on the server re-prompts after the bounded wait', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      await act(async () => {
        result.current.gate.onPaymentSucceeded(30);
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));
      // Open + first settle read + FAST.settlePollAttempts polls, then stop.
      expect(mockGetRequirement).toHaveBeenCalledTimes(2 + FAST.settlePollAttempts);
      expect(probe.settled).toBe(false);
      expect(result.current.gate.remainderAfterDeposit).toBe(true);
    });

    test('a cancelled payment leaves the sheet up and resolves nothing', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      act(() => result.current.gate.onPaymentStarted('applePay'));
      act(() => result.current.gate.onPaymentFailed('cancelled'));

      expect(result.current.gate.stage).toBe('pay');
      expect(result.current.gate.active).toBe(true);
      expect(probe.settled).toBe(false);
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'payment_cancelled' });
      // No re-read: nothing was charged, so there is nothing to re-check.
      expect(mockGetRequirement).toHaveBeenCalledTimes(1);

      // The poster can still back out entirely.
      await act(async () => {
        result.current.gate.onCancel();
      });
      expect(probe.resolved).toBe(false);
      expect(propsFor('accept_funding_abandoned')).toMatchObject({ stage: 'pay', trigger: 'cancel' });
    });

    test('a declined payment leaves the sheet up and resolves nothing', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      act(() => result.current.gate.onPaymentStarted('card'));
      act(() => result.current.gate.onPaymentFailed('failed'));

      expect(result.current.gate.stage).toBe('pay');
      expect(probe.settled).toBe(false);
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'payment_failed' });
    });

    test('cancel resolves false and emits abandoned from the pay sheet', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      await act(async () => {
        result.current.gate.onCancel();
      });

      expect(probe.resolved).toBe(false);
      expect(result.current.gate.active).toBe(false);
      expect(propsFor('accept_funding_abandoned')).toMatchObject({ stage: 'pay', trigger: 'cancel' });
    });

    test('cancelling while a deposit is settling stops the poll and resolves false', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      // Never reflects the deposit, so the poll would keep going.
      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      act(() => {
        result.current.gate.onPaymentSucceeded(30);
      });
      await waitFor(() => expect(result.current.gate.stage).toBe('settling'));

      await act(async () => {
        result.current.gate.onCancel();
      });

      expect(probe.resolved).toBe(false);
      expect(result.current.gate.active).toBe(false);
      // Let the abandoned poll drain: it must not re-open the gate or resolve
      // the (already settled) promise a second time.
      await act(async () => {
        await new Promise(r => setTimeout(r, 20));
      });
      expect(result.current.gate.active).toBe(false);
      expect(result.current.gate.stage).toBe('idle');
    });

    test('onConfirm on a sheet whose balance is short does not resolve', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      act(() => result.current.gate.onConfirm());

      expect(result.current.gate.stage).toBe('pay');
      expect(probe.settled).toBe(false);
    });

    test('payment callbacks with no open gate are no-ops', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));

      act(() => {
        result.current.gate.onPaymentStarted('card');
        result.current.gate.onPaymentFailed('cancelled');
        result.current.gate.onPaymentSucceeded(30);
        result.current.gate.onConfirm();
        result.current.gate.onCancel();
      });

      expect(result.current.gate.active).toBe(false);
      expect(mockTrackEvent).not.toHaveBeenCalled();
      expect(mockGetRequirement).not.toHaveBeenCalled();
    });
  });

  describe('abandonment the poster never taps', () => {
    test('unmounting with the gate open emits abandoned and resolves false', async () => {
      const { result, unmount } = renderHook(() => useAcceptFunding(FAST));
      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      unmount();

      await waitFor(() => expect(probe.resolved).toBe(false));
      expect(propsFor('accept_funding_abandoned')).toMatchObject({
        stage: 'pay',
        trigger: 'unmount',
      });
    });

    test('unmounting with no gate open emits nothing', () => {
      const { unmount } = renderHook(() => useAcceptFunding(FAST));
      unmount();
      expect(eventNames()).not.toContain('accept_funding_abandoned');
    });

    test('backgrounding with the gate open emits abandoned but keeps the gate up', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const listener = mockAppStateListen.mock.calls.find(c => c[0] === 'change')?.[1];
      expect(typeof listener).toBe('function');

      const probe = openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      act(() => listener('background'));

      expect(propsFor('accept_funding_abandoned')).toMatchObject({
        stage: 'pay',
        trigger: 'background',
      });
      // The poster may come back: nothing is resolved and the sheet is intact.
      expect(probe.settled).toBe(false);
      expect(result.current.gate.active).toBe(true);
    });

    test('backgrounding during Apple Pay / 3DS authentication is not an abandonment', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));
      const listener = mockAppStateListen.mock.calls.find(c => c[0] === 'change')?.[1];

      openGate(result, NEEDS_TOPUP);
      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

      act(() => result.current.gate.onPaymentStarted('applePay'));
      act(() => listener('background'));
      // 'inactive' (the Apple Pay sheet itself) and 'active' never count.
      act(() => listener('inactive'));
      act(() => listener('active'));

      expect(eventNames()).not.toContain('accept_funding_abandoned');
    });

    test('backgrounding with no gate open emits nothing', () => {
      renderHook(() => useAcceptFunding(FAST));
      const listener = mockAppStateListen.mock.calls.find(c => c[0] === 'change')?.[1];
      act(() => listener('background'));
      expect(eventNames()).not.toContain('accept_funding_abandoned');
    });
  });

  describe('handleAcceptFailure', () => {
    test('insufficient funds reopens on the pay sheet for recovery in place', async () => {
      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      const { result } = renderHook(() => useAcceptFunding(FAST));

      act(() => {
        void result.current.handleAcceptFailure(
          new Error('insufficient_funds_for_escrow'),
          'b1',
          { variant: 'deferred' }
        );
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));
      expect(mockAlert).not.toHaveBeenCalled();
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'insufficient_funds' });
    });

    test('insufficient funds whose re-read says covered lands on confirm, not pay', async () => {
      // The balance moved between the rejection and the re-read (another
      // device topped up). The server, not the error, picks the sheet.
      mockGetRequirement.mockResolvedValue(NEEDS_FUNDING);
      const { result } = renderHook(() => useAcceptFunding(FAST));

      act(() => {
        void result.current.handleAcceptFailure(new Error('insufficient_funds_for_escrow'), 'b1');
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));
    });

    test('bounty_not_funded reopens at confirm, not the pay sheet', async () => {
      // Regression: this used to classify as 'insufficient_funds' and jump
      // straight to the "add funds" screen. A poster with $12 accepting a $3
      // bounty was told to top up. bounty_not_funded says nothing about the
      // balance, so it must re-check and let the server decide.
      mockGetRequirement.mockResolvedValue(NEEDS_FUNDING); // shortfall 0
      const { result } = renderHook(() => useAcceptFunding(FAST));

      act(() => {
        void result.current.handleAcceptFailure(new Error('bounty_not_funded'), 'b1', {
          variant: 'deferred',
        });
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));
      expect(mockAlert).not.toHaveBeenCalled();
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'not_funded' });
    });

    test('bounty_not_funded still opens the pay sheet when truly short', async () => {
      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      const { result } = renderHook(() => useAcceptFunding(FAST));

      act(() => {
        void result.current.handleAcceptFailure(new Error('bounty_not_funded'), 'b1');
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('pay'));
    });

    test('other failures alert and resolve false without reopening the gate', async () => {
      const { result } = renderHook(() => useAcceptFunding(FAST));

      let retry: boolean | undefined;
      await act(async () => {
        retry = await result.current.handleAcceptFailure(new Error('bounty_not_open'), 'b1');
      });

      expect(retry).toBe(false);
      expect(result.current.gate.active).toBe(false);
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });

    test('never reports a raw database message to analytics', async () => {
      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      const { result } = renderHook(() => useAcceptFunding(FAST));

      // Deliberately NOT awaited: an insufficient-funds failure reopens the
      // gate, so the returned promise stays pending until the poster pays or
      // cancels. Awaiting it here would hang the test, which is exactly the
      // behaviour the acceptance flow relies on.
      act(() => {
        void result.current.handleAcceptFailure(
          new Error('Insufficient funds: new balance would be -420.69 for user 3f2a...'),
          'b1'
        );
      });
      await waitFor(() => expect(propsFor('accept_funding_failed')).toBeDefined());

      const props = propsFor('accept_funding_failed');
      expect(props.reason).toBe('insufficient_funds');
      expect(JSON.stringify(props)).not.toContain('420.69');
      expect(JSON.stringify(props)).not.toContain('3f2a');
    });
  });

  test('analytics never carry an exact amount or balance', async () => {
    const { result } = renderHook(() => useAcceptFunding(FAST));
    openGate(result, NEEDS_TOPUP);
    await waitFor(() => expect(result.current.gate.stage).toBe('pay'));

    act(() => result.current.gate.onPaymentStarted('card'));
    act(() => result.current.gate.onPaymentFailed('failed'));
    await act(async () => {
      result.current.gate.onCancel();
    });

    const serialised = JSON.stringify(mockTrackEvent.mock.calls);
    // $50 required -> the '50_99' bucket, not the figure itself.
    expect(serialised).toContain('50_99');
    expect(serialised).not.toContain('"50"');
    expect(serialised).not.toContain('"30"');
    expect(serialised).not.toMatch(/"amountRequired"/);
    expect(serialised).not.toMatch(/"posterBalance"/);
    expect(serialised).not.toMatch(/"shortfall"/);
  });
});
