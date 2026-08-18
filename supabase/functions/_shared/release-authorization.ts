/**
 * Authorization decision for POST /wallet/release.
 *
 * Extracted as a pure function so the money-path authorization rules are unit
 * testable without standing up an edge function or a database.
 *
 * The rule this enforces: the account credited by a release is *derived* from
 * the bounty's `accepted_by` column, never taken from the request body. The
 * caller may still send `hunterId`, but it is treated as an assertion to be
 * checked against `accepted_by` — not as a value to be trusted. Before this
 * check existed, a poster could release their own escrow to any account by
 * passing an arbitrary `hunterId`.
 */

/** Canonical UUID (versions 1-5, RFC 4122 variant), matching Postgres `uuid`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** The subset of `bounties` the release authorization decision depends on. */
export interface ReleaseBountyRow {
  /** Owner column checked against the caller. */
  user_id?: string | null;
  /** The hunter who actually claimed the bounty. The only valid payee. */
  accepted_by?: string | null;
}

export interface AuthorizeReleaseParams {
  /** Authenticated user id, from the verified JWT — never from the body. */
  callerId: string;
  /** Optional `hunterId` from the request body. Verified, never trusted. */
  requestedHunterId?: unknown;
  bounty: ReleaseBountyRow;
}

export type AuthorizeReleaseResult =
  | { ok: true; hunterId: string }
  | { ok: false; status: number; error: string; code: string };

/**
 * Decide whether a release may proceed, and to whom.
 *
 * Checks run owner-first so a caller who does not own the bounty learns nothing
 * about who claimed it. Every failure carries a distinct `code` so the two 403s
 * (wrong caller vs. wrong payee) are separable in logs — a burst of
 * `hunter_mismatch` is an attempted redirect of escrow and should be alertable,
 * while `not_bounty_owner` is routine.
 */
export function authorizeRelease({
  callerId,
  requestedHunterId,
  bounty,
}: AuthorizeReleaseParams): AuthorizeReleaseResult {
  const owner = bounty.user_id ?? null;
  if (!owner || owner !== callerId) {
    return {
      ok: false,
      status: 403,
      error: 'Unauthorized to release funds',
      code: 'not_bounty_owner',
    };
  }

  const acceptedBy = bounty.accepted_by ?? null;
  if (!acceptedBy) {
    // Nothing to release against. Deliberately *not* phrased as "already
    // released"/"duplicate": the client treats 409s matching those words as an
    // idempotent success, which would silently swallow this real failure.
    return {
      ok: false,
      status: 409,
      error: 'This bounty has no accepted hunter; there is nothing to release.',
      code: 'no_accepted_hunter',
    };
  }

  if (!isUuid(acceptedBy)) {
    return {
      ok: false,
      status: 409,
      error: 'This bounty has an unusable accepted hunter record.',
      code: 'invalid_accepted_hunter',
    };
  }

  // `hunterId` is optional. When present it must be well formed and must name
  // the accepted hunter; it never selects the payee.
  const asserted =
    typeof requestedHunterId === 'string' ? requestedHunterId.trim() : requestedHunterId;
  if (asserted !== undefined && asserted !== null && asserted !== '') {
    if (!isUuid(asserted)) {
      return {
        ok: false,
        status: 400,
        error: 'hunterId must be a valid UUID',
        code: 'invalid_hunter_id',
      };
    }
    if (asserted.toLowerCase() !== acceptedBy.toLowerCase()) {
      return {
        ok: false,
        status: 403,
        error: 'Requested hunter is not the accepted hunter for this bounty',
        code: 'hunter_mismatch',
      };
    }
  }

  return { ok: true, hunterId: acceptedBy };
}

/**
 * Minimal shape of the admin client used to look the bounty up.
 *
 * `single()` is typed as `PromiseLike` rather than `Promise` because supabase-js
 * returns a thenable query builder, not a real Promise.
 */
export interface ReleaseBountyLookupClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        single(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/** The bounty fields the release route needs after authorization succeeds. */
export interface ReleaseBountyDetails extends ReleaseBountyRow {
  amount?: unknown;
  is_for_honor?: unknown;
}

export type ResolveReleasePayeeResult =
  | { ok: true; hunterId: string; posterId: string; bounty: ReleaseBountyDetails }
  | { ok: false; status: number; error: string; code: string };

/**
 * Load the bounty and decide who may be paid, before any write happens.
 *
 * This is the single gate the release route passes through on its way to the
 * `wallet_transactions` insert and the `apply_release_tx` credit. Keeping it in
 * one injectable function is what makes "a rejected release writes no rows"
 * testable without a database.
 */
export async function resolveReleasePayee(
  client: ReleaseBountyLookupClient,
  params: { bountyId: string; callerId: string; requestedHunterId?: unknown }
): Promise<ResolveReleasePayeeResult> {
  const { data, error } = await client
    .from('bounties')
    // `accepted_by` is load-bearing: it is the authorization subject, not a detail.
    .select('user_id, accepted_by, amount, is_for_honor')
    .eq('id', params.bountyId)
    .single();

  if (error || !data) {
    return { ok: false, status: 404, error: 'Bounty not found', code: 'bounty_not_found' };
  }

  const bounty = data as ReleaseBountyDetails;
  const auth = authorizeRelease({
    callerId: params.callerId,
    requestedHunterId: params.requestedHunterId,
    bounty,
  });
  if (!auth.ok) return auth;

  return {
    ok: true,
    hunterId: auth.hunterId,
    posterId: bounty.user_id as string,
    bounty,
  };
}
