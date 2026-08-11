const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type AuthenticatedUser = { id: string };

type AuthResult = {
  data: { user: AuthenticatedUser | null };
  error?: { message?: string } | null;
};

type QueryResult<T> = Promise<{ data?: T | null; error?: any | null }>;

export interface NotificationEdgeAdminClient {
  auth: {
    getUser(token: string): Promise<AuthResult>;
  };
  from(table: string): {
    select(columns: string): {
      limit(count: number): QueryResult<unknown>;
      eq(
        column: string,
        value: unknown
      ): {
        maybeSingle(): QueryResult<any>;
      };
    };
    upsert(
      values: Record<string, unknown>,
      options?: { onConflict?: string }
    ): QueryResult<unknown>;
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: unknown
      ): {
        eq(
          column: string,
          value: unknown
        ): {
          neq(column: string, value: unknown): QueryResult<unknown>;
        };
      };
    };
    delete(): {
      eq(
        column: string,
        value: unknown
      ): {
        eq(column: string, value: unknown): QueryResult<unknown>;
      };
    };
  };
}

export interface NotificationHandlerDeps {
  createAdminClient: () => NotificationEdgeAdminClient;
}

type PushTokenOwnerColumn = 'profile_id' | 'user_id';

type PushTokenRow = {
  id?: string;
  token?: string;
  device_id?: string | null;
  enabled?: boolean;
};

function isMissingColumnError(error: any, column: string): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '').toLowerCase();
  const target = column.toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (message.includes('column') && message.includes(target) && message.includes('does not exist'))
  );
}

function parseSubPath(requestUrl: string): string {
  const url = new URL(requestUrl);
  const fnIdx = url.pathname.lastIndexOf('/notifications');
  return fnIdx === -1 ? '/' : url.pathname.slice(fnIdx + '/notifications'.length) || '/';
}

async function resolvePushTokenOwnerColumn(
  supabaseAdmin: NotificationEdgeAdminClient
): Promise<PushTokenOwnerColumn> {
  const attempts: PushTokenOwnerColumn[] = ['profile_id', 'user_id'];
  let lastError: any = null;
  for (const column of attempts) {
    const { error } = await supabaseAdmin.from('push_tokens').select(column).limit(1);
    if (!error) return column;
    if (!isMissingColumnError(error, column)) throw error;
    lastError = error;
  }
  throw lastError || new Error('Unable to determine push_tokens owner column');
}

async function ensureUserProfile(
  supabaseAdmin: NotificationEdgeAdminClient,
  userId: string
): Promise<boolean> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing?.id) return true;

  const username = `user_${userId.replace(/-/g, '')}`;
  const candidateRows = [
    { id: userId, username },
    { id: userId, handle: username },
    { id: userId },
  ];

  for (const row of candidateRows) {
    const { error } = await supabaseAdmin.from('profiles').upsert(row, { onConflict: 'id' });
    if (!error) return true;
    if (String(error?.code ?? '') === '23505') return true;
    if (isMissingColumnError(error, 'username') || isMissingColumnError(error, 'handle')) {
      continue;
    }
  }

  return false;
}

async function loadExistingTokenRow(
  supabaseAdmin: NotificationEdgeAdminClient,
  token: string
): Promise<PushTokenRow | null> {
  const fullResult = await supabaseAdmin
    .from('push_tokens')
    .select('id, token, device_id, enabled')
    .eq('token', token)
    .maybeSingle();

  if (!fullResult.error) {
    return (fullResult.data as PushTokenRow | null) ?? null;
  }

  if (!isMissingColumnError(fullResult.error, 'enabled')) {
    throw fullResult.error;
  }

  const fallbackResult = await supabaseAdmin
    .from('push_tokens')
    .select('id, token, device_id')
    .eq('token', token)
    .maybeSingle();

  if (fallbackResult.error) throw fallbackResult.error;
  return (fallbackResult.data as PushTokenRow | null) ?? null;
}

