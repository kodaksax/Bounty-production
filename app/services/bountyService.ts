import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { analyticsService } from 'lib/services/analytics-service';
import { bountyService as baseBountyService } from 'lib/services/bounty-service';
import type { Bounty } from 'lib/services/database.types';
import { performanceService } from 'lib/services/performance-service';
import { offlineQueueService } from 'lib/services/offline-queue-service';
import { isSupabaseConfigured, supabaseEnv } from 'lib/supabase';
import { validateTitle } from 'lib/utils/bounty-validation';
import { getCurrentUserId } from 'lib/utils/data-utils';

export interface CreateBountyPayload {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  work_type: 'online' | 'in_person';
  category?: string;
  timeline?: string;
  skills_required?: string;
  poster_id: string;
  status: 'open';
}

/**
 * Result of createBounty(). `created` is `false` when the call was deduplicated
 * against a recent identical submission from the same poster (idempotent retry);
 * callers MUST use this flag to avoid double-funding escrow or otherwise repeating
 * side effects on retried submissions.
 */
export interface CreateBountyResult {
  bounty: Bounty;
  created: boolean;
}

/**
 * Idempotency cache: maps a stable per-draft fingerprint to either an in-flight
 * create promise (so concurrent double-tap calls share a single insert) or a
 * recently completed result (so a retry started after the original succeeded
 * returns the same bounty instead of creating a duplicate).
 *
 * Scoped at module level so it survives across React re-renders for the same
 * JS runtime (single-process). Cross-device / cross-process atomic protection
 * would require a server-side idempotency key store.
 */
const IDEMPOTENCY_TTL_MS = 60_000;
const inFlightCreates = new Map<string, Promise<Bounty>>();
const recentCreates = new Map<string, { bounty: Bounty; expiresAt: number }>();

/**
 * Build a stable fingerprint over the full draft so different bounties get
 * different keys. Two submissions are treated as retries of each other ONLY
 * when every user-visible field matches — protects against silently returning
 * an old row when the user actually edited something (description, amount, etc.)
 * before resubmitting.
 */
function computeDraftFingerprint(posterId: string, draft: BountyDraft): string {
  const normalize = (v: unknown) =>
    typeof v === 'string' ? v.trim().toLowerCase() : v === undefined || v === null ? '' : String(v);
  const parts = [
    posterId,
    normalize(draft.title),
    normalize(draft.description),
    String(draft.isForHonor ? 0 : Number(draft.amount) || 0),
    draft.isForHonor ? '1' : '0',
    normalize(draft.workType),
    normalize(draft.location),
    normalize(draft.timeline),
    normalize(draft.skills),
    normalize(draft.category),
  ];
  return parts.join('|');
}

function pruneExpiredRecent(now: number): void {
  for (const [key, entry] of recentCreates) {
    if (entry.expiresAt <= now) {
      recentCreates.delete(key);
    }
  }
}

/**
 * Exposed for tests. Clears all in-process idempotency state.
 */
export function __resetIdempotencyCacheForTests(): void {
  inFlightCreates.clear();
  recentCreates.clear();
}

