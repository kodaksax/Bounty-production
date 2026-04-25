// Supabase Edge Function: auth
// Handles auth management routes previously served by the Node/Express server.
// Routes:
//   POST /auth/register  — public, creates a new user account
//   DELETE /auth/delete-account

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Derive the sub-path after the function name (/auth) regardless of whether
  // Supabase prefixes the pathname with /functions/v1 or not.
  // e.g. "/functions/v1/auth/register" → "/register"
  //      "/auth/register"               → "/register"
  const authIdx = url.pathname.lastIndexOf('/auth');
  const subPath = authIdx !== -1 ? url.pathname.slice(authIdx + 5) || '/' : '/';

  console.log('[auth] incoming', { method: req.method, pathname: url.pathname, subPath });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[auth] Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ──────────────────────────────────────────
  // POST /auth/register — public (no auth required)
  // ──────────────────────────────────────────
  if (req.method === 'POST' && subPath === '/register') {
    try {
      // req.json() may resolve to null/undefined (not reject) when the body
      // is empty or the JSON literal is "null". Guard against any non-object
      // return value so destructuring can never throw at this step.
      const rawBody = await req.json().catch(() => null);
      const body = (
        rawBody !== null && rawBody !== undefined && typeof rawBody === 'object' ? rawBody : {}
      ) as { email?: string; username?: string; password?: string };
      const { email, username: rawUsername, password } = body;

      if (!email || !password) {
        return jsonResponse({ error: 'email and password are required' }, 400);
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
      if (!emailRegex.test(email)) return jsonResponse({ error: 'Invalid email' }, 400);
      if (password.length < 6) return jsonResponse({ error: 'Password too short (min 6)' }, 400);

      const normalizedEmail = email.trim().toLowerCase();

      // Check for existing email
      const { data: existingEmail, error: emailCheckError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', normalizedEmail)
        .maybeSingle();
      if (emailCheckError) {
        console.error(
          '[auth/register] email lookup error:',
          emailCheckError.message,
          emailCheckError.code
        );
        return jsonResponse({ error: 'Unable to complete registration. Please try again.' }, 500);
      }
      if (existingEmail) return jsonResponse({ error: 'Email already registered' }, 409);

      // Validate or auto-generate username.
      // The onboarding flow lets users choose their real username; the value set
      // here is a temporary placeholder used only until onboarding completes.
      const providedUsername = typeof rawUsername === 'string' ? rawUsername.trim() : '';
      const hasProvidedUsername = providedUsername.length > 0;

      // Reject an explicitly-supplied username that doesn't meet format requirements.
      if (hasProvidedUsername && !/^[a-zA-Z0-9_]{3,24}$/.test(providedUsername)) {
        return jsonResponse({ error: 'Invalid username format' }, 400);
      }

      // Resolve a unique username: explicit (checked once) or auto-generated (up to 5 attempts).
      const MAX_ATTEMPTS = 5;
      let normalizedUsername = hasProvidedUsername ? providedUsername : '';
      let usernameIsUnique = false;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (!hasProvidedUsername) {
          // Auto-generate: base (≤14 chars) + '_' + crypto random suffix (≤7 chars) ≤ 22 chars total.
          const emailLocal = normalizedEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 14);
          const randomArr = new Uint32Array(1);
          crypto.getRandomValues(randomArr);
          const randomPart = randomArr[0].toString(36);
          normalizedUsername = `${emailLocal}_${randomPart}`.slice(0, 24);
        }

        const { data: existingUser, error: usernameCheckError } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', normalizedUsername)
          .maybeSingle();

        if (usernameCheckError) {
          console.error(
            '[auth/register] username lookup error:',
            usernameCheckError.message,
            usernameCheckError.code
          );
          return jsonResponse({ error: 'Unable to complete registration. Please try again.' }, 500);
        }

        if (!existingUser) {
          usernameIsUnique = true;
          break;
        }

        // Explicit username: conflict — no retries.
        if (hasProvidedUsername) {
          return jsonResponse({ error: 'Username already taken' }, 409);
        }
      }

      if (!usernameIsUnique) {
        console.error('[auth/register] failed to find unique username after', MAX_ATTEMPTS, 'attempts');
        return jsonResponse({ error: 'Unable to complete registration. Please try again.' }, 500);
      }

      console.log('[auth/register] creating auth user', {
        email: normalizedEmail,
        username: normalizedUsername,
      });
      const { data, error } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { username: normalizedUsername },
      });

      if (error) {
        console.error('[auth/register] supabase createUser error', {
          message: error.message,
          status: error.status,
          code: (error as any).code,
        });
        const msg = error.message?.toLowerCase() ?? '';
        if (msg.includes('already registered') || msg.includes('already exists')) {
          return jsonResponse({ error: 'Email already registered' }, 409);
        }
        return jsonResponse({ error: error.message || 'Failed to create account' }, 400);
      }

      if (!data?.user?.id) {
        console.error(
          '[auth/register] no user id returned from supabase — data:',
          JSON.stringify(data)
        );
        return jsonResponse({ error: 'User creation failed' }, 500);
      }

      const userId = data.user.id;
      console.log('[auth/register] auth user created, upserting profile', { userId });
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: userId,
            username: normalizedUsername,
            email: normalizedEmail,
            balance: 0,
            onboarding_completed: false,
          },
          { onConflict: 'id' }
        );

      if (profileError) {
        console.error('[auth/register] profile upsert error — rolling back auth user:', {
          message: profileError.message,
          code: profileError.code,
          details: profileError.details,
          hint: profileError.hint,
          userId,
        });
        // Clean up the partially-created auth user to avoid inconsistent state
        await supabase.auth.admin.deleteUser(userId).catch((e: unknown) => {
          console.error('[auth/register] failed to rollback auth user:', (e as Error).message);
        });
        return jsonResponse({ error: 'Failed to create user profile. Please try again.' }, 500);
      }

      console.log('[auth/register] success', { userId });
      return jsonResponse(
        { success: true, userId, email: normalizedEmail, username: normalizedUsername },
        201
      );
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[auth/register] unexpected error:', err.message ?? e);
      const verbose = Deno.env.get('VERBOSE_ERRORS') === '1';
      return jsonResponse(
        {
          error: 'Registration failed. Please try again or contact support.',
          ...(verbose ? { details: String(err.message ?? e) } : {}),
        },
        500
      );
    }
  }

  // ──────────────────────────────────────────
  // DELETE /auth/delete-account — requires auth
  // ──────────────────────────────────────────
  if (req.method === 'DELETE' && subPath === '/delete-account') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
    }
    const token = authHeader.substring(7);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }
    const userId = user.id;

    console.log(`[auth] Received deletion request for user ${userId}`);

    try {
      // Step 1: Nullify conversations.created_by to avoid FK restriction
      try {
        const { error: convErr } = await supabase
          .from('conversations')
          .update({ created_by: null })
          .eq('created_by', userId);
        if (convErr) {
          console.warn('[auth] conversations pre-cleanup error (continuing):', convErr.message);
        }
      } catch (e: unknown) {
        console.warn('[auth] conversations pre-cleanup threw (continuing):', (e as Error).message);
      }

      // Step 2: Delete auth user via admin API
      let adminDeleted = false;
      try {
        const { error: adminError } = await supabase.auth.admin.deleteUser(userId);
        if (adminError) {
          console.warn('[auth] admin.deleteUser failed, will fallback:', adminError.message);
        } else {
          adminDeleted = true;
        }
      } catch (e: unknown) {
        console.warn('[auth] admin.deleteUser threw, will fallback:', (e as Error).message);
      }

      // Step 3: Fallback manual profile deletion if admin delete failed
      if (!adminDeleted) {
        const { error: profileErr } = await supabase.from('profiles').delete().eq('id', userId);
        if (profileErr) {
          console.error('[auth] Manual profile deletion failed:', profileErr.message);
          return jsonResponse(
            { success: false, message: `Failed to delete account: ${profileErr.message}` },
            500
          );
        }
      }

      console.log(`[auth] Deletion flow complete for user ${userId}`);
      return jsonResponse({ success: true, message: 'Account deletion completed successfully.' });
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('[auth] Unexpected error:', err);
      return jsonResponse(
        { success: false, message: err.message ?? 'Unexpected error deleting account.' },
        500
      );
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
});
