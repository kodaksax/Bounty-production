/**
 * The pay-at-accept gate: everything that has to happen between the poster
 * tapping "Select" on a hunter and the acceptance actually being attempted.
 *
 * Split out of useAcceptRequest on purpose. useAcceptRequest is a large
 * optimistic-UI orchestrator; the money decision needs to be readable and
 * testable on its own, and both screens that accept hunters
 * (app/tabs/postings-screen.tsx and app/tabs/inbox-screen.tsx) need the exact
 * same behaviour.
 *
 * THE SHAPE OF THE GATE
 * ---------------------
 * One sheet, two variants, decided by the server's `shortfall`:
 *
 *   shortfall <= 0  ->  'confirm'   "Confirm & hire"      (1 tap)
 *   shortfall  > 0  ->  'pay'       "Pay $X & hire"       (1 tap + payment auth)
 *
 * The 'pay' variant charges exactly the shortfall through the existing deposit
 * path (hooks/use-wallet-deposit) and, once the server confirms the balance,
 * resolves on its own so useAcceptRequest calls acceptRequest without the
 * poster tapping anything else. The old confirm -> insufficient -> top-up ->
 * re-check chain that this replaces lost posters at every hop; the funnel
 * showed 0/8 organic pay-at-accept hires and a poster who reached
 * balanceCovers=false and never came back.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not fund anything. Reserving escrow happens server-side, inside the
 * same transaction as the acceptance (fn_accept_bounty_request ->
 * fn_reserve_escrow_for_acceptance). All this hook does is make sure the
 * poster has (a) seen the amount and agreed to it and (b) got enough balance
 * for that transaction to succeed — so the common case is a clean success
 * rather than a server-side rejection the poster has to interpret.
 *
 * That ordering matters: because the gate is advisory, a poster whose balance
 * changes between the gate and the acceptance simply gets the acceptance
 * rejected and lands back in the gate. There is no window in which the gate
 * passing implies money moved. The deposit the 'pay' variant makes is a
 * wallet top-up, not an escrow: a cancelled or failed one leaves the bounty
 * open with nothing charged, and a successful one that somehow still leaves
 * the balance short is simply re-prompted for the remainder.
 */

import {
  amountBucket,
  classifyAcceptFundingError,
  describeAcceptFundingFailure,
  getBountyFundingRequirement,
  type AcceptFundingFailureReason,
  type BountyFundingRequirement,
} from 'lib/services/bounty-funding-service';
import { analyticsService } from 'lib/services/analytics-service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

export type AcceptFundingStage =
  /** Gate closed. */
  | 'idle'
  /** Reading the authoritative amount from the server. */
  | 'checking'
  /** Balance covers it — "Confirm & hire". */
  | 'confirm'
  /** Balance is short — "Pay $shortfall & hire" runs the deposit sheet. */
  | 'pay'
  /**
   * The deposit was captured; waiting for the server to reflect it. Lasts one
   * RPC in the common case, a short bounded poll if the webhook is slow.
   */
  | 'settling';

/** How the deposit sheet ended when it did not end in a captured payment. */
export type AcceptFundingPaymentOutcome =
  /** Poster dismissed Apple Pay / the card sheet. */
  | 'cancelled'
  /** Stripe or the network refused the charge. */
  | 'failed';

export type AcceptFundingPaymentMethod = 'card' | 'applePay';

export interface AcceptFundingContext {
  /** Shown in the confirmation copy. Falls back to "this hunter". */
  hunterName?: string;
  /** Shown beside the name. Absent -> initial-letter fallback. */
  hunterAvatar?: string | null;
  /** Tags the experiment arm onto every event this gate emits. */
  variant?: string;
}

export interface AcceptFundingGate {
  /** True whenever the gate should be rendered over the current screen. */
  active: boolean;
  stage: AcceptFundingStage;
  /** Server-authoritative amounts. Null until the check resolves. */
  requirement: BountyFundingRequirement | null;
  hunterName: string;
  hunterAvatar: string | null;
  /**
   * True when a deposit went through but the server still reports a
   * shortfall (a partial deposit, or a balance that moved underneath us). The
   * sheet is showing the remainder, not the original amount.
   */
  remainderAfterDeposit: boolean;
  /** Balance covers it and the poster agreed. Resolves the gate `true`. */
  onConfirm: () => void;
  /** The sheet handed the shortfall to Stripe / Apple Pay. */
  onPaymentStarted: (method: AcceptFundingPaymentMethod) => void;
  /**
   * The deposit was captured. Re-checks with the server — never with the
   * typed amount or the wallet context's optimistic balance — and resolves
   * `true` on its own once the balance covers the requirement.
   */
  onPaymentSucceeded: (amount: number) => void;
  /** No money moved. The sheet stays up; the bounty stays open. */
  onPaymentFailed: (outcome: AcceptFundingPaymentOutcome) => void;
  /** Poster backed out entirely. Nothing is charged, nobody is assigned. */
  onCancel: () => void;
}