export const bountyService = {
  /**
   * Delete a bounty by ID
   * This is used for rollback when fund deduction fails after bounty creation
   */
  async deleteBounty(id: number | string): Promise<boolean> {
    try {
      return await baseBountyService.delete(typeof id === 'string' ? parseInt(id, 10) : id);
    } catch (error) {
      console.error('Error deleting bounty:', error);
      return false;
    }
  },

  /**
   * Create a bounty from draft data.
   *
   * Returns `{ bounty, created }`. `created === false` means this call was a
   * deduplicated retry of a very recent identical submission from the same
   * poster — callers MUST NOT re-run side effects like funding escrow when
   * `created` is false (the original call already did so).
   *
   * Idempotency is keyed on a fingerprint of the full draft payload, so two
   * different bounties (even with the same title) get different keys and are
   * never collapsed. Concurrent in-process calls for the same fingerprint
   * share a single insert promise (atomic same-process dedup).
   */
  async createBounty(draft: BountyDraft): Promise<CreateBountyResult> {
    // Start performance measurement
    performanceService.startMeasurement('bounty_create', 'bounty_create', {
      workType: draft.workType,
      isForHonor: draft.isForHonor,
      hasAttachments: (draft.attachments?.length || 0) > 0,
    });

    try {
      // Title validation guard — reject empty or too-short titles before any DB work
      const titleError = validateTitle(draft.title);
      if (titleError) {
        throw new Error(titleError);
      }

      // Enforce posting to Supabase only for this guided flow
      if (!isSupabaseConfigured) {
        const reasons: string[] = []
        if (!supabaseEnv.hasUrl) reasons.push('EXPO_PUBLIC_SUPABASE_URL is missing')
        if (!supabaseEnv.hasKey) reasons.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is missing')
        if (supabaseEnv.mismatch) reasons.push('Project ref mismatch between URL and key')
        throw new Error(
          `Supabase is not configured. This action requires posting directly to Supabase.\n\n` +
          `Please set the following environment variables and restart the app:\n` +
          `- EXPO_PUBLIC_SUPABASE_URL\n- EXPO_PUBLIC_SUPABASE_ANON_KEY\n\n` +
          (reasons.length ? `Detected issues: ${reasons.join('; ')}` : '')
        )
      }

      const posterId = getCurrentUserId();

      const payload: Omit<Bounty, 'id' | 'created_at'> & { attachments?: any[]; category?: string } = {
        title: draft.title,
        description: draft.description,
        amount: draft.isForHonor ? 0 : draft.amount,
        is_for_honor: draft.isForHonor,
        location: draft.workType === 'in_person' ? draft.location : '',
        work_type: draft.workType,
        category: draft.category || undefined,
        timeline: draft.timeline || '',
        skills_required: draft.skills || '',
        poster_id: posterId,
        user_id: posterId,
        status: 'open',
        // Include attachments from draft so they get persisted to attachments_json
        attachments: draft.attachments || [],
      };

      // If offline, enqueue the bounty for later processing and return an optimistic temp object
      const isOnline = offlineQueueService.getOnlineStatus();

      if (!isOnline) {
        // Generate a temporary id for optimistic UI
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Enqueue for background processing
        try {
          await offlineQueueService.enqueue('bounty', { bounty: payload, tempId });
          // Track as queued
          await analyticsService.trackEvent('bounty_queued', { hasAttachments: (draft.attachments?.length || 0) > 0 });
        } catch (e) {
          console.error('Failed to enqueue bounty for offline processing:', e);
        }

        // Return optimistic temp bounty so UI can proceed
        const tempBounty = {
          ...payload,
          id: tempId,
          created_at: new Date().toISOString(),
        } as unknown as Bounty;
        return { bounty: tempBounty, created: true };
      }

      // Idempotent retry protection (online path only).
      // Keyed on the full draft fingerprint — different drafts never collapse.
      const fingerprint = posterId ? computeDraftFingerprint(posterId, draft) : '';
      const now = Date.now();
      pruneExpiredRecent(now);

      if (fingerprint) {
        // 1) Same fingerprint already completed within TTL → idempotent replay.
        const cached = recentCreates.get(fingerprint);
        if (cached && cached.expiresAt > now) {
          await performanceService.endMeasurement('bounty_create', {
            success: true,
            bountyId: cached.bounty.id,
            replayed: true,
          } as any);
          return { bounty: cached.bounty, created: false };
        }

        // 2) Same fingerprint currently in flight → share the existing promise
        //    (atomic dedup of concurrent double-tap submissions in this process).
        const inFlight = inFlightCreates.get(fingerprint);
        if (inFlight) {
          const bounty = await inFlight;
          await performanceService.endMeasurement('bounty_create', {
            success: true,
            bountyId: bounty.id,
            replayed: true,
          } as any);
          return { bounty, created: false };
        }
      }

      // First-time submission for this fingerprint: register the in-flight promise
      // BEFORE awaiting so concurrent callers can join it.
      const createPromise = baseBountyService.create(payload).then((res) => {
        if (!res) {
          throw new Error('Failed to create bounty');
        }
        return res;
      });
      if (fingerprint) {
        inFlightCreates.set(fingerprint, createPromise);
      }

      let result: Bounty;
      try {
        result = await createPromise;
      } finally {
        if (fingerprint) {
          inFlightCreates.delete(fingerprint);
        }
      }

      // Cache the successful result so any subsequent retry within TTL is replayed.
      if (fingerprint) {
        recentCreates.set(fingerprint, {
          bounty: result,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
      }

      // Track bounty creation event
      await analyticsService.trackEvent('bounty_created', {
        bountyId: result.id,
        workType: draft.workType,
        isForHonor: draft.isForHonor,
        amount: draft.isForHonor ? 0 : draft.amount,
        hasLocation: !!draft.location,
        hasTimeline: !!draft.timeline,
        hasSkills: !!draft.skills,
        hasAttachments: (draft.attachments?.length || 0) > 0,
        attachmentCount: draft.attachments?.length || 0,
      });

      // Increment user property for bounties created
      await analyticsService.incrementUserProperty('bounties_created');

      // End performance measurement
      await performanceService.endMeasurement('bounty_create', {
        success: true,
        bountyId: result.id,
      });

      return { bounty: result, created: true };
    } catch (error) {
      console.error('Error creating bounty:', error);

      // End performance measurement with error
      await performanceService.endMeasurement('bounty_create', {
        success: false,
        error: String(error),
      });

      throw error;
    }
  },

  /**
   * Check network connectivity (simple check)
   */
  async checkConnectivity(): Promise<boolean> {
    try {
      // Simple ping to check if network is available.
      // Use Google's generate_204 endpoint which returns 204 when reachable.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch('https://www.google.com/generate_204', {
          method: 'GET',
          signal: controller.signal,
        });

        // Consider connectivity valid only for successful HTTP responses.
        return !!(res && res.ok);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return false;
    }
  },
};

export default bountyService;
