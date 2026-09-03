// The pay-at-accept gate state machine (hooks/useAcceptFunding).
//
// This is the seam between "the poster tapped Select" and "the acceptance is
// attempted". The invariants under test:
//
//   * a bounty that needs no funding resolves TRUE with no UI at all, so
//     existing posters gain zero friction;
//   * the gate resolves TRUE only after the poster has both seen the amount and
//     has the balance for it;
//   * backing out resolves FALSE, and the caller must then not accept anything;
//   * "did the top-up cover it" is re-read from the SERVER, never from the
//     amount the poster typed (partial top-ups are a normal outcome);
//   * failures are surfaced by bucketed reason and only insufficient funds
//     reopens the gate in place.

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

// react-native (including Alert.alert as a jest.fn) is already mocked globally
// in jest.setup.js — mocking it again here would strip Platform/StyleSheet from
// everything that imports it transitively.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockAlert = require('react-native').Alert.alert as jest.Mock;

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

describe('useAcceptFunding', () => {
  beforeEach(() => {
    mockGetRequirement.mockReset();
    mockTrackEvent.mockReset();
    mockAlert.mockReset();
  });

  test('a bounty needing no funding resolves true with no gate shown', async () => {
    mockGetRequirement.mockResolvedValue(NO_FUNDING);
    const { result } = renderHook(() => useAcceptFunding());

    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.ensureFunded('b2');
    });

    expect(resolved).toBe(true);
    expect(result.current.gate.active).toBe(false);
    // No experiment UI, and no experiment events, for existing posters.
    expect(eventNames()).not.toContain('accept_funding_required');
  });

  test('shows the confirmation, and resolves true only once confirmed', async () => {
    mockGetRequirement.mockResolvedValue(NEEDS_FUNDING);
    const { result } = renderHook(() => useAcceptFunding());

    let settled = false;
    let resolved: boolean | undefined;
    act(() => {
      result.current
        .ensureFunded('b1', { hunterName: 'Ada', variant: 'deferred' })
        .then((v: boolean) => {
          settled = true;
          resolved = v;
        });
    });

    await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));
    expect(result.current.gate.active).toBe(true);
    expect(result.current.gate.hunterName).toBe('Ada');
    expect(result.current.gate.requirement?.amountRequired).toBe(50);
    // Crucially: still unresolved. Nothing may be accepted yet.
    expect(settled).toBe(false);

    await act(async () => {
      result.current.gate.onConfirm();
    });

    expect(resolved).toBe(true);
    expect(result.current.gate.active).toBe(false);
    expect(eventNames()).toEqual(
      expect.arrayContaining(['accept_funding_required', 'accept_funding_started'])
    );
  });

  test('backing out resolves false and charges nothing', async () => {
    mockGetRequirement.mockResolvedValue(NEEDS_FUNDING);
    const { result } = renderHook(() => useAcceptFunding());

    let resolved: boolean | undefined;
    act(() => {
      result.current.ensureFunded('b1', { variant: 'deferred' }).then((v: boolean) => {
        resolved = v;
      });
    });
    await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));

    await act(async () => {
      result.current.gate.onCancel();
    });

    expect(resolved).toBe(false);
    expect(result.current.gate.active).toBe(false);
    expect(eventNames()).toContain('accept_funding_abandoned');
  });

  test('skips the confirmation and opens the shortfall summary when the balance is short', async () => {
    mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
    const { result } = renderHook(() => useAcceptFunding());

    act(() => {
      void result.current.ensureFunded('b1', { variant: 'deferred' });
    });

    // Confirming a charge you cannot yet make is a dead end — go straight to
    // the thing the poster actually has to do.
    await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));
    expect(propsFor('accept_funding_required')).toMatchObject({ balanceCovers: false });
  });

  test('a partial top-up returns to the shortfall summary instead of proceeding', async () => {
    mockGetRequirement
      .mockResolvedValueOnce(NEEDS_TOPUP)
      // Poster edited the pre-filled amount down and only added $10.
      .mockResolvedValueOnce({ ...NEEDS_TOPUP, posterBalance: 30, shortfall: 20 });

    const { result } = renderHook(() => useAcceptFunding());
    let settled = false;
    act(() => {
      void result.current.ensureFunded('b1', { variant: 'deferred' }).then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));

    act(() => result.current.gate.onAddFunds());
    expect(result.current.gate.stage).toBe('topup');

    await act(async () => {
      result.current.gate.onTopUpComplete();
    });

    await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));
    expect(result.current.gate.requirement?.shortfall).toBe(20);
    expect(settled).toBe(false);
  });

  test('a sufficient top-up resolves true, using the server answer not the typed amount', async () => {
    mockGetRequirement
      .mockResolvedValueOnce(NEEDS_TOPUP)
      .mockResolvedValueOnce({ ...NEEDS_TOPUP, posterBalance: 50, shortfall: 0 });

    const { result } = renderHook(() => useAcceptFunding());
    let resolved: boolean | undefined;
    act(() => {
      void result.current.ensureFunded('b1', { variant: 'deferred' }).then((v: boolean) => {
        resolved = v;
      });
    });
    await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));

    act(() => result.current.gate.onAddFunds());
    await act(async () => {
      result.current.gate.onTopUpComplete();
    });

    await waitFor(() => expect(resolved).toBe(true));
    expect(mockGetRequirement).toHaveBeenCalledTimes(2);
  });

  test('back from the top-up keypad returns to the summary without resolving', async () => {
    mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
    const { result } = renderHook(() => useAcceptFunding());

    let settled = false;
    act(() => {
      void result.current.ensureFunded('b1').then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));

    act(() => result.current.gate.onAddFunds());
    act(() => result.current.gate.onBackFromTopUp());

    expect(result.current.gate.stage).toBe('insufficient');
    expect(settled).toBe(false);
  });

  describe('handleAcceptFailure', () => {
    test('insufficient funds reopens the gate for recovery in place', async () => {
      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      const { result } = renderHook(() => useAcceptFunding());

      act(() => {
        void result.current.handleAcceptFailure(
          new Error('insufficient_funds_for_escrow'),
          'b1',
          { variant: 'deferred' }
        );
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));
      expect(mockAlert).not.toHaveBeenCalled();
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'insufficient_funds' });
    });

    test('bounty_not_funded reopens at confirm, not the shortfall screen', async () => {
      // Regression: this used to classify as 'insufficient_funds' and jump
      // straight to the "add funds" screen. A poster with $12 accepting a $3
      // bounty was told to top up. bounty_not_funded says nothing about the
      // balance, so it must re-check and let the server decide.
      mockGetRequirement.mockResolvedValue(NEEDS_FUNDING); // shortfall 0
      const { result } = renderHook(() => useAcceptFunding());

      act(() => {
        void result.current.handleAcceptFailure(new Error('bounty_not_funded'), 'b1', {
          variant: 'deferred',
        });
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('confirm'));
      expect(result.current.gate.stage).not.toBe('insufficient');
      expect(mockAlert).not.toHaveBeenCalled();
      expect(propsFor('accept_funding_failed')).toMatchObject({ reason: 'not_funded' });
    });

    test('bounty_not_funded still shows the shortfall screen when truly short', async () => {
      // The re-check is authoritative in both directions: same error, but this
      // poster genuinely cannot cover it, so openGate routes to 'insufficient'.
      mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
      const { result } = renderHook(() => useAcceptFunding());

      act(() => {
        void result.current.handleAcceptFailure(new Error('bounty_not_funded'), 'b1');
      });

      await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));
    });

    test('other failures alert and resolve false without reopening the gate', async () => {
      const { result } = renderHook(() => useAcceptFunding());

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
      const { result } = renderHook(() => useAcceptFunding());

      // Deliberately NOT awaited: an insufficient-funds failure reopens the
      // gate, so the returned promise stays pending until the poster tops up or
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
    mockGetRequirement.mockResolvedValue(NEEDS_TOPUP);
    const { result } = renderHook(() => useAcceptFunding());

    act(() => {
      void result.current.ensureFunded('b1', { variant: 'deferred' });
    });
    await waitFor(() => expect(result.current.gate.stage).toBe('insufficient'));

    const serialised = JSON.stringify(mockTrackEvent.mock.calls);
    // $50 required -> the '50_99' bucket, not the figure itself.
    expect(serialised).toContain('50_99');
    expect(serialised).not.toContain('"50"');
    expect(serialised).not.toMatch(/"amountRequired"/);
    expect(serialised).not.toMatch(/"posterBalance"/);
  });
});
