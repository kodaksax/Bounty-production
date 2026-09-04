import { analyticsService } from 'lib/services/analytics-service';
import { inferRoleFromFirstAction } from 'lib/services/role-inference-service';
import type { Bounty, BountyRequest, Profile } from 'lib/services/database.types';
import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { getAccountStatusErrorMessage } from 'lib/utils/account-status-errors';
import { getApiBase } from 'lib/utils/dev-host';
import { logger } from 'lib/utils/error-logger';

export type BountyRequestWithDetails = BountyRequest & {
  bounty: Bounty;
  profile: Profile;
};

// API Configuration
// EXPO_PUBLIC_* vars are the only ones Metro inlines into the bundle. A bare
// API_BASE_URL (no prefix) is never available at runtime and would always
// fall through to the localhost default, breaking calls on device/emulator.
// In development, derive the address from the Expo debugger host so it works
// on a physical device over LAN.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  (typeof __DEV__ !== 'undefined' && __DEV__ ? getApiBase() : 'http://localhost:3001');

/**
 * Emits `first_submission_received` when the application just inserted is the
 * first one on its bounty — the second half of the posting funnel and the
 * input to the "median time-to-first-submission on paid bounties" metric.
 *
 * Two properties of this event are easy to misread, so they are worth stating:
 *
 *  1. It is emitted by the HUNTER's client, so its distinct_id is the hunter,
 *     not the poster. Join it to `post_published` on `bountyId`; do not use it
 *     as a person-level funnel step.
 *  2. `amount`/`isForHonor` are read back from the bounty so the event can be
 *     filtered to paid bounties without a join.
 *
 * Entirely best-effort: any failure here is swallowed, because a broken
 * analytics read must never fail a hunter's application.
 */
async function emitFirstSubmissionIfFirst(bountyId: unknown): Promise<void> {
  try {
    if (!bountyId) return;

    const { count, error: countError } = await supabase
      .from('bounty_requests')
      .select('id', { count: 'exact', head: true })
      .eq('bounty_id', String(bountyId));

    // Only the first application on this bounty produces the event. A null
    // count means the count wasn't returned — stay silent rather than guess.
    if (countError || count !== 1) return;

    const { data: bountyRow } = await supabase
      .from('bounties')
      .select('amount, is_for_honor, created_at')
      .eq('id', String(bountyId))
      .single();

    const postedAt = (bountyRow as any)?.created_at;
    const hoursToFirstSubmission = postedAt
      ? Number(((Date.now() - new Date(postedAt).getTime()) / 3_600_000).toFixed(3))
      : undefined;

    analyticsService.trackEvent('first_submission_received', {
      bountyId: String(bountyId),
      amount: Number((bountyRow as any)?.amount ?? 0),
      isForHonor: Boolean((bountyRow as any)?.is_for_honor),
      funded: !((bountyRow as any)?.is_for_honor) && Number((bountyRow as any)?.amount ?? 0) > 0,
      hoursToFirstSubmission,
    });
  } catch {
    /* analytics is best-effort — never fail an application over it */
  }
}

/**
 * Best-effort "hours since this bounty was claimed" for `bounty_completed`'s
 * `hours_from_claim_to_completion`. "Claimed" here means the winning hunter's
 * original application (`bounty_requests.created_at` on the row whose status
 * is now 'accepted'), matching the `bounty_claim_submitted` moment elsewhere
 * in this funnel — not the poster's later accept action, which can lag the
 * application by an arbitrary review period.
 */
export async function getHoursSinceClaimed(bountyId: string | number): Promise<number | undefined> {
  try {
    const accepted = await bountyRequestService.getAll({ bountyId, status: 'accepted' });
    const claimedAt = accepted[0]?.created_at;
    if (!claimedAt) return undefined;
    return Math.max(0, (Date.now() - new Date(claimedAt).getTime()) / 3_600_000);
  } catch {
    return undefined;
  }
}

