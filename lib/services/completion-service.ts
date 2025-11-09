import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { getCurrentUserId } from 'lib/utils/data-utils';
import { logger } from 'lib/utils/error-logger';

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

import { API_BASE_URL } from 'lib/config/api';

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
      if (isSupabaseConfigured) {
        const payload = {
          bounty_id: bountyId,
          hunter_id: hunterId,
          ready_at: new Date().toISOString(),
        }
        const { error } = await supabase
          .from('completion_ready')
          .upsert(payload, { onConflict: 'bounty_id' })

        if (error) throw error
        return true
      }

      const response = await fetch(`${API_BASE_URL}/api/completions/${bountyId}/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunter_id: hunterId }),
      })
      if (!response.ok) throw new Error('Failed to mark ready')
      return true
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      logger.error('Error marking ready', { bountyId, hunterId, error })
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

        // Send system message to bounty conversation if it exists
        if (submission?.bounty_id) {
          try {
            // Import messageService dynamically to avoid circular dependencies
            const { messageService } = await import('./message-service');
            const conversations = await messageService.getConversations();
            const bountyConversation = conversations.find(
              c => String(c.bountyId) === String(submission.bounty_id)
            );

            if (bountyConversation) {
              // Send a system-like message from the poster about the revision
              const currentUserId = getCurrentUserId();
              await messageService.sendMessage(
                bountyConversation.id,
                `🔄 Revision requested: ${feedback}`,
                currentUserId
              );
            }
          } catch (msgErr) {
            // Don't fail the revision request if message sending fails
            logger.warning('Failed to send revision message to conversation', { error: msgErr });
          }
        }

        // Send notification to hunter (works even without backend API)
        if (submission?.hunter_id && submission?.bounty_id) {
          try {
            // For frontend-only setup, we can still create a notification record in Supabase
            await supabase.from('notifications').insert({
              user_id: submission.hunter_id,
              type: 'completion',
              title: 'Revision Requested',
              body: `The poster requested changes to "${bountyTitle}". Check the feedback and resubmit.`,
              data: { 
                bountyId: submission.bounty_id, 
                feedback, 
                isRevision: true 
              },
              read: false,
            });
          } catch (notifErr) {
            // Don't fail the revision request if notification fails
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

      if (!payload.from_user_id || String(payload.from_user_id).trim() === '') {
        const uid = getCurrentUserId();
        if (uid) payload.from_user_id = uid;
      }

      if (!payload.from_user_id || !payload.to_user_id) {
        throw new Error('Missing required rating fields: from_user_id and to_user_id must be provided');
      }

      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('ratings')
          .insert(payload)
          .select('*')
          .single();

        if (error) throw new Error(error?.message ?? JSON.stringify(error));
        return data as Rating;
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

        if (error) throw error;
        return (data as Rating[]) || [];
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
