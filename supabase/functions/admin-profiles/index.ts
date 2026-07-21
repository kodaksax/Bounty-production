// Supabase Edge Function: admin-profiles
//
// Service-role-backed read path for the admin panel's user list/detail
// screens. Closes the gap identified in
// docs/withdrawals/08-profiles-rls-migration-strategy.md: `adminDataClient.ts`
// previously queried `profiles` directly via the anon-key client
// (`select('*')`), which meant the admin panel's full-column access to every
// user's row depended entirely on the broad `profiles_select_authenticated
// USING (true)` RLS policy staying wide open. This function lets that policy
// (and the column grants it sits behind) be tightened later without breaking
// the admin panel, since admin access now goes through an explicit
// service-role path instead. Same auth pattern as admin-withdrawals /
// admin-review-id / admin-verifications-list (JWT `app_metadata.role` check).
//
// POST body: { action: 'list' | 'getById' | 'updateStatus', id?, status?, verificationStatus? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authenticate caller and verify admin role -- identical to admin-withdrawals.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
  }
  const token = authHeader.substring(7);
  const {
    data: { user: adminUser },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !adminUser) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }
  const roles = adminUser.app_metadata?.roles;
  const hasAdminRole = Array.isArray(roles)
    ? roles.includes('admin')
    : typeof roles === 'string'
      ? roles === 'admin'
      : false;
  const isAdmin = adminUser.app_metadata?.role === 'admin' || hasAdminRole;
  if (!isAdmin) {
    return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
  }

  let body: {
    action?: string;
    id?: string;
    status?: string;
    verificationStatus?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = body;

  // ─── list ───────────────────────────────────────────────────────────────
  // Mirrors the query previously built client-side in
  // adminDataClient.fetchAdminUsers() -- same filters, same ordering. Full
  // column access is fine here: this is service_role, gated by the admin
  // check above, not the client-facing RLS policy.
  if (action === 'list') {
    let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });

    // NOTE: was `.eq('status', ...)` -- profiles has never had a `status`
    // column (verified via information_schema), so selecting any status
    // filter chip in the admin panel silently errored out the whole list.
    // account_status is the real column, added alongside updateStatus below.
    if (body.status && body.status !== 'all') {
      query = query.eq('account_status', body.status);
    }
    if (body.verificationStatus && body.verificationStatus !== 'all') {
      query = query.eq('verification_status', body.verificationStatus);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[admin-profiles] list failed', { error });
      return jsonResponse({ error: 'Failed to fetch users' }, 500);
    }
    return jsonResponse({ users: data ?? [] });
  }

  // ─── getById ────────────────────────────────────────────────────────────
  if (action === 'getById') {
    const { id } = body;
    if (!id) {
      return jsonResponse({ error: 'id is required' }, 400);
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (error) {
      if (error.code === 'PGRST116') {
        return jsonResponse({ user: null });
      }
      console.error('[admin-profiles] getById failed', { id, error });
      return jsonResponse({ error: 'Failed to fetch user' }, 500);
    }
    return jsonResponse({ user: data });
  }

  // ─── updateStatus ───────────────────────────────────────────────────────
  // Admin suspend/ban/restore. Service-role write so it works regardless of
  // the caller's own RLS/column grants -- every UPDATE policy on profiles is
  // `auth.uid() = id`, which would otherwise reject an admin updating someone
  // else's row entirely, independent of whether the target column exists.
  //
  // Plumbing only: this records account_status but nothing else in the app
  // (RLS, login, bounty posting, withdrawals) reads it yet -- a suspended or
  // banned user can still fully use the app today. See
  // docs/withdrawals/09-security-audit-findings-2026-07-19.md finding #3.
  if (action === 'updateStatus') {
    const { id, status } = body;
    if (!id) {
      return jsonResponse({ error: 'id is required' }, 400);
    }
    if (status !== 'active' && status !== 'suspended' && status !== 'banned') {
      return jsonResponse({ error: "status must be one of 'active', 'suspended', 'banned'" }, 400);
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ account_status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, account_status')
      .single();

    if (error) {
      console.error('[admin-profiles] updateStatus failed', { id, status, error });
      return jsonResponse({ error: 'Failed to update user status' }, 500);
    }

    console.log('[admin-profiles] account status updated', { targetUserId: id, status, adminUserId: adminUser.id });
    return jsonResponse({ id: data.id, status: data.account_status });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
