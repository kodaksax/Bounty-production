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
    reason?: string;
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
  // Now fully enforced app-wide (RLS + SECURITY DEFINER RPCs + client-side
  // sign-in gate) -- see 20260726000000_enforce_account_status.sql -- and
  // every change is written to admin_action_log for audit purposes (a
  // `reason` is required for exactly that purpose).
  if (action === 'updateStatus') {
    const { id, status, reason } = body;
    if (!id) {
      return jsonResponse({ error: 'id is required' }, 400);
    }
    if (status !== 'active' && status !== 'suspended' && status !== 'banned') {
      return jsonResponse({ error: "status must be one of 'active', 'suspended', 'banned'" }, 400);
    }
    if (!reason || !reason.trim()) {
      return jsonResponse({ error: 'reason is required' }, 400);
    }

    const { data: existing, error: existingError } = await supabase
      .from('profiles')
      .select('account_status')
      .eq('id', id)
      .single();
    if (existingError) {
      console.error('[admin-profiles] updateStatus: failed to read current status', { id, error: existingError });
      return jsonResponse({ error: 'Failed to fetch user' }, 500);
    }
    const oldStatus = existing?.account_status ?? null;

    const { data, error } = await supabase
      .from('profiles')
      .update({ account_status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, account_status')
      .single();

    if (error) {
      console.error('[admin-profiles] updateStatus failed', { id, status, error });
      await supabase.from('admin_action_log').insert({
        admin_user_id: adminUser.id,
        action_type: 'account_status_change',
        target_user_id: id,
        reason: reason.trim(),
        result: 'failure',
        metadata: { old_status: oldStatus, new_status: status, error: error.message },
      });
      return jsonResponse({ error: 'Failed to update user status' }, 500);
    }

    const { error: logError } = await supabase.from('admin_action_log').insert({
      admin_user_id: adminUser.id,
      action_type: 'account_status_change',
      target_user_id: id,
      reason: reason.trim(),
      result: 'success',
      metadata: { old_status: oldStatus, new_status: status },
    });
    if (logError) {
      // Non-blocking: the status change already succeeded. Log loudly so
      // a missing audit row doesn't go unnoticed.
      console.error('[admin-profiles] updateStatus: audit log insert failed', { id, status, error: logError });
    }

    console.log('[admin-profiles] account status updated', { targetUserId: id, status, adminUserId: adminUser.id });
    return jsonResponse({ id: data.id, status: data.account_status });
  }

  // ─── listAccountStatusLog ───────────────────────────────────────────────
  // Real (non-mock) read path for the admin audit-log screen's 'user'
  // category -- see lib/services/audit-log-service.ts, which previously
  // returned 100% hardcoded mock rows for every category. This surfaces the
  // account_status_change rows written above.
  if (action === 'listAccountStatusLog') {
    const { data, error } = await supabase
      .from('admin_action_log')
      .select('id, admin_user_id, target_user_id, reason, result, metadata, created_at')
      .eq('action_type', 'account_status_change')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[admin-profiles] listAccountStatusLog failed', { error });
      return jsonResponse({ error: 'Failed to fetch account status log' }, 500);
    }
    return jsonResponse({ entries: data ?? [] });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