export const bountyRequestService = {
  /**
   * Get a bounty request by ID
   */
  async getById(id: string | number): Promise<BountyRequest | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch bounty request: ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      // Normalize thrown values (Supabase often throws plain objects)
      let error: Record<string, any>;
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack };
      } else if (err && typeof err === 'object') {
        // Prefer any message property, then nested error.message, then JSON
        const message =
          (err as any).message ||
          (err as any).error?.message ||
          (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
        error = { ...(err as Record<string, any>), message };
      } else {
        error = { message: String(err) };
      }
      logger.error('Error fetching bounty request by ID', { id, error });
      return null;
    }
  },

  /**
   * Get all bounty requests with optional filters
   */
  async getAll(options?: {
    status?: string;
    bountyId?: string | number;
    userId?: string;
  }): Promise<BountyRequest[]> {
    try {
      // Prefer Supabase when configured to keep UUID id types consistent with bounties
      if (isSupabaseConfigured) {
        let query: any = supabase.from('bounty_requests').select('*');
        // Some test mocks provide a minimal supabase builder without `order()`.
        // Guard the call so unit tests using the mock don't throw.
        if (typeof query.order === 'function')
          query = query.order('created_at', { ascending: false });

        if (options?.status) query = query.eq('status', options.status);
        if (options?.bountyId) query = query.eq('bounty_id', String(options.bountyId));
        if (options?.userId) query = query.eq('hunter_id', options.userId);

        const { data, error } = await query;
        if (error) throw error;
        return (data as unknown as BountyRequest[]) ?? [];
      }

      const params = new URLSearchParams();
      if (options?.status) params.append('status', options.status);
      if (options?.bountyId) params.append('bounty_id', String(options.bountyId));
      if (options?.userId) params.append('hunter_id', options.userId);

      const url = `${API_BASE_URL}/api/bounty-requests${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '<no-body>');
        throw new Error(
          `Failed to fetch bounty requests: ${response.status} ${response.statusText} — ${body}`
        );
      }
      return await response.json();
    } catch (err) {
      let error: Record<string, any>;
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack };
      } else if (err && typeof err === 'object') {
        const message =
          (err as any).message ||
          (err as any).error?.message ||
          (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
        error = { ...(err as Record<string, any>), message };
      } else {
        error = { message: String(err) };
      }
      logger.error('Error fetching bounty requests', { options, error });
      return [];
    }
  },

  /**
   * Get all bounty requests with details (bounty and profile data included)
   */
  async getAllWithDetails(options?: {
    status?: string;
    bountyId?: string | number;
    userId?: string;
  }): Promise<BountyRequestWithDetails[]> {
    try {
      // Supabase-first: fetch requests, then join bounties and profiles client-side
      if (isSupabaseConfigured) {
        let rq: any = supabase.from('bounty_requests').select('*');
        // Guard `.order()` for minimal test mocks
        if (typeof rq.order === 'function') rq = rq.order('created_at', { ascending: false });
        if (options?.status) rq = rq.eq('status', options.status);
        if (options?.bountyId) rq = rq.eq('bounty_id', String(options.bountyId));
        if (options?.userId) rq = rq.eq('hunter_id', options.userId);

        const { data: reqs, error } = await rq;
        if (error) throw error;
        const requests = (reqs as unknown as BountyRequest[]) ?? [];
        if (requests.length === 0) return [];

        // Ensure we only convert non-null/undefined/non-empty values to strings.
        // Converting `null` to String(null) gives "null" which leads to Postgres
        // `invalid input syntax for type uuid: "null"` when used in `.in()` queries.
        const bountyIds = Array.from(
          new Set(
            requests
              .map(r => (r as any).bounty_id)
              .filter(id => id !== null && id !== undefined && id !== '')
              .map(id => String(id))
          )
        ) as string[];

        const userIds = Array.from(
          new Set(
            requests
              .map(r => (r as any).hunter_id)
              .filter(id => id !== null && id !== undefined && id !== '')
              .map(id => String(id))
          )
        ) as string[];

        // Defensive logging when unexpected values would have been present
        if (requests.some(r => (r as any).bounty_id == null)) {
          logger.warning(
            'Some bounty requests contain null bounty_id values; skipping nulls when fetching related bounties',
            { count: requests.length }
          );
        }
        if (requests.some(r => (r as any).hunter_id == null)) {
          logger.warning(
            'Some bounty requests contain null hunter_id values; skipping nulls when fetching related profiles',
            { count: requests.length }
          );
        }

        const [{ data: bounties, error: bErr }, { data: profiles, error: pErr }] =
          await Promise.all([
            bountyIds.length
              ? supabase.from('bounties').select('*').in('id', bountyIds)
              : Promise.resolve({ data: [], error: null } as any),
            userIds.length
              ? supabase
                  .from('public_profiles')
                  // Curated safe-columns VIEW, not the base `profiles` table --
                  // this batch-fetches OTHER users' (hunters') profiles for a
                  // poster's bounty-request list, and base-table SELECT RLS is
                  // self-only (`auth.uid() = id`), so `profiles` returns nothing
                  // here. See docs/withdrawals/08-profiles-rls-migration-strategy.md.
                  .select('id, username, display_name, avatar, location, about, verification_status, created_at')
                  .in('id', userIds)
              : Promise.resolve({ data: [], error: null } as any),
          ]);
        if (bErr) throw bErr;
        if (pErr) throw pErr;

        const ratingStatsMap = new Map<string, { averageRating: number; ratingCount: number }>();
        if (userIds.length > 0) {
          try {
            const { data: ratingRows, error: ratingsErr } = await supabase
              .from('ratings')
              .select('to_user_id, rating')
              .in('to_user_id', userIds);

            if (ratingsErr) throw ratingsErr;

            for (const row of (ratingRows || []) as any[]) {
              const userId = String(row.to_user_id);
              const current = ratingStatsMap.get(userId) || { averageRating: 0, ratingCount: 0 };
              const nextCount = current.ratingCount + 1;
              const nextAvg =
                (current.averageRating * current.ratingCount + Number(row.rating || 0)) / nextCount;
              ratingStatsMap.set(userId, { averageRating: nextAvg, ratingCount: nextCount });
            }
          } catch (ratingsErr) {
            logger.warning(
              'Primary ratings query failed; falling back to legacy user_ratings table for bounty requests',
              { error: ratingsErr, userIds }
            );
            // Backward compatibility for environments still using legacy `user_ratings`.
            try {
              const { data: ratingRowsLegacy, error: legacyErr } = await supabase
                .from('user_ratings')
                .select('user_id, score')
                .in('user_id', userIds);

              if (legacyErr) throw legacyErr;

              for (const row of (ratingRowsLegacy || []) as any[]) {
                const userId = String(row.user_id);
                const current = ratingStatsMap.get(userId) || { averageRating: 0, ratingCount: 0 };
                const nextCount = current.ratingCount + 1;
                const nextAvg =
                  (current.averageRating * current.ratingCount + Number(row.score || 0)) /
                  nextCount;
                ratingStatsMap.set(userId, { averageRating: nextAvg, ratingCount: nextCount });
              }
            } catch (legacyRatingErr) {
              logger.warning('Failed to load rating aggregates for bounty requests', {
                error: legacyRatingErr,
              });
            }
          }
        }

        const bountyMap = new Map<string, Bounty>(
          (bounties as any[]).map((b: any) => [b.id, b as Bounty])
        );
        const profileMap = new Map<string, Profile>(
          (profiles as any[]).map((p: any) => [p.id, p as Profile])
        );

        const result: BountyRequestWithDetails[] = requests.map(r => ({
          ...(r as any),
          bounty: bountyMap.get(String((r as any).bounty_id)) as Bounty,
          profile: {
            ...(profileMap.get(String((r as any).hunter_id)) as Profile),
            ...(ratingStatsMap.get(String((r as any).hunter_id)) || {}),
          } as Profile,
        }));
        return result;
      }

      const params = new URLSearchParams();
      if (options?.status) params.append('status', options.status);
      if (options?.bountyId) params.append('bounty_id', String(options.bountyId));
      if (options?.userId) params.append('hunter_id', options.userId);

      // Backend returns joined bounty + profile details on the same endpoint
      const url = `${API_BASE_URL}/api/bounty-requests${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '<no-body>');
        throw new Error(
          `Failed to fetch bounty requests (with details): ${response.status} ${response.statusText} — ${body}`
        );
      }
      return await response.json();
    } catch (err) {
      let error: Record<string, any>;
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack };
      } else if (err && typeof err === 'object') {
        const message =
          (err as any).message ||
          (err as any).error?.message ||
          (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
        error = { ...(err as Record<string, any>), message };
      } else {
        error = { message: String(err) };
      }
      logger.error('Error fetching bounty requests with details', { options, error });
      return [];
    }
  },

  /**
   * Fetch requests for multiple bounty IDs in a single call (batch)
   * Useful to avoid N+1 client calls when rendering a list of bounties.
   */
  async getAllWithDetailsBatch(
    bountyIds: (string | number)[],
    options?: { status?: string; page?: number; pageSize?: number }
  ): Promise<BountyRequestWithDetails[]> {
    try {
      if (!Array.isArray(bountyIds) || bountyIds.length === 0) return [];

      // Supabase path: fetch all requests for the provided bounty IDs in one query
      if (isSupabaseConfigured) {
        const ids = Array.from(new Set(bountyIds.map(i => String(i))));
        let rq: any = supabase.from('bounty_requests').select('*').in('bounty_id', ids);
        if (typeof rq.order === 'function') rq = rq.order('created_at', { ascending: false });

        if (options?.status) rq = rq.eq('status', options.status);
        if (options?.page && options?.pageSize) {
          const page = Math.max(1, options.page);
          const pageSize = Math.max(1, options.pageSize);
          const from = (page - 1) * pageSize;
          const to = page * pageSize - 1;
          if (typeof rq.range === 'function') rq = rq.range(from, to);
        }

        const { data: reqs, error } = await rq;
        if (error) throw error;
        const requests = (reqs as unknown as BountyRequest[]) ?? [];
        if (requests.length === 0) return [];

        const bountyIdsSet = Array.from(
          new Set(
            requests
              .map(r => (r as any).bounty_id)
              .filter(Boolean)
              .map(String)
          )
        );
        const userIds = Array.from(
          new Set(
            requests
              .map(r => (r as any).hunter_id)
              .filter(Boolean)
              .map(String)
          )
        );

        const [{ data: bounties, error: bErr }, { data: profiles, error: pErr }] =
          await Promise.all([
            bountyIdsSet.length
              ? supabase.from('bounties').select('*').in('id', bountyIdsSet)
              : Promise.resolve({ data: [], error: null } as any),
            userIds.length
              ? supabase
                  .from('public_profiles')
                  // Curated safe-columns VIEW, not the base `profiles` table --
                  // this batch-fetches OTHER users' (hunters') profiles for a
                  // poster's bounty-request list, and base-table SELECT RLS is
                  // self-only (`auth.uid() = id`), so `profiles` returns nothing
                  // here. See docs/withdrawals/08-profiles-rls-migration-strategy.md.
                  .select('id, username, display_name, avatar, location, about, verification_status, created_at')
                  .in('id', userIds)
              : Promise.resolve({ data: [], error: null } as any),
          ]);
        if (bErr) throw bErr;
        if (pErr) throw pErr;

        const ratingStatsMap = new Map<string, { averageRating: number; ratingCount: number }>();
        if (userIds.length > 0) {
          try {
            const { data: ratingRows, error: ratingsErr } = await supabase
              .from('ratings')
              .select('to_user_id, rating')
              .in('to_user_id', userIds);

            if (ratingsErr) throw ratingsErr;

            for (const row of (ratingRows || []) as any[]) {
              const userId = String(row.to_user_id);
              const current = ratingStatsMap.get(userId) || { averageRating: 0, ratingCount: 0 };
              const nextCount = current.ratingCount + 1;
              const nextAvg =
                (current.averageRating * current.ratingCount + Number(row.rating || 0)) / nextCount;
              ratingStatsMap.set(userId, { averageRating: nextAvg, ratingCount: nextCount });
            }
          } catch (ratingsErr) {
            logger.warning('Failed to load rating aggregates for batch requests', {
              error: ratingsErr,
            });
          }
        }

        const bountyMap = new Map<string, Bounty>(
          (bounties as any[]).map((b: any) => [b.id, b as Bounty])
        );
        const profileMap = new Map<string, Profile>(
          (profiles as any[]).map((p: any) => [p.id, p as Profile])
        );

        const result: BountyRequestWithDetails[] = requests.map(r => ({
          ...(r as any),
          bounty: bountyMap.get(String((r as any).bounty_id)) as Bounty,
          profile: {
            ...(profileMap.get(String((r as any).hunter_id)) as Profile),
            ...(ratingStatsMap.get(String((r as any).hunter_id)) || {}),
          } as Profile,
        }));
        return result;
      }

      // Fallback to API: POST to batch endpoint with bounty_ids
      const body: any = { bounty_ids: Array.from(new Set(bountyIds.map(i => String(i)))) };
      if (options?.status) body.status = options.status;
      if (options?.page) body.page = options.page;
      if (options?.pageSize) body.page_size = options.pageSize;

      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '<no-body>');
        throw new Error(
          `Failed to fetch batched bounty requests: ${response.status} ${response.statusText} — ${text}`
        );
      }

      return await response.json();
    } catch (err) {
      let error: Record<string, any>;
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack };
      } else if (err && typeof err === 'object') {
        const message =
          (err as any).message ||
          (err as any).error?.message ||
          (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
        error = { ...(err as Record<string, any>), message };
      } else {
        error = { message: String(err) };
      }
      logger.error('Error fetching batched bounty requests', { bountyIds, options, error });
      return [];
    }
  },

  /**
   * Create a new bounty request
   */
  async create(
    request: Omit<BountyRequest, 'id' | 'created_at'>
  ): Promise<{ success: true; request: BountyRequest } | { success: false; error: string }> {
    try {
      // Normalize payload: ensure the canonical column `hunter_id` is present.
      // The DB table uses `hunter_id` (and poster_id), so don't add a `user_id`
      // field which may not exist in the schema.
      const normalizedRequest: any = { ...(request as any) };
      if (!normalizedRequest.hunter_id && normalizedRequest.user_id) {
        normalizedRequest.hunter_id = normalizedRequest.user_id;
      }

      // Debug: log normalized payload so we can inspect what is sent to backend/Supabase
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
      }

      // Before inserting into Supabase, ensure we don't send a `user_id` column
      if ((normalizedRequest as any).user_id) {
        delete (normalizedRequest as any).user_id;
      }

      if (isSupabaseConfigured) {
        // Ensure poster_id is present to satisfy DB constraints. Fetch from bounties table if missing.
        if (!normalizedRequest.poster_id && normalizedRequest.bounty_id) {
          try {
            // Request both poster_id and legacy user_id to support older bounties
            const { data: bountyRow, error: bountyErr } = await supabase
              .from('bounties')
              .select('poster_id, user_id')
              .eq('id', String(normalizedRequest.bounty_id))
              .single();

            if (bountyErr) {
              logger.error('Supabase error fetching bounty for poster_id/user_id', {
                bountyId: normalizedRequest.bounty_id,
                error: (bountyErr as any)?.message || bountyErr,
              });
              throw bountyErr;
            }

            // Prefer canonical poster_id, fall back to legacy user_id when present
            normalizedRequest.poster_id =
              (bountyRow as any)?.poster_id || (bountyRow as any)?.user_id || null;
          } catch (fetchErr) {
            const msg = `Failed to resolve poster_id for bounty ${normalizedRequest.bounty_id}`;
            logger.error(msg, {
              bountyId: normalizedRequest.bounty_id,
              error: (fetchErr as any)?.message || fetchErr,
            });
            throw new Error(msg);
          }
        }

        // Remove legacy/incorrect user_id column before inserting (schema uses hunter_id/poster_id)
        if ((normalizedRequest as any).user_id) delete (normalizedRequest as any).user_id;

        // Perform the insert as a standalone operation (do not chain `.select()`)
        // so test mocks that simulate insert errors are triggered correctly.
        const { data: insData, error } = await supabase
          .from('bounty_requests')
          .insert(normalizedRequest)
          .select('*')
          .single();
        if (error) {
          // Detect unique-violation (duplicate) errors robustly. Supabase
          // sometimes returns a `code` field (e.g. '23505') or only a
          // textual message referencing 'duplicate'/'unique'. Check both.
          const pgError = error as any;
          // Build a representative message string from common Supabase error fields
          const detailedMessage = String(
            pgError?.message ||
              pgError?.error?.message ||
              pgError?.details ||
              pgError?.hint ||
              (() => {
                try {
                  return JSON.stringify(pgError);
                } catch {
                  return String(pgError);
                }
              })()
          );
          const isUniqueViolation =
            pgError?.code === '23505' ||
            /duplicate|unique|unique_bounty_user/i.test(detailedMessage);

          // The hunter already has a pending application for this bounty.
          // Return the existing record so the caller can treat this as a success
          // (e.g. set hasApplied = true) instead of surfacing a confusing error.
          if (isUniqueViolation) {
            // A unique_violation occurred. It's possible a concurrent insert succeeded
            // but the DB now contains multiple matching rows (data drift or previous bug).
            // Attempt to read the most-recent matching row ordered by `created_at`.
            try {
              // Fetch up to two rows so we can detect if multiple matching rows exist.
              const { data: rows, error: fetchErr } = await supabase
                .from('bounty_requests')
                .select('*')
                .eq('bounty_id', String(normalizedRequest.bounty_id))
                .eq('hunter_id', String(normalizedRequest.hunter_id))
                .order('created_at', { ascending: false })
                .limit(2);

              if (fetchErr) {
                logger.error('Failed to fetch existing bounty request after duplicate key error', {
                  bountyId: normalizedRequest.bounty_id,
                  hunterId: normalizedRequest.hunter_id,
                  error: fetchErr?.message || fetchErr,
                });
              } else if (Array.isArray(rows) && rows.length > 0) {
                // If more than one row is returned, this indicates a data integrity
                // issue where the unique constraint was violated or bypassed.
                if (rows.length > 1) {
                  try {
                    const ids = rows.map((r: any) => r.id);
                    const createdAts = rows.map((r: any) => r.created_at);
                    logger.error(
                      'Data integrity: multiple bounty_requests rows for same bounty/hunter (requires manual cleanup)',
                      {
                        bountyId: normalizedRequest.bounty_id,
                        hunterId: normalizedRequest.hunter_id,
                        count: rows.length,
                        ids,
                        createdAt: createdAts,
                        dataIntegrity: true,
                      }
                    );
                  } catch (logErr) {
                    logger.error(
                      'Failed to log detailed data-integrity information for duplicate bounty_requests',
                      {
                        bountyId: normalizedRequest.bounty_id,
                        hunterId: normalizedRequest.hunter_id,
                        error: logErr instanceof Error ? logErr.message : String(logErr),
                      }
                    );
                  }
                }

                // Return the most-recent row so callers can continue treating this
                // as a successful application while the corruption is investigated.
                const existing = rows[0] as unknown as BountyRequest;
                return { success: true, request: existing };
              }
            } catch (fetchErr) {
              logger.error(
                'Exception while fetching existing bounty request after duplicate key error',
                {
                  bountyId: normalizedRequest.bounty_id,
                  hunterId: normalizedRequest.hunter_id,
                  error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
                }
              );
            }
          }
          // Target bounty is no longer open (claimed, cancelled or completed
          // between the detail page rendering and this insert). The DB rejects
          // this via the bounty_requests BEFORE INSERT trigger. Surface it as a
          // normal failure with the real reason rather than a generic throw.
          if (/no longer accepting applications|not open|does not exist/i.test(detailedMessage)) {
            logger.error('Bounty request rejected: target bounty not open', {
              bountyId: normalizedRequest.bounty_id,
              hunterId: normalizedRequest.hunter_id,
              error: detailedMessage,
            });
            return {
              success: false,
              error: 'This bounty is no longer accepting applications.',
            };
          }
          // Log Supabase error details for better diagnostics
          logger.error('Supabase error creating bounty request', {
            request: normalizedRequest,
            error: pgError?.message || error,
          });
          throw error;
        }

        // Return inserted data (insert may return an array or a single object)
        const created = Array.isArray(insData)
          ? (insData[0] as unknown as BountyRequest)
          : (insData as unknown as BountyRequest);
        if (created) {
          // Deliberately not awaited: this costs two extra reads, and the
          // hunter's "applied" confirmation should not wait on analytics.
          void emitFirstSubmissionIfFirst(normalizedRequest.bounty_id);
          // Fills in profiles.primary_role for a hunter who reached this
          // without ever picking a role in onboarding (the 'onboarding-skip-
          // role-selection' experiment's test-arm skip path). No-op once
          // already set — fire-and-forget so it never blocks the apply.
          if (normalizedRequest.hunter_id) {
            inferRoleFromFirstAction(String(normalizedRequest.hunter_id), 'hunter').catch(() => {});
          }
          return { success: true, request: created };
        }

        // If insert succeeded but returned no data, treat as failure to satisfy
        // the function's return contract (must return either success with a
        // `BountyRequest` or a failure with an error string).
        logger.error('No data returned after creating bounty request', {
          request: normalizedRequest,
          insData,
        });
        return { success: false, error: 'Failed to create bounty request' };
      }

      const response = await fetch(`${API_BASE_URL}/api/bounty-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedRequest),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '<no-body>');
        // Log full response details so the client log exposes backend validation messages
        logger.error('Backend rejected bounty request', {
          request: normalizedRequest,
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        return {
          success: false,
          error: `Failed to create bounty request: ${response.status} ${response.statusText} — ${errorText}`,
        };
      }

      // Read body as text first so we can safely handle invalid JSON
      const text = await response.text().catch(() => null);
      if (!text) {
        logger.error('Empty response body when creating bounty request', {
          request: normalizedRequest,
          status: response.status,
          statusText: response.statusText,
        });
        return { success: false, error: 'Failed to parse response' };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        logger.error('Failed to parse JSON response creating bounty request', {
          request: normalizedRequest,
          body: text,
          error: (parseErr as any)?.message || parseErr,
        });
        return { success: false, error: 'Failed to parse response' };
      }

      return { success: true, request: parsed as unknown as BountyRequest };
    } catch (err) {
      // Preserve useful error information even when upstream libraries throw plain objects
      let errorMessage = 'Unknown error';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (err && typeof err === 'object') {
        // Try common fields
        if ('message' in err && typeof (err as any).message === 'string') {
          errorMessage = (err as any).message;
        } else {
          try {
            errorMessage = JSON.stringify(err);
          } catch (e) {
            errorMessage = String(err);
          }
        }
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      logger.error('Error creating bounty request', {
        request: request as any,
        error: errorMessage,
      });
      // A suspended/banned hunter hits this via the bounty_requests INSERT
      // RLS policy (see 20260726000000_enforce_account_status.sql).
      const accountStatusError = getAccountStatusErrorMessage(err);
      return { success: false, error: accountStatusError ? accountStatusError.message : errorMessage };
    }
  },

  /**
   * Update a bounty request
   */
  async update(
    id: string | number,
    updates: Partial<Omit<BountyRequest, 'id' | 'created_at'>>
  ): Promise<BountyRequest | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounty_requests')
          .update(updates)
          .eq('id', String(id))
          .select('*')
          .single();
        if (error) {
          // Log detailed Supabase error
          logger.error('Supabase error updating bounty request', {
            id,
            updates,
            error: {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code,
            },
          });
          throw error;
        }
        if (!data) {
          logger.error('No data returned after updating bounty request', { id, updates });
          return null;
        }
        return data as unknown as BountyRequest;
      }
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update bounty request: ${errorText}`);
      }
      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error updating bounty request', { id, updates, error });
      return null;
    }
  },

  /**
   * Delete a bounty request
   */
  async delete(id: string | number): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        // Ask for the deleted row back so we can tell a real delete from a
        // Row Level Security no-op. Postgres drops rows a policy forbids
        // silently — no error — so an empty result means nothing was removed
        // (for example an accepted application the hunter may not delete).
        const { data, error } = await supabase
          .from('bounty_requests')
          .delete()
          .eq('id', String(id))
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0) {
          logger.warning('Delete removed no bounty request rows', { id });
          return false;
        }
        return true;
      }
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete bounty request: ${errorText}`);
      }
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error deleting bounty request', { id, error });
      return false;
    }
  },

  /**
   * Update a bounty request's status
   */
  async updateStatus(
    id: string | number,
    status: 'pending' | 'accepted' | 'rejected'
  ): Promise<BountyRequest | null> {
    return this.update(id, { status });
  },

  /**
   * Get bounty requests by user ID
   */
  async getByUserId(userId: string): Promise<BountyRequest[]> {
    return this.getAll({ userId });
  },

  /**
   * Get bounty requests by bounty ID
   */
  async getByBountyId(bountyId: string | number): Promise<BountyRequest[]> {
    return this.getAll({ bountyId });
  },

  /**
   * Get pending bounty requests
   */
  async getPendingRequests(): Promise<BountyRequest[]> {
    return this.getAll({ status: 'pending' });
  },

  /**
   * Get accepted bounty requests
   */
  async getAcceptedRequests(): Promise<BountyRequest[]> {
    return this.getAll({ status: 'accepted' });
  },

  /**
   * Get rejected bounty requests
   */
  async getRejectedRequests(): Promise<BountyRequest[]> {
    return this.getAll({ status: 'rejected' });
  },

  /**
   * Accept a bounty request
   * Moves the request to 'accepted' and the bounty to 'in_progress'.
   * Escrow funding is handled during the bounty creation flow, before a request is accepted.
   *
   * Safeguards:
   * - Bounty transition uses optimistic lock (status = 'open' + accepted_by IS NULL)
   * - If bounty was already claimed, rolls back request to 'pending' and returns null
   */
  async acceptRequest(requestId: string | number): Promise<BountyRequest | null> {
    // Pre-check: verify the request is still in 'pending' status before attempting acceptance.
    // This avoids wasted work and clearer errors when the request was already handled.
    try {
      const currentRequest = await this.getById(requestId as any);
      if (currentRequest && currentRequest.status !== 'pending') {
        logger.error('Cannot accept a request that is not pending', {
          requestId,
          currentStatus: currentRequest.status,
        });
        return null;
      }
    } catch (preCheckErr) {
      // If the pre-check fails (e.g. network), log and continue with the original flow
      logger.warning('Pre-acceptance status check failed, continuing with accept', {
        requestId,
        error: preCheckErr instanceof Error ? preCheckErr.message : String(preCheckErr),
      });
    }

    // If using Supabase client, use the atomic SECURITY DEFINER RPC to transition
    // both bounty_requests and bounties in a single round-trip, bypassing RLS.
    // This avoids a race condition where the direct client-side update to `bounties`
    // could fail silently (due to RLS or a missing accepted_by column) causing the
    // bounty to stay permanently at 'open' and the request to bounce back to 'pending'.
    if (isSupabaseConfigured) {
      let result: BountyRequest | null = null;

      // Try the atomic SECURITY DEFINER function first (preferred path).
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('fn_accept_bounty_request', {
          p_request_id: String(requestId),
        });

        if (rpcError) {
          // Map known exception messages to structured HTTP-like status codes so
          // the caller (useAcceptRequest) can present meaningful alerts.
          const msg = rpcError.message || '';
          if (msg.includes('request_not_found')) {
            const err = new Error('Request not found');
            (err as any).status = 404;
            (err as any).code = (rpcError as any)?.code;
            (err as any).rpc = rpcError;
            throw err;
          }
          // The fn_accept_bounty_request PL/pgSQL function can raise 'bounty_not_found'.
          // This indicates the referenced bounty no longer exists and should be
          // surfaced as a 404 Not Found to callers (not a 409 Conflict).
          if (msg.includes('bounty_not_found')) {
            const err = new Error('Bounty not found');
            (err as any).status = 404;
            (err as any).code = (rpcError as any)?.code;
            (err as any).rpc = rpcError;
            throw err;
          }
          if (msg.includes('request_not_pending') || msg.includes('bounty_not_open')) {
            const err = new Error('Bounty or request is no longer in the expected state');
            (err as any).status = 409;
            (err as any).code = (rpcError as any)?.code;
            (err as any).rpc = rpcError;
            throw err;
          }
          // Pay-at-accept ("post first, pay at accept") funding failures. The
          // acceptance transaction rolled back in full, so the bounty is still
          // 'open' and the request still 'pending' — nothing has been charged
          // and no hunter has been assigned. 402 Payment Required is used so
          // callers can distinguish "needs money" from the 409 state conflicts
          // above; useAcceptFunding classifies these by message and reopens the
          // top-up gate. See
          // supabase/migrations/20260823120000_deferred_bounty_funding_pay_at_accept.sql.
          if (
            msg.includes('insufficient_funds_for_escrow') ||
            msg.includes('bounty_not_funded') ||
            msg.includes('_locked_by_') ||
            msg.includes('bounty_funding_mode_is_immutable')
          ) {
            const err = new Error(msg);
            (err as any).status = 402;
            (err as any).code = (rpcError as any)?.code;
            (err as any).rpc = rpcError;
            throw err;
          }
          // A suspended/banned poster hits this via assert_account_active()
          // inside fn_accept_bounty_request (see
          // 20260726000000_enforce_account_status.sql).
          const accountStatusError = getAccountStatusErrorMessage(rpcError);
          if (accountStatusError) {
            const err = new Error(accountStatusError.message);
            (err as any).status = 403;
            (err as any).code = (rpcError as any)?.code;
            (err as any).rpc = rpcError;
            throw err;
          }
          const err = new Error(msg || 'fn_accept_bounty_request failed');
          (err as any).code = (rpcError as any)?.code;
          (err as any).rpc = rpcError;
          throw err;
        }

        // rpcData is an array of rows: [{ bounty: {...}, accepted_request: {...} }]
        const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        const acceptedRequestJson = (row as any)?.accepted_request;
        if (!acceptedRequestJson) {
          logger.error('fn_accept_bounty_request returned no accepted_request data', {
            requestId,
            rpcData,
          });
          return null;
        }

        // The JSON may be a plain object (already parsed by the JS driver) or a string
        result = (
          typeof acceptedRequestJson === 'string'
            ? JSON.parse(acceptedRequestJson)
            : acceptedRequestJson
        ) as BountyRequest;
      } catch (rpcErr: any) {
        // If the RPC itself is unavailable (e.g. function not yet deployed in this env),
        // fall back to the direct sequential update path.
        // Limit "not deployed" detection to the specific PostgREST PGRST202 code and its
        // corresponding message string. Any other error message that happens to contain the
        // function name (e.g. a permission or validation error) should be re-thrown so the
        // caller receives the real error rather than silently running the fallback path.
        const isNotFound =
          rpcErr?.code === 'PGRST202' ||
          (rpcErr?.message || '').includes('Could not find the function');
        const isConflict = (rpcErr as any)?.status === 409;
        const isNotFoundRequest = (rpcErr as any)?.status === 404;

        if (isConflict || isNotFoundRequest) {
          // Structured error from fn – re-throw to caller
          throw rpcErr;
        }

        if (!isNotFound) {
          // Unexpected RPC error – re-throw so caller shows "Accept Failed" alert
          throw rpcErr;
        }

        // RPC function not deployed – fall back to sequential client-side updates.
        logger.warning(
          'fn_accept_bounty_request not available, falling back to sequential updates',
          {
            requestId,
            error: rpcErr?.message,
          }
        );

        result = await this.updateStatus(requestId, 'accepted');

        if (result) {
          try {
            // Note: the original code also had `.is('accepted_by', null)` here, but that was
            // the root cause of the bug: when the `accepted_by` column was absent from the DB
            // schema cache (PGRST204), the entire update failed silently, leaving the bounty at
            // 'open'.  The `.eq('status', 'open')` check already prevents double-acceptance
            // (the second concurrent update would match 0 rows and return null below).
            const { data: updatedRows, error: bountyUpdateError } = await supabase
              .from('bounties')
              .update({
                status: 'in_progress',
                accepted_by: result.hunter_id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', String(result.bounty_id))
              .eq('status', 'open')
              .select();

            if (bountyUpdateError) {
              // A DB error means the request is in `accepted` while the bounty remains `open`.
              // Roll back the request to `pending` so the state is self-consistent and the
              // poster can retry the acceptance without manual intervention.
              logger.error('Fallback: failed to transition bounty to in_progress', {
                requestId,
                bountyId: result.bounty_id,
                error: bountyUpdateError,
              });
              try {
                await supabase
                  .from('bounty_requests')
                  .update({ status: 'pending', updated_at: new Date().toISOString() })
                  .eq('id', String(requestId))
                  .eq('status', 'accepted');
              } catch (rollbackErr) {
                logger.error('Fallback: rollback of request status also failed', {
                  requestId,
                  error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
                });
              }
              return null;
            } else if (!updatedRows || updatedRows.length === 0) {
              logger.error('Fallback: bounty already accepted or no longer open', {
                requestId,
                bountyId: result.bounty_id,
              });
              await supabase
                .from('bounty_requests')
                .update({ status: 'pending', updated_at: new Date().toISOString() })
                .eq('id', String(requestId))
                .eq('status', 'accepted');
              return null;
            } else {
              // Bounty transitioned successfully — reject competing requests.
              try {
                await supabase
                  .from('bounty_requests')
                  .update({ status: 'rejected', updated_at: new Date().toISOString() })
                  .eq('bounty_id', String(result.bounty_id))
                  .neq('id', String(requestId))
                  .eq('status', 'pending');
              } catch (rejectErr) {
                logger.error('Fallback: error rejecting competing requests', {
                  requestId,
                  error:
                    rejectErr instanceof Error ? (rejectErr as Error).message : String(rejectErr),
                });
              }
            }
          } catch (statusErr) {
            // Unexpected exception during the bounty update itself. The request is already
            // in 'accepted'. Best-effort rollback and return null to let the caller retry.
            logger.error('Fallback: error transitioning bounty', {
              requestId,
              error: statusErr instanceof Error ? statusErr.message : String(statusErr),
            });
            try {
              await supabase
                .from('bounty_requests')
                .update({ status: 'pending', updated_at: new Date().toISOString() })
                .eq('id', String(requestId))
                .eq('status', 'accepted');
            } catch (rollbackErr2) {
              logger.error('Fallback: rollback after exception also failed', {
                requestId,
                error: rollbackErr2 instanceof Error ? rollbackErr2.message : String(rollbackErr2),
              });
            }
            return null;
          }
        }
      }

      if (!result) return null;

      return result;
    }

    // API mode: call an atomic server-side function to accept the request.
    // This replaces sequential client updates with a single server-side operation
    // exposed at POST ${API_BASE_URL}/functions/v1/accept-bounty-request
    try {
      const fnUrl = `${API_BASE_URL.replace(/\/$/, '')}/functions/v1/accept-bounty-request`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: String(requestId) }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const msg = `Accept function failed: ${res.status} ${res.statusText} ${text}`;
        logger.error('acceptRequest: edge function error', {
          requestId,
          status: res.status,
          body: text,
        });
        const err = new Error(msg);
        (err as any).status = res.status;
        throw err;
      }

      // On success, prefer the atomic function's response as authoritative instead
      // of immediately hitting the GET endpoint. The edge function returns the
      // RPC rows (bounty, accepted_request) in its body so parsing that avoids a
      // follow-up GET which can fail due to transient network issues and falsely
      // indicate a conflict to the caller.
      let acceptedReq: BountyRequest | null = null;
      try {
        const body = await res.json().catch(() => null);
        if (body && body.data) {
          const row = Array.isArray(body.data) ? body.data[0] : body.data;
          const acceptedRequestJson =
            (row as any)?.accepted_request ?? (row as any)?.acceptedRequest ?? row;
          if (acceptedRequestJson) {
            acceptedReq =
              typeof acceptedRequestJson === 'string'
                ? JSON.parse(acceptedRequestJson)
                : acceptedRequestJson;
          }
        }
      } catch (parseErr) {
        logger.warning('Could not parse accept function response', {
          requestId,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
      }

      // Fallback: if the function response didn't include the accepted request,
      // try fetching it. If that fetch fails (transient network), swallow the
      // error and proceed because the edge function already returned success.
      if (!acceptedReq) {
        try {
          const fetched = await this.getById(requestId as any);
          if (fetched) acceptedReq = fetched;
        } catch (fetchErr) {
          logger.warning('Post-acceptance getById failed; proceeding with API success', {
            requestId,
            error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          });
        }
      }

      // Post-acceptance verification: if we were able to retrieve an accepted
      // request and it isn't in the 'accepted' state, treat as a conflict. If
      // we couldn't obtain the accepted request but the edge function returned
      // success, proceed (best-effort) to avoid surfacing a false conflict to
      // the user when verification fails due to transient network errors.
      if (acceptedReq) {
        if (acceptedReq.status !== 'accepted') {
          logger.error(
            'Post-acceptance verification failed: request did not transition to accepted',
            {
              requestId,
              actualStatus: acceptedReq.status,
            }
          );
          return null;
        }
      } else {
        logger.warning(
          'Accept function returned success but accepted request data unavailable; proceeding',
          { requestId }
        );
      }

      return acceptedReq;
    } catch (err) {
      logger.error('Error accepting request via Edge Function / API mode', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Re-throw to allow caller to present structured errors (useAcceptRequest will catch)
      throw err;
    }
  },

  /**
   * Helper to get bounty details for a request
   */
  async getBountyForRequest(bountyId: string | number): Promise<Bounty | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', String(bountyId))
          .single();

        if (error) throw error;
        return data as unknown as Bounty;
      }

      // Fallback to API
      const response = await fetch(`${API_BASE_URL}/api/bounties/${bountyId}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      logger.error('Error fetching bounty for request', { bountyId, error });
      return null;
    }
  },

  /**
   * Update bounty record with payment_intent_id
   */
  async updateBountyPaymentIntent(
    bountyId: string | number,
    paymentIntentId: string
  ): Promise<void> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('bounties')
          .update({ payment_intent_id: paymentIntentId })
          .eq('id', String(bountyId));

        if (error) throw error;
      } else {
        // Fallback to API
        const response = await fetch(`${API_BASE_URL}/api/bounties/${bountyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent_id: paymentIntentId }),
        });

        if (!response.ok) {
          throw new Error(`Failed to update bounty: ${response.statusText}`);
        }
      }
    } catch (error) {
      logger.error('Error updating bounty payment_intent_id', { bountyId, paymentIntentId, error });
      throw error;
    }
  },

  /**
   * Reject a bounty request
   */
  async rejectRequest(requestId: string | number): Promise<BountyRequest | null> {
    return this.updateStatus(requestId, 'rejected');
  },
};