interface PendingGate {
  resolve: (proceed: boolean) => void;
  bountyId: string;
  context: AcceptFundingContext;
}

export interface UseAcceptFundingOptions {
  /**
   * How many times to re-read the requirement after a captured deposit before
   * giving up on the webhook and re-prompting. The deposit is normally
   * persisted synchronously (/wallet/deposit), so the first read usually
   * settles it; the poll only matters when that call failed and the Stripe
   * webhook is the thing that will land the money.
   */
  settlePollAttempts?: number;
  settlePollDelayMs?: number;
}

const DEFAULT_SETTLE_POLL_ATTEMPTS = 6;
const DEFAULT_SETTLE_POLL_DELAY_MS = 1500;

export interface UseAcceptFundingResult {
  gate: AcceptFundingGate;
  /**
   * Resolve `true` when the acceptance may be attempted, `false` when the
   * poster backed out.
   *
   * Resolves `true` immediately — with no UI at all — for any bounty that does
   * not require funding at acceptance: for-honor bounties, $0 bounties, and
   * every legacy 'at_post' bounty that was already escrowed when it was
   * posted. Existing posters therefore see no new friction whatsoever.
   */
  ensureFunded: (bountyId: string | number, context?: AcceptFundingContext) => Promise<boolean>;
  /**
   * Handle a failed acceptance. Returns `true` if the poster resolved the
   * problem and the acceptance should be retried once.
   */
  handleAcceptFailure: (
    error: unknown,
    bountyId: string | number,
    context?: AcceptFundingContext
  ) => Promise<boolean>;
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function useAcceptFunding(options: UseAcceptFundingOptions = {}): UseAcceptFundingResult {
  const settlePollAttempts = options.settlePollAttempts ?? DEFAULT_SETTLE_POLL_ATTEMPTS;
  const settlePollDelayMs = options.settlePollDelayMs ?? DEFAULT_SETTLE_POLL_DELAY_MS;

  const [stage, setStage] = useState<AcceptFundingStage>('idle');
  const [requirement, setRequirement] = useState<BountyFundingRequirement | null>(null);
  const [hunterName, setHunterName] = useState('this hunter');
  const [hunterAvatar, setHunterAvatar] = useState<string | null>(null);
  const [remainderAfterDeposit, setRemainderAfterDeposit] = useState(false);
  const pendingRef = useRef<PendingGate | null>(null);
  // Mirrors of state for the AppState listener and the unmount cleanup, which
  // are registered once and must not read a stale closure.
  const stageRef = useRef<AcceptFundingStage>('idle');
  const requirementRef = useRef<BountyFundingRequirement | null>(null);
  // True from "handed to Stripe / Apple Pay" until the sheet reports back.
  // Apple Pay and 3DS can send the app to the background mid-authentication;
  // that is not an abandonment and must not be counted as one.
  const paymentInFlightRef = useRef(false);

  stageRef.current = stage;
  requirementRef.current = requirement;

  /** Shared analytics properties. Never carries an exact amount or balance. */
  const eventProps = useCallback(
    (req: BountyFundingRequirement | null, context: AcceptFundingContext) => ({
      bountyId: req?.bountyId,
      amountBucket: amountBucket(req?.amountRequired ?? 0),
      fundingMode: req?.fundingMode ?? 'at_post',
      variant: context.variant ?? 'unknown',
      firstBounty: req?.fundingMode === 'at_accept',
      source: 'accept_flow',
    }),
    []
  );

  const trackAbandoned = useCallback(
    (pending: PendingGate, trigger: 'cancel' | 'background' | 'unmount') => {
      analyticsService.trackEvent('accept_funding_abandoned', {
        ...eventProps(requirementRef.current, pending.context),
        stage: stageRef.current,
        trigger,
      });
    },
    [eventProps]
  );

  const close = useCallback((proceed: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    paymentInFlightRef.current = false;
    setStage('idle');
    setRequirement(null);
    setRemainderAfterDeposit(false);
    pending?.resolve(proceed);
  }, []);

  // Abandonment that never goes through onCancel: the screen unmounting with
  // the gate open (tab switch, sign-out, navigation reset) and the app being
  // backgrounded. Both are exactly the "never returned" exits the funnel was
  // blind to.
  //
  // Unmount also RESOLVES the pending promise (false), so the awaiting
  // useAcceptRequest call settles instead of hanging forever and nothing
  // downstream is accepted for a gate nobody can see.
  //
  // Background does not close the gate: the poster may well come back, and
  // closing under an in-flight payment would be actively harmful.
  useEffect(() => {
    const subscription = AppState?.addEventListener?.('change', next => {
      if (next !== 'background') return;
      const pending = pendingRef.current;
      if (!pending) return;
      if (paymentInFlightRef.current || stageRef.current === 'settling') return;
      trackAbandoned(pending, 'background');
    });

    return () => {
      subscription?.remove?.();
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      paymentInFlightRef.current = false;
      trackAbandoned(pending, 'unmount');
      pending.resolve(false);
    };
  }, [trackAbandoned]);

  const openGate = useCallback(
    async (
      bountyId: string | number,
      context: AcceptFundingContext,
      startStage: 'confirm' | 'pay'
    ): Promise<boolean> => {
      const id = String(bountyId);
      setStage('checking');
      setHunterName(context.hunterName?.trim() || 'this hunter');
      setHunterAvatar(context.hunterAvatar?.trim() || null);
      setRemainderAfterDeposit(false);

      const req = await getBountyFundingRequirement(id);

      // Nothing to charge: legacy bounty already escrowed at post time,
      // for-honor, or $0. Proceed with zero added friction.
      //
      // A missing answer is treated the same way. That is the safe direction:
      // it lets an already-funded bounty through (the common case by far) and,
      // for an unfunded one, the acceptance is refused server-side by
      // trg_bounties_enforce_funding_before_work and lands back here through
      // handleAcceptFailure. This gate is UX; it is never the thing standing
      // between a hunter and unpaid work.
      if (!req?.requiresFunding) {
        setStage('idle');
        setRequirement(null);
        return true;
      }

      setRequirement(req);

      analyticsService.trackEvent('accept_funding_required', {
        ...eventProps(req, context),
        // Whether the poster can pay right now without topping up. The single
        // most useful cut of this funnel: it separates "hesitated at the price"
        // from "had to go and find a card".
        balanceCovers: req.shortfall <= 0,
      });

      // The server decides which variant of the sheet the poster sees. A
      // caller asking for 'pay' after an insufficient_funds rejection still
      // gets 'confirm' if the re-read says the balance now covers it.
      setStage(req.shortfall > 0 ? 'pay' : 'confirm');

      return new Promise<boolean>(resolve => {
        pendingRef.current = { resolve, bountyId: id, context };
      });
    },
    [eventProps]
  );

  const ensureFunded = useCallback(
    async (bountyId: string | number, context: AcceptFundingContext = {}) => {
      try {
        return await openGate(bountyId, context, 'confirm');
      } catch {
        // A failure to READ the requirement must not block acceptance of an
        // already-funded bounty. Let the attempt through; the DB trigger is the
        // real guard, and it will reject an unfunded one.
        setStage('idle');
        setRequirement(null);
        return true;
      }
    },
    [openGate]
  );

  const handleAcceptFailure = useCallback(
    async (error: unknown, bountyId: string | number, context: AcceptFundingContext = {}) => {
      const reason: AcceptFundingFailureReason = classifyAcceptFundingError(error);

      analyticsService.trackEvent('accept_funding_failed', {
        bountyId: String(bountyId),
        // A bucketed category, never the raw DB message — those interpolate
        // amounts and ids.
        reason,
        variant: context.variant ?? 'unknown',
        source: 'accept_flow',
      });

      // Recoverable in place: reopen the gate rather than re-navigating.
      //
      // Both funding reasons re-read the server, which picks the sheet
      // variant. Only 'insufficient_funds' is a statement about the balance;
      // 'not_funded' means the DB guard refused a transition for want of an
      // escrow row, which says nothing about what the poster can afford — so
      // a poster with plenty of money gets a retry, not a payment sheet.
      if (reason === 'insufficient_funds') {
        return openGate(bountyId, context, 'pay');
      }
      if (reason === 'not_funded') {
        return openGate(bountyId, context, 'confirm');
      }

      const { title, message } = describeAcceptFundingFailure(reason);
      Alert.alert(title, message, [{ text: 'OK' }]);
      return false;
    },
    [openGate]
  );

  const onConfirm = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || !requirement) return;

