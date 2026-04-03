import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { CURRENT_USER_ID, getCurrentUserId } from 'lib/utils/data-utils';
import getApiBaseFallback from 'lib/utils/dev-host';
import { logger } from 'lib/utils/error-logger';
import { getReachableApiBaseUrl } from 'lib/utils/network';

import { API_BASE_URL } from 'lib/config/api';

const relayPreferredBase = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)
  || (process.env.EXPO_PUBLIC_API_URL as string | undefined)
  || (process.env.API_BASE_URL as string | undefined)
  || 'http://localhost:3001';

function getRelayApiBaseUrl(): string {
  const resolved = getReachableApiBaseUrl(relayPreferredBase, 3001);

  try {
    const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1)[:/]/i.test(resolved);
    if (isLocal) {
      const fallback = getApiBaseFallback();
      if (fallback) return fallback;
    }
  } catch {
    // ignore and use resolved value
  }

  return resolved.replace(/\/+$/, '');
}

function isEdgeFunctionsBase(url: string): boolean {
  return /\/functions\/v1\/?$/i.test(url)
}

async function postReadyViaEdgeFunction(bountyId: string, hunterId: string): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Missing access token for edge function request')
  }

  const anonKey =
    (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    (process.env.SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    ''

  const response = await fetch(`${API_BASE_URL}/completion/ready`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
    },
    body: JSON.stringify({ bounty_id: bountyId, hunter_id: hunterId }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Edge function failed: ${text}`)
  }

  return true
}

async function postReadyViaRelayApi(bountyId: string, hunterId: string): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  const response = await fetch(`${getRelayApiBaseUrl()}/bounties/${encodeURIComponent(bountyId)}/ready`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ hunter_id: hunterId }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Fallback API failed: ${text}`)
  }

  return true
}

export interface CompletionSubmission {
  id?: string;
  bounty_id: string;
  hunter_id: string;
  message: string;
  proof_items: ProofItem[];
  submitted_at?: string;
  status: 'pending' | 'approved' | 'rejected' | 'revision_requested';
  poster_feedback?: string;
  revision_count?: number;
}

export interface ProofItem {
  id: string;
  type: 'image' | 'file';
  name: string;
  url?: string;
  uri?: string;
  size?: number;
  mimeType?: string;
}

export interface Rating {
  id?: string;
  bounty_id: string;
  from_user_id: string;
  to_user_id: string;
  rating: number; // 1-5
  comment?: string;
  created_at?: string;
}

