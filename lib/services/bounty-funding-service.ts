/**
 * Client surface for deferred ("post first, pay at accept") bounty funding.
 *
 * Every number this module returns comes from the server. The client never
 * computes what to charge: the amount is read from the locked `bounties` row
 * inside fn_get_bounty_funding_requirement, which is the same row
 * fn_reserve_escrow_for_acceptance escrows against. Two different code paths
 * reading the same authoritative column is the point — a client-side
 * "bountyAmount" prop could drift from what actually gets debited.
 *
 * See supabase/migrations/20260823120000_deferred_bounty_funding_pay_at_accept.sql.
 */

import type { PostgrestError } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';

export interface BountyFundingRequirement {
  bountyId: string;
  /** 'at_accept' means this bounty was posted unfunded. */
  fundingMode: 'at_post' | 'at_accept';
  /** True when escrow still has to be reserved before a hunter can be accepted. */
  requiresFunding: boolean;
  /** Authoritative amount the poster's wallet will be debited. 0 when none is due. */
  amountRequired: number;
  /** True once a completed escrow wallet_transactions row exists for this bounty. */
  alreadyFunded: boolean;
  /** The poster's current custodial wallet balance, per the server. */
  posterBalance: number;
  /** max(0, amountRequired - posterBalance). 0 when the balance already covers it. */
  shortfall: number;
}

/**
 * Why an acceptance could not be funded. Kept as a small closed set so
 * analytics can bucket failures without ever carrying a raw DB message (which
 * can contain amounts and ids) into PostHog.
 */
export type AcceptFundingFailureReason =
  | 'insufficient_funds'
  /**
   * The DB guard (trg_bounties_enforce_funding_before_work) refused the
   * transition because no escrow exists. Deliberately NOT folded into
   * 'insufficient_funds': it says nothing about the poster's balance, and a
   * poster with plenty of money was being told to add funds. In practice it
   * means the acceptance took a path that did not reserve escrow first — the
   * legacy sequential fallback in bounty-request-service, or a server whose
   * fn_accept_bounty_request is missing the reservation step.
   */
  | 'not_funded'
  /** Someone else's action changed the bounty/request underneath this attempt. */
  | 'state_conflict'
  /** The poster edited the bounty in a way the price freeze forbids. */
  | 'terms_locked'
  | 'not_authorized'
  | 'account_inactive'
  | 'network'
  | 'unknown';

const NO_FUNDING_REQUIRED: Omit<BountyFundingRequirement, 'bountyId'> = {
  fundingMode: 'at_post',
  requiresFunding: false,
  amountRequired: 0,
  alreadyFunded: true,
  posterBalance: 0,
  shortfall: 0,
};

/**
 * Ask the server what (if anything) must be funded before this bounty's hunter
 * can be accepted.
 *
 * Returns a "nothing required" answer rather than throwing when the RPC is
 * unavailable — i.e. on an environment where the migration has not been applied
 * yet. That is deliberately safe: the caller then proceeds straight to
 * acceptance, which is exactly the pre-migration behaviour, and the DB trigger
 * remains the thing that actually enforces funding. A read failure must never
 * be the reason a legacy, already-escrowed bounty cannot be accepted.
 */
