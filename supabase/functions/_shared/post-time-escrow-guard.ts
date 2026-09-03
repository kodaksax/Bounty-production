/**
 * Guard for POST /wallet/escrow — the post-time custodial-wallet debit.
 *
 * WHY THIS EXISTS
 * ---------------
 * Since 20260827000000_pay_at_accept_default_for_all_bounties, the database
 * decides funding timing unilaterally in trg_bounties_normalize_funding_mode:
 * every wallet-funded bounty is inserted as funding_mode='at_accept', and the
 * AFTER INSERT trigger fn_reserve_bounty_escrow deliberately does NOT debit.
 * Escrow is instead reserved inside fn_accept_bounty_request when a hunter is
 * selected.
 *
 * That covers the *trigger*. It does not cover the *client*, and the two are
 * separate money paths:
 *
 *   trigger path : INSERT bounties -> fn_reserve_bounty_escrow  (funding_mode aware)
 *   client path  : POST /wallet/escrow -> apply_escrow          (funding_mode BLIND)
 *
 * apply_escrow only dedupes on "does a completed escrow row already exist".
 * For an at_accept bounty none exists yet, so it happily debits — which is
 * exactly the post-time charge the whole feature exists to remove. Any build
 * whose bundle calls createEscrow() straight after creating a bounty (every
 * pre-deferred-funding build still installed in the field, plus the legacy
 * hooks/useBountyForm path) therefore still drains the poster's wallet at post
 * time even against a fully migrated database.
 *
 * Fixing it here rather than only in the app is the point: an edge function
 * deploy reaches 100% of installs immediately, whereas an OTA/app update never
 * reaches the builds that are actually causing the charge.
 *
 * Extracted as a pure function so the money-path rule is unit testable without
 * standing up an edge function or a database.
 */

/** The subset of `bounties` this decision depends on. */
export interface PostTimeEscrowBountyRow {
  /** Server-decided funding timing. Immutable after insert. */
  funding_mode?: string | null;
  /** Modern owner column. */
  poster_id?: string | null;
  /** Legacy owner column, still populated by bountyService.create. */
  user_id?: string | null;
}

export interface ResolvePostTimeEscrowParams {
  /** Authenticated user id, from the verified JWT — never from the body. */
  callerId: string;
  /**
   * The bounty row, or `null` when the lookup found nothing. A missing row is
   * treated as "proceed": the pre-existing apply_escrow behaviour (including
   * its own idempotency and balance checks) stays the authority, so a lookup
   * that cannot see the row never becomes a new way to fail a legitimate
   * legacy escrow.
   */
  bounty: PostTimeEscrowBountyRow | null;
  /** True when the bounty lookup itself errored. Treated like a missing row. */
  lookupFailed?: boolean;
}

export type ResolvePostTimeEscrowResult =
  /** Nothing to block: fall through to apply_escrow unchanged. */
  | { action: 'proceed' }
  /** Caller does not own this bounty; refuse without disclosing anything. */
  | { action: 'reject'; status: number; error: string; code: string }
  /**
   * The bounty is pay-at-accept. Skip the debit entirely.
   *
   * Reported to the caller as the SAME 409 `duplicate_transaction` shape that
   * apply_escrow's idempotent branch already returns, and that lib/wallet-context
   * has treated as a success since the atomic-reservation change (migration
   * 20260518). This matters more than the status code looks: on any *unhandled*
   * error the legacy client deletes the bounty it just created ("Escrow Failed
   * — the bounty has been removed"). Returning a novel error code would turn a
   * correctly deferred post into a vanished one.
   */
  | { action: 'skip'; status: 409; code: 'duplicate_transaction'; error: string };

/** Bounties whose escrow is reserved at hunter acceptance, not at post. */
const DEFERRED_FUNDING_MODE = 'at_accept';

export function resolvePostTimeEscrow({
  callerId,
  bounty,
  lookupFailed = false,
}: ResolvePostTimeEscrowParams): ResolvePostTimeEscrowResult {
  // Unknown bounty (deleted, or an unreadable row): leave the pre-existing
  // behaviour alone. This guard only ever removes a charge, never adds a new
  // reason to fail.
  if (lookupFailed || !bounty) return { action: 'proceed' };

  const owner = bounty.poster_id ?? bounty.user_id ?? null;
  if (owner && owner !== callerId) {
    return {
      action: 'reject',
      status: 403,
      error: 'Only the bounty poster can escrow funds for this bounty',
      code: 'not_bounty_owner',
    };
  }

  if ((bounty.funding_mode ?? null) === DEFERRED_FUNDING_MODE) {
    return {
      action: 'skip',
      status: 409,
      code: 'duplicate_transaction',
      error:
        'This bounty is funded when you choose someone to do it, so nothing was charged.',
    };
  }

  return { action: 'proceed' };
}
