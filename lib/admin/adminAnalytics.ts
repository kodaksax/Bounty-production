// lib/admin/adminAnalytics.ts - Real analytics for the admin console.
//
// Why this exists: app/(admin)/analytics.tsx fetched
// `${EXPO_PUBLIC_API_URL || 'http://localhost:3001'}/admin/analytics/metrics`,
// and that Fastify route (services/api/src/routes/analytics.ts) returned a
// hardcoded object -- `totalUsers: 1250`, `revenueWeek: 3820.5`, a fixed
// `topEvents` list, and so on -- behind a `TODO: Fetch real analytics`. The
// production database has 343 profiles. So the analytics screen was not
// broken in any visible way; it confidently displayed fabricated numbers that
// an operator could easily have acted on.
//
// It also pointed at the wrong backend. Supabase Edge Functions are this
// app's primary backend (see lib/config/api.ts), and the Node service is not
// deployed for mobile clients -- the localhost fallback would never resolve on
// a device.
//
// Everything below is counted from the real tables. Where the platform does
// not record something (there is no analytics_events table), the metric is
// absent rather than invented.
import { supabase } from '../supabase';

export interface AdminAnalyticsWindow {
  today: number;
  week: number;
}

export interface AdminAnalytics {
  generatedAt: string;

  users: {
    total: number;
    new: AdminAnalyticsWindow;
    /** Distinct profiles with a recorded session in the window. */
    active: AdminAnalyticsWindow;
  };

  bounties: {
    created: AdminAnalyticsWindow;
    accepted: AdminAnalyticsWindow;
    completed: AdminAnalyticsWindow;
    /** Applications submitted by hunters. */
    applications: AdminAnalyticsWindow;
  };

  money: {
    /** Count of completed escrow fundings. */
    escrowCount: AdminAnalyticsWindow;
    /** Value of completed escrow fundings. */
    escrowVolume: AdminAnalyticsWindow;
    /** Value released to hunters. */
    releasedVolume: AdminAnalyticsWindow;
    refundedVolume: AdminAnalyticsWindow;
    failedCount: AdminAnalyticsWindow;
  };

  messaging: {
    messages: AdminAnalyticsWindow;
    conversations: AdminAnalyticsWindow;
  };

  errors: {
    count: AdminAnalyticsWindow;
    /** Most frequent client error messages in the last 7 days. */
    top: { message: string; count: number }[];
    /** False when client_logs could not be read (it may be RLS-restricted). */
    available: boolean;
  };
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

/**
 * Count rows in a window. Returns null — not 0 — when the table cannot be
 * read, so the UI can distinguish "nothing happened" from "we could not look".
 */
async function countSince(
  table: string,
  column: string,
  since: string,
  apply?: (q: any) => any
): Promise<number | null> {
  try {
    let query = supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .gte(column, since);
    if (apply) query = apply(query);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function windowCount(
  table: string,
  column: string,
  apply?: (q: any) => any
): Promise<AdminAnalyticsWindow> {
  const [today, week] = await Promise.all([
    countSince(table, column, startOfToday(), apply),
    countSince(table, column, sevenDaysAgo(), apply),
  ]);
  return { today: today ?? 0, week: week ?? 0 };
}

/**
 * Sum `amount` over a window. The wallet ledger is small enough to sum
 * client-side for a 7-day window; if it grows past that this should move to a
 * SQL aggregate behind the admin-profiles-style service-role path.
 */
async function windowSum(
  type: string,
  status = 'completed'
): Promise<AdminAnalyticsWindow> {
  const since = sevenDaysAgo();
  const todayStart = startOfToday();
  try {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('amount, created_at')
      .eq('type', type)
      .eq('status', status)
      .gte('created_at', since);
    if (error) throw error;

    let today = 0;
    let week = 0;
    for (const row of (data ?? []) as { amount: unknown; created_at: string }[]) {
      const amount = Math.abs(Number(row.amount) || 0);
      week += amount;
      if (row.created_at >= todayStart) today += amount;
    }
    return { today, week };
  } catch {
    return { today: 0, week: 0 };
  }
}

/**
 * Distinct users seen in a window.
 *
 * `profiles.last_session_at` holds only the most recent session, so this
 * measures "profiles whose latest session falls inside the window" — the
 * standard approximation when there is no session-event table. It undercounts
 * nobody for `today` and is exact for `week` as long as a user's latest
 * session is their only one in that period.
 */
async function activeUsers(): Promise<AdminAnalyticsWindow> {
  const count = async (since: string) => {
    const direct = await countSince('profiles', 'last_session_at', since);
    if (direct != null) return direct;
    // Older rows track `last_seen_at` instead.
    return (await countSince('profiles', 'last_seen_at', since)) ?? 0;
  };
  const [today, week] = await Promise.all([count(startOfToday()), count(sevenDaysAgo())]);
  return { today, week };
}

async function errorMetrics(): Promise<AdminAnalytics['errors']> {
  const count = await windowCount('client_logs', 'created_at', (q) => q.eq('level', 'error'));
  try {
    // Bounded read: enough to rank the common failures without pulling the
    // whole 54k-row log table into the client.
    const { data, error } = await supabase
      .from('client_logs')
      .select('message')
      .eq('level', 'error')
      .gte('created_at', sevenDaysAgo())
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const tally = new Map<string, number>();
    for (const row of (data ?? []) as { message: string | null }[]) {
      // Normalise so the same failure with different ids groups together.
      const key = (row.message ?? 'Unknown error')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')
        .replace(/\d+/g, '<n>')
        .slice(0, 120);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }

    const top = [...tally.entries()]
      .map(([message, c]) => ({ message, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { count, top, available: true };
  } catch {
    return { count, top: [], available: false };
  }
}

export const adminAnalytics = {
  async fetch(): Promise<AdminAnalytics> {
    const [
      totalUsersResult,
      newUsers,
      active,
      created,
      applications,
      messages,
      conversations,
      escrowCount,
      failedCount,
      escrowVolume,
      releasedVolume,
      refundedVolume,
      errors,
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      windowCount('profiles', 'created_at'),
      activeUsers(),
      windowCount('bounties', 'created_at'),
      windowCount('bounty_requests', 'created_at'),
      windowCount('messages', 'created_at'),
      windowCount('conversations', 'created_at'),
      windowCount('wallet_transactions', 'created_at', (q) =>
        q.eq('type', 'escrow').eq('status', 'completed')
      ),
      windowCount('wallet_transactions', 'created_at', (q) => q.eq('status', 'failed')),
      windowSum('escrow'),
      windowSum('release'),
      windowSum('refund'),
      errorMetrics(),
    ]);

    // Acceptance and completion are dated by the request/bounty transition,
    // not by the bounty's creation date.
    const [accepted, completed] = await Promise.all([
      windowCount('bounty_requests', 'accepted_at', (q) => q.eq('status', 'accepted')),
      windowCount('bounties', 'completed_at', (q) => q.eq('status', 'completed')),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: totalUsersResult.count ?? 0,
        new: newUsers,
        active,
      },
      bounties: { created, accepted, completed, applications },
      money: { escrowCount, escrowVolume, releasedVolume, refundedVolume, failedCount },
      messaging: { messages, conversations },
      errors,
    };
  },
};