export const completionService = {
  /**
   * Submit completion for review
   */
  async submitCompletion(submission: Omit<CompletionSubmission, 'id' | 'submitted_at' | 'status'>): Promise<CompletionSubmission | null> {
    try {
      if (isSupabaseConfigured) {
        // Prevent duplicate pending submissions for the same bounty + hunter
        const { data: existing, error: fetchErr } = await supabase
          .from('completion_submissions')
          .select('*')
          .eq('bounty_id', submission.bounty_id)
          .eq('hunter_id', submission.hunter_id)
          .eq('status', 'pending')
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (existing) {
          // Return the existing pending submission instead of creating a duplicate
          return {
            ...existing,
            proof_items: JSON.parse(existing.proof_items || '[]'),
          } as CompletionSubmission;
        }

        const { data, error } = await supabase
          .from('completion_submissions')
          .insert({
            ...submission,
            status: 'pending',
            submitted_at: new Date().toISOString(),
            proof_items: JSON.stringify(submission.proof_items),
          })
          .select('*')
          .single();

        if (error) throw new Error(error?.message ?? JSON.stringify(error));

        return {
          ...data,
          proof_items: JSON.parse(data.proof_items || '[]'),
        } as CompletionSubmission;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...submission,
          status: 'pending',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to submit completion: ${errorText}`);
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error submitting completion', { submission, error });
      throw error;
    }
  },

  /**
   * Subscribe to completion_submissions changes for a bounty. Calls onUpdate with the latest submission or null.
   * Returns an unsubscribe function.
   */
  subscribeSubmission(bountyId: string, onUpdate: (submission: CompletionSubmission | null) => void) {
    if (isSupabaseConfigured) {
      try {
        // Prefer channel API when available
        // @ts-ignore
        if (typeof (supabase as any).channel === 'function') {
          // @ts-ignore
          const channel = (supabase as any).channel(`completion_submissions:${bountyId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'completion_submissions', filter: `bounty_id=eq.${bountyId}` }, async (payload: any) => {
              const latest = await (completionService as any).getSubmission(bountyId)
              onUpdate(latest)
            })
            .subscribe()

          return () => { try { (supabase as any).removeChannel(channel) } catch {} }
        }

        // Fallback classic subscription
        // @ts-ignore
        const sub = supabase.from(`completion_submissions:bounty_id=eq.${bountyId}`).on('*', async (payload: any) => {
          const latest = await (completionService as any).getSubmission(bountyId)
          onUpdate(latest)
        }).subscribe()

        return () => { try { supabase.removeChannel && supabase.removeChannel(sub) } catch {} }
      } catch (e) {
        logger.warning('Realtime submission subscription failed, falling back to polling', { bountyId, error: (e as any)?.message })
      }
    }

    // Polling fallback
    let mounted = true
    const interval = (globalThis as any).setInterval(async () => {
      if (!mounted) return
      const rec = await (completionService as any).getSubmission(bountyId)
      onUpdate(rec)
    }, 3000)

    // Register interval for test cleanup
    if (process.env.NODE_ENV === 'test') {
      const _i = interval as any
      if (typeof _i?.unref === 'function') {
        try { _i.unref(); } catch { /* ignore */ }
      }
      ;(globalThis as any).__BACKGROUND_INTERVALS = (globalThis as any).__BACKGROUND_INTERVALS || []
      ;(globalThis as any).__BACKGROUND_INTERVALS.push(interval)
    }

    // initial fetch
    (async () => { const r = await completionService.getSubmission(bountyId); onUpdate(r) })()

    return () => { mounted = false; (globalThis as any).clearInterval(interval) }
  },

  /**
   * Get completion submission for a bounty
   */
  async getSubmission(bountyId: string): Promise<CompletionSubmission | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('completion_submissions')
          .select('*')
          .eq('bounty_id', bountyId)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .single();

        if (error) {
          if (error.code === 'PGRST116') return null; // No rows
          throw new Error(error?.message ?? JSON.stringify(error));
        }

        return {
          ...data,
          proof_items: JSON.parse(data.proof_items || '[]'),
        } as CompletionSubmission;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${bountyId}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch completion');
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error fetching completion', { bountyId, error });
      return null;
    }
  },

  /**
   * Mark the bounty as 'ready' for review by a hunter (persistence for Ready-to-Submit flag)
   */
  async markReady(bountyId: string, hunterId: string): Promise<boolean> {
    try {
      if (!bountyId || !hunterId) {
        logger.error('Error marking ready', { bountyId, hunterId, error: 'Missing bountyId or hunterId' })
        return false
      }

      if (isSupabaseConfigured) {
        try {
          // Some Postgres deployments may not have a unique constraint matching
          // the provided ON CONFLICT target. To avoid hard failure, perform a
          // safe read-then-insert/update flow instead of relying on upsert with
          // an ON CONFLICT clause which requires a matching unique index.
          const now = new Date().toISOString()
          const payload = {
            bounty_id: bountyId,
            hunter_id: hunterId,
            ready_at: now,
          }

          // Try to perform an atomic upsert using Postgres' ON CONFLICT. This
          // prevents a race where two clients simultaneously try to insert the
          // same record. If the database doesn't have a unique index for the
          // conflict target (some deployments may not), fall back to the
          // existing safe read-then-insert/update flow.
          try {
            // Use an array payload for upsert to match supabase client expectations
            const qb = supabase.from('completion_ready') as any

            if (qb && typeof qb.upsert === 'function') {
              const { error: upsertErr } = await qb.upsert([payload], { onConflict: 'bounty_id,hunter_id' })
              if (!upsertErr) return true

              const upsertMsg = (upsertErr as any)?.message || String(upsertErr)
              if (!/unique|on conflict|constraint/i.test(upsertMsg)) {
                const message = upsertMsg || JSON.stringify(upsertErr)
                throw new Error(message)
              }
              // else: fall through to fallback
            } else {
              // Supabase client or its mock doesn't support upsert; use fallback
              // read-then-insert/update flow instead of throwing.
              /* intentionally fall through */
            }
          } catch (e) {
            const emsg = e instanceof Error ? e.message : String(e)
            if (!/unique|on conflict|constraint/i.test(emsg)) {
              // Non-ON CONFLICT related error — rethrow for outer handler
              throw e
            }
            // else: fall back to safe read-then-insert/update below
          }

          // Fallback: safe read-then-insert/update flow for DBs without the
          // required unique index. This preserves previous behavior but only
          // runs when upsert cannot be used.
          const { data: existing, error: fetchErr } = await supabase
            .from('completion_ready')
            .select('*')
            .eq('bounty_id', bountyId)
            .eq('hunter_id', hunterId)
            .limit(1)
            .maybeSingle()

          if (fetchErr) {
            const message = (fetchErr as any)?.message || JSON.stringify(fetchErr)
            throw new Error(message)
          }

          if (existing) {
            const { error: updErr } = await supabase
              .from('completion_ready')
              .update({ ready_at: now })
              .eq('bounty_id', bountyId)
              .eq('hunter_id', hunterId)

            if (updErr) {
              const message = (updErr as any)?.message || JSON.stringify(updErr)
              throw new Error(message)
            }
            return true
          }

          // No existing record — insert a new one
          const { error: insErr } = await supabase
            .from('completion_ready')
            .insert(payload)

          if (insErr) {
            const message = (insErr as any)?.message || JSON.stringify(insErr)
            throw new Error(message)
          }

          return true
        } catch (e) {
          // If this looks like a row-level security / permission error,
          // fall back to the server API instead of failing in the client.
          const emsg = e instanceof Error ? e.message : String(e)
          if (/row-level security|permission|forbidden|not authorized/i.test(emsg)) {
            try {
              if (isEdgeFunctionsBase(API_BASE_URL)) {
                return await postReadyViaEdgeFunction(bountyId, hunterId)
              }

              return await postReadyViaRelayApi(bountyId, hunterId)
            } catch (edgeOrRelayErr) {
              // If edge routing is configured but the function is missing or unavailable,
              // try the relay backend as a last resort before failing.
              if (isEdgeFunctionsBase(API_BASE_URL)) {
                try {
                  return await postReadyViaRelayApi(bountyId, hunterId)
                } catch {
                  // fall through to throw original error below
                }
              }

              const message = edgeOrRelayErr instanceof Error ? edgeOrRelayErr.message : String(edgeOrRelayErr)
              throw new Error(message)
            }
          }

          // rethrow other errors to be handled by the outer catch
          throw e
        }
      }

      if (isEdgeFunctionsBase(API_BASE_URL)) {
        return await postReadyViaEdgeFunction(bountyId, hunterId)
      }

      return await postReadyViaRelayApi(bountyId, hunterId)
    } catch (err) {
      // Ensure we log a meaningful error message even when a non-Error
      // object is thrown by a library (e.g. Supabase's error object).
      const normalized = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err))
      logger.error('Error marking ready', { bountyId, hunterId, message: normalized.message, stack: normalized.stack })
      return false
    }
  },

  /**
   * Get the ready record for a bounty
   */
  async getReady(bountyId: string): Promise<{ bounty_id: string; hunter_id: string; ready_at: string } | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('completion_ready')
          .select('*')
          .eq('bounty_id', bountyId)
          .limit(1)
          .maybeSingle()

        if (error) throw error
        return data || null
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${bountyId}/ready`)
      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error('Failed to fetch ready state')
      }
      return await response.json()
    } catch (err) {
      logger.error('Error fetching ready state', { bountyId, error: (err as any)?.message })
      return null
    }
  },

  /**
   * Subscribe to ready-state updates for a bounty. Returns an unsubscribe function.
   * Tries realtime subscription when Supabase is configured; falls back to polling every 3s.
   */
  subscribeReady(bountyId: string, onUpdate: (record: { bounty_id: string; hunter_id: string; ready_at: string } | null) => void) {
    if (isSupabaseConfigured) {
      try {
        // Attempt realtime subscription via Postgres changes
        // Use the table-level subscription; if the client's supabase SDK doesn't support channel API,
        // fall back to from(...).on(...).subscribe() pattern.
        // Prefer supabase.channel if available (supabase-js v2+)
        // @ts-ignore
        if (typeof (supabase as any).channel === 'function') {
          // @ts-ignore
          const channel = (supabase as any).channel(`completion_ready:${bountyId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'completion_ready', filter: `bounty_id=eq.${bountyId}` }, (payload: any) => {
              onUpdate(payload.new || null)
            })
            .subscribe()

          return () => {
            try { (supabase as any).removeChannel(channel) } catch { /* ignore */ }
          }
        }

        // Fallback: classic subscription
        // @ts-ignore
        const sub = supabase.from(`completion_ready:bounty_id=eq.${bountyId}`).on('*', (payload: any) => {
          onUpdate(payload.new || null)
        }).subscribe()

        return () => {
          try { supabase.removeChannel && supabase.removeChannel(sub) } catch { /* ignore */ }
        }
      } catch (e) {
        logger.warning('Realtime subscription failed, falling back to polling', { bountyId, error: (e as any)?.message })
      }
    }

    // Polling fallback
    let mounted = true
    const interval = (globalThis as any).setInterval(async () => {
      if (!mounted) return
      // Use any-cast to avoid circular-typing issues inside the object literal
      const record = await (completionService as any).getReady(bountyId)
      onUpdate(record)
    }, 3000)

    // Register interval for test cleanup
    if (process.env.NODE_ENV === 'test') {
      const _i = interval as any
      if (typeof _i?.unref === 'function') {
        try { _i.unref(); } catch { /* ignore */ }
      }
      ;(globalThis as any).__BACKGROUND_INTERVALS = (globalThis as any).__BACKGROUND_INTERVALS || []
      ;(globalThis as any).__BACKGROUND_INTERVALS.push(interval)
    }

    // Initial fetch
    (async () => { const r = await completionService.getReady(bountyId); onUpdate(r) })()

  return () => { mounted = false; (globalThis as any).clearInterval(interval) }
  },

  /**
   * Approve completion (poster action)
   */
  async approveCompletion(submissionId: string): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('completion_submissions')
          .update({ status: 'approved' })
          .eq('id', submissionId);

        if (error) throw error;
        return true;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${submissionId}/approve`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to approve completion');
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error approving completion', { submissionId, error });
      throw error;
    }
  },

  /**
   * Approve submission and complete bounty (combined poster action)
   * This wraps approveCompletion and also updates bounty status to completed.
   * Note: Caller is responsible for releasing escrow funds if needed.
   */
  async approveSubmission(bountyId: string, options?: { posterFeedback?: string; rating?: number }): Promise<boolean> {
    try {
      // Get the submission first
      const submission = await completionService.getSubmission(bountyId);
      if (!submission) {
        throw new Error('No submission found for bounty');
      }

      // Approve the submission
      await completionService.approveCompletion(submission.id!);

  // Update bounty status using bountyService
  // Note: bounty IDs may be UUID strings; do NOT coerce to Number() (causes NaN)
  const { bountyService } = await import('./bounty-service');
  await bountyService.update(bountyId, { status: 'completed' });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error approving submission', { bountyId, error });
      throw error;
    }
  },

  /**
   * Request revision (poster action)
   */
  async requestRevision(submissionId: string, feedback: string): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        // Get submission details first to find bounty and hunter
        const { data: submission, error: fetchError } = await supabase
          .from('completion_submissions')
          .select(`
            bounty_id, 
            hunter_id,
            bounties:bounty_id (
              title
            )
          `)
          .eq('id', submissionId)
          .single();

        if (fetchError) throw fetchError;

        // Update submission status and feedback
        const { error } = await supabase
          .from('completion_submissions')
          .update({ 
            status: 'revision_requested',
            poster_feedback: feedback,
          })
          .eq('id', submissionId);

        if (error) throw error;

        // Get bounty title for notifications
        const bountyTitle = (submission as any)?.bounties?.title || 'Bounty';

        // Send (or create + send) system message to bounty conversation
        if (submission?.bounty_id) {
          try {
            const { messageService } = await import('./message-service');
            const all = await messageService.getConversations();
            let bountyConversation = all.find(c => String(c.bountyId) === String(submission.bounty_id));
            // Fallback: attempt to create a conversation if none exists yet
            if (!bountyConversation) {
              try {
                const posterId = getCurrentUserId();
                const hunterId = String(submission.hunter_id);
                bountyConversation = await messageService.getOrCreateConversation([hunterId, posterId], `Bounty ${submission.bounty_id}`, submission.bounty_id);
              } catch (convErr) {
                logger.warning('Failed to auto-create bounty conversation for revision', { error: convErr });
              }
            }
            if (bountyConversation) {
              const currentUserId = getCurrentUserId();
              await messageService.sendMessage(
                bountyConversation.id,
                `🔄 Revision requested: ${feedback}`,
                currentUserId
              );
            }
          } catch (msgErr) {
            logger.warning('Failed to send revision system message', { error: msgErr });
          }
        }

        // Send notification to hunter and force realtime visibility (insert triggers subscription)
        if (submission?.hunter_id && submission?.bounty_id) {
          try {
            await supabase.from('notifications').insert({
              user_id: submission.hunter_id,
              type: 'completion',
              title: 'Revision Requested',
              body: `The poster requested changes to "${bountyTitle}". Check the feedback and resubmit.`,
              data: { bountyId: submission.bounty_id, feedback, isRevision: true },
              read: false,
            });
          } catch (notifErr) {
            logger.warning('Failed to send revision notification', { error: notifErr });
          }
        }

        return true;
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${submissionId}/request-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });

      if (!response.ok) {
        throw new Error('Failed to request revision');
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error requesting revision', { submissionId, error });
      throw error;
    }
  },

  /**
   * Submit rating
   */
  async submitRating(rating: Omit<Rating, 'id' | 'created_at'>): Promise<Rating | null> {
    try {
      // Defensive: ensure from_user_id/to_user_id look valid. If from_user_id is empty,
      // try to populate from current session helper. This prevents inserting empty strings
      // into UUID columns which causes DB errors like "invalid input syntax for type uuid: \"\"".
      const payload: Omit<Rating, 'id' | 'created_at'> & { created_at?: string } = {
        ...rating,
        created_at: new Date().toISOString(),
      };

      let sessionUserId: string | null = null;
      if (isSupabaseConfigured) {
        try {
          const { data } = await supabase.auth.getSession();
          sessionUserId = data?.session?.user?.id ?? null;
        } catch {
          sessionUserId = null;
        }
      }

      if (!payload.from_user_id || String(payload.from_user_id).trim() === '' || payload.from_user_id === CURRENT_USER_ID) {
        if (sessionUserId) {
          payload.from_user_id = sessionUserId;
        }
      }

      if (!payload.from_user_id || String(payload.from_user_id).trim() === '') {
        const uid = getCurrentUserId();
        if (uid) payload.from_user_id = uid;
      }

      if (!payload.from_user_id || !payload.to_user_id) {
        throw new Error('Missing required rating fields: from_user_id and to_user_id must be provided');
      }

      if (payload.rating < 1 || payload.rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }

      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('ratings')
          .insert(payload)
          .select('*')
          .single();

        if (!error) {
          return data as Rating;
        }

        const primaryError = String(error?.message || JSON.stringify(error)).toLowerCase();
        const canFallback =
          primaryError.includes('relation') ||
          primaryError.includes('does not exist') ||
          primaryError.includes('column') ||
          primaryError.includes('schema cache');

        if (!canFallback) {
          throw new Error(error?.message ?? JSON.stringify(error));
        }

        const { data: fallbackData, error: fallbackError } = await supabase
          .from('user_ratings')
          .insert({
            user_id: payload.to_user_id,
            rater_id: payload.from_user_id,
            bounty_id: payload.bounty_id,
            score: payload.rating,
            comment: payload.comment,
          })
          .select('*')
          .single();

        if (fallbackError) throw new Error(fallbackError?.message ?? JSON.stringify(fallbackError));

        return {
          id: fallbackData.id,
          bounty_id: fallbackData.bounty_id,
          from_user_id: fallbackData.rater_id,
          to_user_id: fallbackData.user_id,
          rating: fallbackData.score,
          comment: fallbackData.comment,
          created_at: fallbackData.created_at,
        } as Rating;
      }

      const response = await fetch(`${API_BASE_URL}/api/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to submit rating: ${errText}`);
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error submitting rating', { rating, error });
      throw error;
    }
  },

  /**
   * Get ratings for a user
   */
  async getUserRatings(userId: string): Promise<Rating[]> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('ratings')
          .select('*')
          .eq('to_user_id', userId)
          .order('created_at', { ascending: false });

        if (!error) {
          return (data as Rating[]) || [];
        }

        const primaryError = String(error?.message || JSON.stringify(error)).toLowerCase();
        const canFallback =
          primaryError.includes('relation') ||
          primaryError.includes('does not exist') ||
          primaryError.includes('column') ||
          primaryError.includes('schema cache');

        if (!canFallback) throw error;

        const { data: fallbackData, error: fallbackError } = await supabase
          .from('user_ratings')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (fallbackError) throw fallbackError;

        return ((fallbackData || []).map((row: any) => ({
          id: row.id,
          bounty_id: row.bounty_id,
          from_user_id: row.rater_id,
          to_user_id: row.user_id,
          rating: row.score,
          comment: row.comment,
          created_at: row.created_at,
        })) as Rating[]);
      }

      const response = await fetch(`${API_BASE_URL}/api/ratings/user/${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch ratings');
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error fetching user ratings', { userId, error });
      return [];
    }
  },
};
