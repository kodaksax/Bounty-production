// eslint-disable-next-line import/no-unresolved
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  asUuid,
  type ClickCandidate,
  cleanDistinctId,
  cleanText,
  clientIp,
  type DeviceOs,
  FINGERPRINT_WINDOW_HOURS,
  fingerprintDays,
  ipHashInput,
  parseInstallReferrer,
  resolveInstallMatch,
  REPORTABLE_CONFIDENCE,
  type Utm,
} from '../_shared/install-attribution.ts';

// Claims the click (if any) that produced this user's install, once, and writes
// public.marketing_attribution through fn_claim_install_attribution.
//
//   POST { action: 'probe', platform: 'ios' }            anonymous
//     -> { candidate: boolean }   is there an unclaimed iPhone click from this
//        IP in the last day? The app reads the clipboard handoff only if so,
//        so organic installs never see iOS's paste prompt.
//
//   POST (Authorization: Bearer <user jwt>)
//     { platform: 'android', install_referrer?, deferred_deep_link? }
//     { platform: 'ios', click_id?, deferred_deep_link? }
//     { platform: 'web', click_id?, web_distinct_id?, first_touch? }
//     -> { status, match_method, match_confidence, reportable, ... }
//
// Every first session writes a row, `unattributed` included, so coverage is
// measurable from the table alone. See docs/MARKETING_ATTRIBUTION.md.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function ipHashes(request: Request, now: Date): Promise<string[]> {
  const ip = clientIp(request.headers.get('x-forwarded-for'));
  const salt = Deno.env.get('ATTRIBUTION_IP_SALT');
  if (!ip || !salt) return Promise.resolve([]);
  return Promise.all(fingerprintDays(now).map(day => sha256Hex(ipHashInput(ip, salt, day))));
}

async function fingerprintCandidates(
  admin: Admin,
  hashes: string[],
  os: DeviceOs,
  now: Date
): Promise<ClickCandidate[]> {
  if (hashes.length === 0 || os === 'web') return [];
  const since = new Date(now.getTime() - FINGERPRINT_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await admin
    .from('marketing_clicks')
    .select('click_id, clicked_at')
    .in('ip_hash', hashes)
    .eq('device_type', os)
    .is('matched_user_id', null)
    .gte('clicked_at', since)
    .order('clicked_at', { ascending: false })
    .limit(5);
  if (error) {
    console.error('[marketing-attribute] fingerprint lookup failed', error.message);
    return [];
  }
  return (data ?? []) as ClickCandidate[];
}

async function clickExists(admin: Admin, clickId: string | null): Promise<boolean> {
  if (!clickId) return false;
  const { data } = await admin
    .from('marketing_clicks')
    .select('click_id')
    .eq('click_id', clickId)
    .maybeSingle();
  return Boolean(data);
}

function parseBranch(value: unknown): { utm: Utm; guaranteed: boolean; clickId: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const clickId = asUuid(input.click_id);
  const utm: Utm = {
    source: cleanText(input.initial_utm_source ?? input.utm_source),
    medium: cleanText(input.initial_utm_medium ?? input.utm_medium),
    campaign: cleanText(input.initial_utm_campaign ?? input.utm_campaign),
  };
  if (!utm.source && !utm.campaign && !clickId) return null;
  return { utm, guaranteed: input.match_guaranteed === true, clickId };
}

function parseFirstTouch(value: unknown): Utm | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const utm: Utm = {
    source: cleanText(input.utm_source),
    medium: cleanText(input.utm_medium),
    campaign: cleanText(input.utm_campaign),
    content: cleanText(input.utm_content),
    term: cleanText(input.utm_term),
  };
  // The browser always knows its own first touch, "direct" included.
  return utm;
}

/**
 * Merges the website visitor into the signed-up user. Only ever called on a
 * deterministic match: a PostHog merge cannot be undone, so an inference is
 * never allowed to join two people.
 */