export async function getBountyFundingRequirement(
  bountyId: string | number
): Promise<BountyFundingRequirement> {
  const id = String(bountyId);
  const fallback: BountyFundingRequirement = { ...NO_FUNDING_REQUIRED, bountyId: id };

  if (!isSupabaseConfigured) return fallback;

  try {
    const { data, error } = await supabase.rpc('fn_get_bounty_funding_requirement', {
      p_bounty_id: id,
    });

    if (error) {
      // PGRST202 = the function does not exist in this environment.
      if (error.code === 'PGRST202' || (error.message || '').includes('Could not find the function')) {
        return fallback;
      }
      logger.warning('getBountyFundingRequirement failed; assuming no funding required', {
        bountyId: id,
        code: error.code,
      });
      return fallback;
    }

    const row: any = Array.isArray(data) ? data[0] : data;
    if (!row) return fallback;

    const amountRequired = Number(row.amount_required ?? 0) || 0;
    const posterBalance = Number(row.poster_balance ?? 0) || 0;

    return {
      bountyId: id,
      fundingMode: row.funding_mode === 'at_accept' ? 'at_accept' : 'at_post',
      requiresFunding: Boolean(row.requires_funding),
      amountRequired,
      alreadyFunded: Boolean(row.already_funded),
      posterBalance,
      // Recomputed rather than trusted from the row so the two can never
      // disagree if the RPC's shape ever changes.
      shortfall: Math.max(0, Number((amountRequired - posterBalance).toFixed(2))),
    };
  } catch (err) {
    logger.warning('getBountyFundingRequirement threw; assuming no funding required', {
      bountyId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

/**
 * Whether this poster may post their next bounty without pre-funding it.
 *
 * Advisory only — the grant is re-decided server-side at INSERT by
 * trg_bounties_normalize_funding_mode, so a stale `true` here just means the
 * poster falls back to today's pre-funded flow, and a stale `false` means they
 * pre-fund something they could have deferred. Neither creates unfunded work.
 */
export async function canDeferBountyFunding(amount: number): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  if (!Number.isFinite(amount) || amount <= 0) return false;

  try {
    const { data, error } = await supabase.rpc('fn_can_i_defer_bounty_funding', {
      p_amount: amount,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Extracts the raw message from the several error shapes Supabase throws. */
function messageOf(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as Partial<PostgrestError> & { rpc?: PostgrestError; error?: { message?: string } };
  return e.message || e.rpc?.message || e.error?.message || '';
}

/**
 * Map an acceptance failure onto a reason the UI can act on.
 *
 * The strings matched here are the RAISE'd names from the migration, not
 * free-text, so they are stable: 'insufficient_funds_for_escrow',
 * 'bounty_not_funded', 'bounty_amount_locked_by_*', 'bounty_not_open',
 * 'request_not_pending'.
 */
export function classifyAcceptFundingError(err: unknown): AcceptFundingFailureReason {
  const msg = messageOf(err).toLowerCase();
  if (!msg) return 'unknown';

  if (msg.includes('insufficient_funds_for_escrow') || msg.includes('insufficient funds')) {
    return 'insufficient_funds';
  }
  // The DB guard fired. This is NOT a statement about the balance — see the
  // 'not_funded' doc above. Routing it to its own reason is what stops a poster
  // with $12 being shown an "add funds" screen for a $3 bounty.
  if (msg.includes('bounty_not_funded')) return 'not_funded';
  if (msg.includes('_locked_by_') || msg.includes('funding_mode_is_immutable')) return 'terms_locked';
  if (msg.includes('request_not_pending') || msg.includes('bounty_not_open')) return 'state_conflict';
  if (msg.includes('only the bounty poster')) return 'not_authorized';
  if (msg.includes('suspended') || msg.includes('banned')) return 'account_inactive';
  if (msg.includes('network') || msg.includes('fetch failed') || msg.includes('timeout')) {
    return 'network';
  }
  return 'unknown';
}

/** Copy for each failure reason, in the app's existing plain, non-technical voice. */
export function describeAcceptFundingFailure(reason: AcceptFundingFailureReason): {
  title: string;
  message: string;
} {
  switch (reason) {
    case 'insufficient_funds':
      return {
        title: "Payment couldn't be completed",
        message:
          "Your bounty hasn't been funded yet, so nobody has been assigned to it. " +
          'Add funds and try selecting your hunter again.',
      };
    case 'not_funded':
      return {
        title: "Couldn't secure this bounty",
        message:
          "This bounty hasn't been funded yet, so nobody has been assigned. Your " +
          "balance wasn't charged — please try selecting your hunter again.",
      };
    case 'terms_locked':
      return {
        title: 'This bounty has already been applied to',
        message:
          "The reward can't change once hunters have applied. Select someone at the " +
          'posted amount, or close this bounty and post a new one.',
      };
    case 'state_conflict':
      return {
        title: 'Already handled',
        message: 'This bounty was updated somewhere else. Refresh and try again.',
      };
    case 'not_authorized':
      return {
        title: 'Not authorized',
        message: 'Only the poster of this bounty can select a hunter for it.',
      };
    case 'account_inactive':
      return {
        title: 'Account on hold',
        message: 'Your account needs attention before you can select a hunter.',
      };
    case 'network':
      return {
        title: 'Connection problem',
        message:
          "We couldn't reach the server. Your bounty hasn't been funded and nobody " +
          'has been assigned. Check your connection and try again.',
      };
    default:
      return {
        title: "Couldn't secure this bounty",
        message:
          "Your bounty hasn't been funded yet and no hunter has been assigned. Please try again.",
      };
  }
}

/**
 * Coarse amount bucket for analytics. Deliberately NOT the exact amount: the
 * funnel needs "does abandonment rise with price", not a per-user price list.
 */
export function amountBucket(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return 'none';
  if (amount < 25) return 'lt_25';
  if (amount < 50) return '25_49';
  if (amount < 100) return '50_99';
  if (amount < 250) return '100_249';
  return 'gte_250';
}

export const bountyFundingService = {
  getBountyFundingRequirement,
  canDeferBountyFunding,
  classifyAcceptFundingError,
  describeAcceptFundingFailure,
  amountBucket,
};

export default bountyFundingService;