    analyticsService.trackEvent('accept_funding_started', {
      ...eventProps(requirement, pending.context),
      paymentRequired: false,
    });

    // Defensive: the sheet only offers "Confirm & hire" when the balance
    // covers it, but if the requirement changed underneath, fall back to the
    // pay variant rather than resolving a gate the server would reject.
    if (requirement.shortfall > 0) {
      setStage('pay');
      return;
    }
    close(true);
  }, [close, eventProps, requirement]);

  const onPaymentStarted = useCallback(
    (method: AcceptFundingPaymentMethod) => {
      const pending = pendingRef.current;
      if (!pending) return;
      paymentInFlightRef.current = true;
      analyticsService.trackEvent('accept_funding_started', {
        ...eventProps(requirementRef.current, pending.context),
        paymentRequired: true,
        paymentMethod: method,
      });
    },
    [eventProps]
  );

  const onPaymentFailed = useCallback(
    (outcome: AcceptFundingPaymentOutcome) => {
      const pending = pendingRef.current;
      paymentInFlightRef.current = false;
      if (!pending) return;
      analyticsService.trackEvent('accept_funding_failed', {
        ...eventProps(requirementRef.current, pending.context),
        reason: outcome === 'cancelled' ? 'payment_cancelled' : 'payment_failed',
      });
      // Stay on the sheet. Nothing was charged; the poster can retry or back
      // out, and the bounty is still open either way.
      setStage('pay');
    },
    [eventProps]
  );

  const onPaymentSucceeded = useCallback(
    async (paidAmount: number) => {
      const pending = pendingRef.current;
      paymentInFlightRef.current = false;
      if (!pending) return;

      setStage('settling');
      const before = requirementRef.current;

      // Re-read from the server rather than trusting the wallet context's
      // optimistic balance. /wallet/deposit normally persists the deposit
      // before the sheet reports success, so the first read settles it; when
      // that call failed the Stripe webhook is what lands the money, and we
      // give it a bounded wait before treating the balance as final.
      let req = await getBountyFundingRequirement(pending.bountyId);
      const depositReflected = (r: BountyFundingRequirement) =>
        !r.requiresFunding ||
        r.shortfall <= 0 ||
        r.posterBalance >= (before?.posterBalance ?? 0) + paidAmount - 0.01;

      for (let attempt = 0; attempt < settlePollAttempts && !depositReflected(req); attempt++) {
        await wait(settlePollDelayMs);
        // Cancelled or unmounted while we waited; the gate is no longer ours.
        if (pendingRef.current !== pending) return;
        req = await getBountyFundingRequirement(pending.bountyId);
      }
      if (pendingRef.current !== pending) return;

      setRequirement(req);

      if (!req.requiresFunding || req.shortfall <= 0) {
        // Covered. Resolve without another tap — useAcceptRequest takes it
        // from here and calls acceptRequest.
        close(true);
        return;
      }

      // Money arrived but not enough (or the balance moved underneath us).
      // Re-prompt for exactly the remainder. Recorded as a failure reason so
      // the funnel can see how often the single-sheet promise is broken.
      analyticsService.trackEvent('accept_funding_failed', {
        ...eventProps(req, pending.context),
        reason: 'partial_deposit',
      });
      setRemainderAfterDeposit(true);
      setStage('pay');
    },
    [close, eventProps, settlePollAttempts, settlePollDelayMs]
  );

  const onCancel = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) trackAbandoned(pending, 'cancel');
    close(false);
  }, [close, trackAbandoned]);

  const gate: AcceptFundingGate = {
    // 'checking' is deliberately NOT active: it lasts one RPC, and flashing a
    // gate up for a bounty that turns out to need no funding at all would put
    // the experiment's UI in front of every existing poster.
    active: stage === 'confirm' || stage === 'pay' || stage === 'settling',
    stage,
    requirement,
    hunterName,
    hunterAvatar,
    remainderAfterDeposit,
    onConfirm,
    onPaymentStarted,
    onPaymentSucceeded: (amount: number) => {
      void onPaymentSucceeded(amount);
    },
    onPaymentFailed,
    onCancel,
  };

  return { gate, ensureFunded, handleAcceptFailure };
}

export default useAcceptFunding;
