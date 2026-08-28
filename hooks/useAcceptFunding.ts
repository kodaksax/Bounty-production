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
 * passing implies money moved.
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
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

export type AcceptFundingStage =
  /** Gate closed. */
  | 'idle'
  /** Reading the authoritative amount from the server. */
  | 'checking'
  /** "You'll be charged $X to secure this bounty." */
  | 'confirm'
  /** Balance doesn't cover it — shortfall summary. */
  | 'insufficient'
  /** Top-up keypad, pre-filled with the shortfall. */
  | 'topup';

export interface AcceptFundingContext {
  /** Shown in the confirmation copy. Falls back to "this hunter". */
  hunterName?: string;
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
  /** Poster agreed to the charge. */
  onConfirm: () => void;
  /** From the insufficient-balance summary into the top-up keypad. */
  onAddFunds: () => void;
  /** Top-up finished — re-checks with the server, never with local state. */
  onTopUpComplete: () => void;
  /** Back out of the top-up keypad to the shortfall summary. */
  onBackFromTopUp: () => void;
  /** Poster backed out entirely. Nothing is charged, nobody is assigned. */
  onCancel: () => void;
}

interface PendingGate {
  resolve: (proceed: boolean) => void;
  bountyId: string;
  context: AcceptFundingContext;
}

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

export function useAcceptFunding(): UseAcceptFundingResult {
  const [stage, setStage] = useState<AcceptFundingStage>('idle');
  const [requirement, setRequirement] = useState<BountyFundingRequirement | null>(null);
  const [hunterName, setHunterName] = useState('this hunter');
  const pendingRef = useRef<PendingGate | null>(null);

  const close = useCallback((proceed: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setStage('idle');
    setRequirement(null);
    pending?.resolve(proceed);
  }, []);

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

  const openGate = useCallback(
    async (
      bountyId: string | number,
      context: AcceptFundingContext,
      startStage: Exclude<AcceptFundingStage, 'idle' | 'checking'>
    ): Promise<boolean> => {
      const id = String(bountyId);
      setStage('checking');
      setHunterName(context.hunterName?.trim() || 'this hunter');

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

      // Jump straight past the confirmation when we already know the balance
      // is short — asking someone to confirm a charge they cannot make yet is
      // a dead end.
      const resolvedStage =
        startStage === 'confirm' && req.shortfall > 0 ? 'insufficient' : startStage;
      setStage(resolvedStage);

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
      // The two reasons take different entry points on purpose. Only
      // 'insufficient_funds' is a statement about the balance, so only it may
      // jump straight to the shortfall summary. 'not_funded' means the DB guard
      // refused a transition for want of an escrow row, which says nothing
      // about what the poster can afford — so it re-enters at 'confirm' and
      // lets openGate re-read the server. If the balance really is short,
      // openGate itself routes to 'insufficient'; if it isn't, the poster gets
      // a retry instead of being told to add funds they already have.
      if (reason === 'insufficient_funds') {
        return openGate(bountyId, context, 'insufficient');
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

    analyticsService.trackEvent('accept_funding_started', eventProps(requirement, pending.context));

    if (requirement.shortfall > 0) {
      setStage('insufficient');
      return;
    }
    close(true);
  }, [close, eventProps, requirement]);

  const onAddFunds = useCallback(() => setStage('topup'), []);
  const onBackFromTopUp = useCallback(() => setStage('insufficient'), []);

  const onTopUpComplete = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;

    // Re-read from the server rather than trusting the wallet context's
    // optimistic balance. The deposit is confirmed by a Stripe webhook, and a
    // partial top-up (the poster can edit the pre-filled amount) is a normal
    // outcome — so "did this actually cover it" is a server question.
    const req = await getBountyFundingRequirement(pending.bountyId);
    setRequirement(req);

    if (!req.requiresFunding || req.shortfall <= 0) {
      close(true);
      return;
    }
    setStage('insufficient');
  }, [close]);

  const onCancel = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) {
      analyticsService.trackEvent('accept_funding_abandoned', {
        ...eventProps(requirement, pending.context),
        stage,
      });
    }
    close(false);
  }, [close, eventProps, requirement, stage]);

  const gate: AcceptFundingGate = {
    // 'checking' is deliberately NOT active: it lasts one RPC, and flashing a
    // gate up for a bounty that turns out to need no funding at all would put
    // the experiment's UI in front of every existing poster.
    active: stage === 'confirm' || stage === 'insufficient' || stage === 'topup',
    stage,
    requirement,
    hunterName,
    onConfirm,
    onAddFunds,
    onTopUpComplete: () => {
      void onTopUpComplete();
    },
    onBackFromTopUp,
    onCancel,
  };

  return { gate, ensureFunded, handleAcceptFailure };
}

export default useAcceptFunding;