export async function registerPushToken(
  supabaseAdmin: NotificationEdgeAdminClient,
  userId: string,
  token: string,
  deviceId?: string
): Promise<{ existed: boolean; reenabled: boolean }> {
  const ownerColumn = await resolvePushTokenOwnerColumn(supabaseAdmin);
  const profileReady = await ensureUserProfile(supabaseAdmin, userId);
  if (!profileReady) {
    throw new Error(`Unable to ensure profile exists for ${userId}`);
  }

  const existing = await loadExistingTokenRow(supabaseAdmin, token);

  if (deviceId) {
    const { error: disableError } = await supabaseAdmin
      .from('push_tokens')
      .update({ enabled: false })
      .eq(ownerColumn, userId)
      .eq('device_id', deviceId)
      .neq('token', token);
    if (disableError && !isMissingColumnError(disableError, 'enabled')) {
      throw disableError;
    }
  }

  const payload: Record<string, unknown> = {
    [ownerColumn]: userId,
    token,
    enabled: true,
  };

  const persistedDeviceId = deviceId ?? existing?.device_id ?? null;
  if (persistedDeviceId !== null) {
    payload.device_id = persistedDeviceId;
  }

  let { error: upsertError } = await supabaseAdmin
    .from('push_tokens')
    .upsert(payload, { onConflict: 'token' });

  if (isMissingColumnError(upsertError, 'enabled')) {
    const payloadWithoutEnabled = { ...payload };
    delete payloadWithoutEnabled.enabled;
    ({ error: upsertError } = await supabaseAdmin
      .from('push_tokens')
      .upsert(payloadWithoutEnabled, { onConflict: 'token' }));
  }

  if (upsertError) throw upsertError;

  return {
    existed: Boolean(existing?.id),
    reenabled: existing?.enabled === false,
  };
}

export async function deletePushToken(
  supabaseAdmin: NotificationEdgeAdminClient,
  userId: string,
  token: string
): Promise<void> {
  const ownerColumn = await resolvePushTokenOwnerColumn(supabaseAdmin);
  const { error } = await supabaseAdmin
    .from('push_tokens')
    .delete()
    .eq(ownerColumn, userId)
    .eq('token', token);
  if (error) throw error;
}

export function createNotificationsHandler({ createAdminClient }: NotificationHandlerDeps) {
  return async function notificationsHandler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    const subPath = parseSubPath(req.url);
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401);
    }

    const supabaseAdmin = createAdminClient();
    const token = authHeader.slice(7);
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user?.id) {
      return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401);
    }

    let body: any = {};
    if (req.method !== 'OPTIONS') {
      body = await req.json().catch(() => ({}));
      if (body == null || typeof body !== 'object' || Array.isArray(body)) body = {};
    }

    if (req.method === 'POST' && subPath === '/register-token') {
      const pushToken = typeof body.token === 'string' ? body.token.trim() : '';
      const deviceId =
        typeof body.deviceId === 'string' && body.deviceId.trim()
          ? body.deviceId.trim()
          : undefined;

      if (!pushToken) {
        return jsonResponse({ error: 'token is required and must be a string' }, 400);
      }
      if (!EXPO_PUSH_TOKEN_PATTERN.test(pushToken)) {
        return jsonResponse(
          { error: 'Invalid token format', details: 'Token must be a valid Expo push token' },
          400
        );
      }

      try {
        const result = await registerPushToken(supabaseAdmin, user.id, pushToken, deviceId);
        return jsonResponse({ success: true, ...result });
      } catch (error) {
        console.error('[notifications] register-token failed:', error);
        return jsonResponse({ error: 'Failed to register push token' }, 500);
      }
    }

    if (req.method === 'DELETE' && subPath === '/token') {
      const pushToken = typeof body.token === 'string' ? body.token.trim() : '';
      if (!pushToken) {
        return jsonResponse({ error: 'token is required and must be a string' }, 400);
      }

      try {
        await deletePushToken(supabaseAdmin, user.id, pushToken);
        return jsonResponse({ success: true });
      } catch (error) {
        console.error('[notifications] delete token failed:', error);
        return jsonResponse({ error: 'Failed to delete push token' }, 500);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  };
}
