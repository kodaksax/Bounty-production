/**
 * Moments Queue — persistence.
 *
 * Thin Supabase-backed CRUD over user_activation_moments. Deliberately
 * dumb: this file has no eligibility/priority logic (that's engine.ts) — it
 * only reads/writes per-user, per-moment state so it behaves consistently
 * across devices and app restarts.
 */

import { supabase } from '../supabase';
import type { MomentState, MomentStatus, MomentType } from './types';

interface MomentRow {
  moment_type: string;
  status: MomentStatus;
  shown_count: number;
  first_shown_at: string | null;
  last_shown_at: string | null;
  dismissed_at: string | null;
  completed_at: string | null;
  snoozed_until: string | null;
  metadata: Record<string, unknown> | null;
}

function rowToState(row: MomentRow): MomentState {
  return {
    momentType: row.moment_type as MomentType,
    status: row.status,
    shownCount: row.shown_count,
    firstShownAt: row.first_shown_at,
    lastShownAt: row.last_shown_at,
    dismissedAt: row.dismissed_at,
    completedAt: row.completed_at,
    snoozedUntil: row.snoozed_until,
    metadata: row.metadata ?? {},
  };
}

async function fetchRow(userId: string, momentType: MomentType): Promise<MomentRow | null> {
  const { data, error } = await supabase
    .from('user_activation_moments')
    .select('*')
    .eq('user_id', userId)
    .eq('moment_type', momentType)
    .maybeSingle();
  if (error) {
    console.error('[moments] fetchRow failed', { momentType, error });
    return null;
  }
  return data as MomentRow | null;
}

export const momentsService = {
  /** Loads every persisted moment state for a user, keyed by moment type. */
  async fetchStates(userId: string): Promise<Map<MomentType, MomentState>> {
    const map = new Map<MomentType, MomentState>();
    const { data, error } = await supabase
      .from('user_activation_moments')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('[moments] fetchStates failed', error);
      return map;
    }

    for (const row of (data ?? []) as MomentRow[]) {
      map.set(row.moment_type as MomentType, rowToState(row));
    }
    return map;
  },

  /** Marks a moment as having been presented to the user. Lazily creates the row on first show. */
  async markShown(userId: string, momentType: MomentType): Promise<void> {
    const existing = await fetchRow(userId, momentType);
    const now = new Date().toISOString();
    const { error } = await supabase.from('user_activation_moments').upsert(
      {
        user_id: userId,
        moment_type: momentType,
        status: 'shown',
        shown_count: (existing?.shown_count ?? 0) + 1,
        first_shown_at: existing?.first_shown_at ?? now,
        last_shown_at: now,
      },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] markShown failed', { momentType, error });
  },

  async markDismissed(userId: string, momentType: MomentType): Promise<void> {
    const { error } = await supabase.from('user_activation_moments').upsert(
      {
        user_id: userId,
        moment_type: momentType,
        status: 'dismissed',
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] markDismissed failed', { momentType, error });
  },

  async markCompleted(userId: string, momentType: MomentType): Promise<void> {
    const { error } = await supabase.from('user_activation_moments').upsert(
      {
        user_id: userId,
        moment_type: momentType,
        status: 'completed',
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] markCompleted failed', { momentType, error });
  },

  /**
   * Marks a moment as expired: it was shown its maximum number of times
   * (see MomentDefinition.maxShownCount) without the user ever completing
   * or explicitly dismissing it. Distinct from 'dismissed' so backlog/
   * conversion reporting can tell "the user said no" apart from "we gave up
   * asking" — see MomentsProvider's exhausted-without-resolution check.
   */
  async markExpired(userId: string, momentType: MomentType): Promise<void> {
    const { error } = await supabase.from('user_activation_moments').upsert(
      { user_id: userId, moment_type: momentType, status: 'expired' },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] markExpired failed', { momentType, error });
  },

  async markSnoozed(userId: string, momentType: MomentType, hours: number): Promise<void> {
    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('user_activation_moments').upsert(
      { user_id: userId, moment_type: momentType, status: 'snoozed', snoozed_until: snoozedUntil },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] markSnoozed failed', { momentType, error });
  },

  /**
   * Records that the user actively engaged a 'navigate' moment's primary
   * action (e.g. tapped "Set up payouts" and is now in the Connect
   * onboarding screen), without resolving it as completed on its own —
   * merges startedAt into metadata and leaves status untouched (still
   * 'shown', still subject to its normal cooldown) so a moment the user
   * genuinely started isn't indistinguishable from one they never engaged.
   */
  async markStarted(userId: string, momentType: MomentType): Promise<void> {
    const existing = await fetchRow(userId, momentType);
    const { error } = await supabase.from('user_activation_moments').upsert(
      {
        user_id: userId,
        moment_type: momentType,
        status: existing?.status ?? 'shown',
        metadata: { ...(existing?.metadata ?? {}), startedAt: existing?.metadata?.startedAt ?? new Date().toISOString() },
      },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] markStarted failed', { momentType, error });
  },

  /**
   * Explicit trigger for event-driven moments (see registry.ts doc
   * comments for which types expect this). Re-arms a previously completed
   * *recurring* moment; otherwise a no-op if already completed/dismissed
   * within cooldown, so callers can call this liberally without worrying
   * about re-showing something the user already resolved.
   */
  async enqueue(userId: string, momentType: MomentType, metadata: Record<string, unknown> = {}): Promise<void> {
    const existing = await fetchRow(userId, momentType);
    if (existing && (existing.status === 'shown' || existing.status === 'pending')) {
      // Already queued/visible — just merge in fresh metadata (e.g. a newer bountyId).
      const { error } = await supabase
        .from('user_activation_moments')
        .update({ metadata: { ...(existing.metadata ?? {}), ...metadata } })
        .eq('user_id', userId)
        .eq('moment_type', momentType);
      if (error) console.error('[moments] enqueue (merge) failed', { momentType, error });
      return;
    }
    if (existing && existing.status === 'completed') {
      // Only recurring moments should be re-armed by the caller; the engine
      // enforces that via MomentDefinition.recurring, so it's safe to always
      // flip back to 'pending' here — a non-recurring moment simply won't
      // be picked up as eligible again regardless.
    }
    const { error } = await supabase.from('user_activation_moments').upsert(
      { user_id: userId, moment_type: momentType, status: 'pending', metadata },
      { onConflict: 'user_id,moment_type' }
    );
    if (error) console.error('[moments] enqueue failed', { momentType, error });
  },
};