async function mergeWebPerson(userId: string, webDistinctId: string): Promise<boolean> {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!apiKey) return false;
  if (webDistinctId === userId) return true;
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  try {
    const response = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        api_key: apiKey,
        event: '$identify',
        distinct_id: userId,
        properties: { $anon_distinct_id: webDistinctId },
      }),
    });
    if (!response.ok) console.error('[marketing-attribute] PostHog merge failed', response.status);
    return response.ok;
  } catch (error) {
    console.error('[marketing-attribute] PostHog merge failed', error);
    return false;
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Not configured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const os: DeviceOs | null =
    body.platform === 'ios' || body.platform === 'android' || body.platform === 'web'
      ? body.platform
      : null;
  if (!os) return jsonResponse({ error: 'Invalid platform' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();

  if (body.action === 'probe') {
    // Pre-signup, so anonymous. Answers one bit and claims nothing.
    if (os !== 'ios') return jsonResponse({ candidate: false });
    const candidates = await fingerprintCandidates(admin, await ipHashes(request, now), os, now);
    return jsonResponse({ candidate: candidates.length > 0 });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse({ error: 'Unauthorized' }, 401);
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const referrer = os === 'android' ? parseInstallReferrer(body.install_referrer) : null;
  const handoffClickId = asUuid(body.click_id);
  const branch = parseBranch(body.deferred_deep_link);
  const [referrerClickExists, handoffClickExists, branchClickExists] = await Promise.all([
    clickExists(admin, referrer?.clickId ?? null),
    clickExists(admin, handoffClickId),
    clickExists(admin, branch?.clickId ?? null),
  ]);
  const validatedBranch = branch
    ? { ...branch, clickId: branchClickExists ? branch.clickId : null }
    : null;
  const webUtm = os === 'web' ? parseFirstTouch(body.first_touch) : null;

  const needsInference =
    !(os === 'android' && referrer) &&
    !(handoffClickId && handoffClickExists) &&
    !webUtm &&
    !validatedBranch;
  const candidates = needsInference
    ? await fingerprintCandidates(admin, await ipHashes(request, now), os, now)
    : [];

  const match = resolveInstallMatch({
    os,
    referrer,
    handoffClickId,
    handoffClickExists,
    referrerClickExists,
    webUtm,
    branch: validatedBranch,
    fingerprintCandidates: candidates,
    now,
  });
  const webDistinctId = os === 'web' ? cleanDistinctId(body.web_distinct_id) : undefined;

  const { data, error } = await admin.rpc('fn_claim_install_attribution', {
    p_user_id: user.id,
    p_device_os: os,
    p_match_method: match.method,
    p_match_confidence: match.confidence,
    p_click_id: match.clickId,
    p_utm: match.utm,
    p_web_distinct_id: webDistinctId ?? null,
  });
  if (error || !data) {
    console.error('[marketing-attribute] failed to claim attribution', {
      userId: user.id,
      method: match.method,
      message: error?.message,
    });
    return jsonResponse({ error: 'Failed to persist attribution' }, 500);
  }

  const row = data as Record<string, unknown> & { already_attributed?: boolean };
  const confidence = Number(row.match_confidence ?? 0);
  const method = String(row.match_method ?? 'unattributed');
  const reportable = row.attribution_reportable === true;

  // Retry an unconfirmed identity merge when a previous claim committed but
  // PostHog was unavailable.
  const mergeId = typeof row.web_distinct_id === 'string' ? row.web_distinct_id : null;
  const mergeWeb = Boolean(mergeId && confidence >= REPORTABLE_CONFIDENCE);
  if (mergeWeb && mergeId && !(await mergeWebPerson(user.id, mergeId))) {
    return jsonResponse({ error: 'Web identity merge is pending', retryable: true }, 503);
  }

  console.log(
    JSON.stringify({
      evt: 'install_attribution',
      status: row.already_attributed ? 'already_attributed' : 'attributed',
      os,
      method,
      confidence,
      has_click: Boolean(row.first_click_id),
      merged_web_person: mergeWeb,
    })
  );

  const utmSource = (row.first_utm_source as string | null) ?? null;
  const utmCampaign = (row.first_utm_campaign as string | null) ?? null;
  return jsonResponse({
    status: row.already_attributed
      ? 'already_attributed'
      : method === 'unattributed'
        ? 'unattributed'
        : 'attributed',
    platform: os,
    match_method: method,
    match_confidence: confidence,
    reportable,
    click_id: (row.first_click_id as string | null) ?? null,
    campaign_id: (row.first_campaign_id as string | null) ?? utmCampaign,
    creative_id: (row.first_creative_id as string | null) ?? null,
    utm_source: utmSource,
    initial_utm_source: utmSource,
    initial_utm_medium: (row.first_utm_medium as string | null) ?? null,
    initial_utm_campaign: utmCampaign,
    install_source: utmSource,
    install_campaign: utmCampaign,
  });
});
