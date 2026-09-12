// Supabase Edge Function: bounty-ranking
//
// Server-side counterpart of the `bounty-ranking-v2` PostHog experiment
// (flag `bounty-ranking-v2`, experiment id 463516). The feed itself
// (components/bounty-feed.tsx) still does its own Supabase queries and
// existing client-side filter/sort — that IS the `control` arm, unmodified.
// This function only ever does work for the `test` arm: it evaluates the
// PostHog flag for the caller server-side (so a user can never read or spoof
// their own assignment from the client bundle), then re-derives the ranking
// from the database's own values rather than trusting whatever the client
// sends, and returns the final section/order for the client to render as-is.
//
// POST body: { bountyIds: string[], appliedBountyIds?: string[] }
//   `bountyIds` is the candidate pool components/bounty-feed.tsx already
//   loaded (post category/online/distance filtering — this endpoint only
//   ever reorders/sections a set the caller already legitimately fetched
//   under normal RLS, it never discloses a bounty the client didn't already
//   have). `appliedBountyIds` are bounties this user has already applied to
//   (the client already tracks this set for its own existing filter).
//
// Response: { variant: 'control' } for the control arm / flag-off / any
// failure (fail open to today's behavior), or
// { variant: 'test', sections: { main, dormant, honor } } where each section
// is an array of { id, rank_score } in final ranked order.
//
// See lib/ranking/bounty-ranking-v2.ts for the scoring formula itself --
// imported directly (relative path) rather than duplicated here so the one
// Jest-tested implementation is the only implementation. It is plain,
// dependency-free TypeScript with no RN/Node-only APIs, so it runs unmodified
// under Deno.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { rankAndSectionPool, utcDateString, type PoolBounty } from '../../../lib/ranking/bounty-ranking-v2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const FLAG_KEY = 'bounty-ranking-v2';
// Bounded well above realistic feed page sizes; guards against an
// unbounded body on a long infinite-scroll session driving an unbounded
// `.in()` query.
const MAX_CANDIDATE_IDS = 200;

type Variant = 'control' | 'test';

async function resolveVariant(distinctId: string): Promise<Variant> {
  const posthogKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!posthogKey) return 'control';
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  try {
    const resp = await fetch(`${host}/decide/?v=3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ api_key: posthogKey, distinct_id: distinctId }),
    });
    if (!resp.ok) return 'control';
    const data = (await resp.json()) as { featureFlags?: Record<string, string | boolean> };
    return data.featureFlags?.[FLAG_KEY] === 'test' ? 'test' : 'control';
  } catch (error) {
    // PostHog unreachable/slow — fail open to control, same as every other
    // flag-read in this app (see lib/experiments/deferred-funding-variant.ts).
    console.error('[bounty-ranking] flag resolution failed, defaulting to control', error);
    return 'control';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[bounty-ranking] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ variant: 'control' }, 200);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
  }
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.substring(7));
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }
  const userId = user.id;

  let body: { bountyIds?: unknown; appliedBountyIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const bountyIds = Array.isArray(body.bountyIds)
    ? body.bountyIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_CANDIDATE_IDS)
    : [];
  const appliedBountyIds = new Set(
    Array.isArray(body.appliedBountyIds)
      ? body.appliedBountyIds.filter((id): id is string => typeof id === 'string')
      : []
  );

  if (bountyIds.length === 0) {
    return jsonResponse({ variant: 'control' }, 200);
  }

  const variant = await resolveVariant(userId);
  if (variant !== 'test') {
    return jsonResponse({ variant: 'control' }, 200);
  }

  try {
    // Re-derive everything from the database rather than trusting the
    // client-supplied amount/category/age: the ids are a legitimate set the
    // caller already fetched under RLS, but the *values* used for scoring
    // must not be forgeable by whoever calls this endpoint.
    const { data: bountyRows, error: bountiesError } = await supabase
      .from('bounties')
      .select('id, amount, is_for_honor, created_at, category, poster_id, user_id, status')
      .in('id', bountyIds)
      .eq('status', 'open');
    if (bountiesError) throw bountiesError;

    const eligible = (bountyRows ?? []).filter(row => {
      const posterId = row.poster_id ?? row.user_id;
      if (posterId && String(posterId) === String(userId)) return false; // hard rule #1
      if (appliedBountyIds.has(String(row.id))) return false; // hard rule #2
      return true;
    });

    if (eligible.length === 0) {
      return jsonResponse({ variant: 'test', sections: { main: [], dormant: [], honor: [] } }, 200);
    }

    const eligibleIds = eligible.map(row => String(row.id));
    const { data: applicationRows, error: applicationsError } = await supabase
      .from('bounty_requests')
      .select('bounty_id')
      .in('bounty_id', eligibleIds);
    if (applicationsError) throw applicationsError;

    const applicationCounts = new Map<string, number>();
    for (const row of applicationRows ?? []) {
      const key = String((row as { bounty_id: string }).bounty_id);
      applicationCounts.set(key, (applicationCounts.get(key) ?? 0) + 1);
    }

    const now = Date.now();
    const pool: PoolBounty[] = eligible.map(row => ({
      id: String(row.id),
      amount: typeof row.amount === 'number' ? row.amount : null,
      is_for_honor: Boolean(row.is_for_honor),
      seconds_since_posted: row.created_at
        ? Math.max(0, Math.round((now - new Date(row.created_at).getTime()) / 1000))
        : null,
      category: row.category ?? null,
      application_count: applicationCounts.get(String(row.id)) ?? 0,
    }));

    const sections = rankAndSectionPool(pool, { userId, dateString: utcDateString() });
    return jsonResponse({ variant: 'test', sections }, 200);
  } catch (error) {
    console.error('[bounty-ranking] scoring failed, falling back to control', error);
    return jsonResponse({ variant: 'control' }, 200);
  }
});
