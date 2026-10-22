// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  asUuid,
  cleanDistinctId,
  cleanText,
  clientIp,
  deviceFromUserAgent,
  ipHashInput,
} from '../_shared/install-attribution.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
};

function slug(value: string | undefined, fallback: string): string {
  const normalized = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 100) || fallback;
}

const APP_STORE_URL = 'https://apps.apple.com/app/id6756679797';
const PLAY_STORE_PACKAGE = 'app.bountyfinder.BOUNTYExpo';

interface ClickUtm {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

// Used when Branch is not configured or link creation fails. Never redirects to
// the caller-supplied `landing` param, so this cannot become an open redirect.
function storeFallbackUrl(
  userAgent: string,
  origin: string,
  utm: ClickUtm,
  clickId: string
): string {
  if (/iphone|ipad|ipod/i.test(userAgent)) return APP_STORE_URL;
  if (/android/i.test(userAgent)) {
    // Google hands this string back verbatim to the installed app (Play
    // Install Referrer), click_id included: the deterministic Android join.
    const referrer = new URLSearchParams({
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      ...(utm.content ? { utm_content: utm.content } : {}),
      ...(utm.term ? { utm_term: utm.term } : {}),
      click_id: clickId,
    }).toString();
    return `https://play.google.com/store/apps/details?${new URLSearchParams({
      id: PLAY_STORE_PACKAGE,
      referrer,
    })}`;
  }
  return origin;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * One marketing_clicks row per redirect: the row marketing-attribute later
 * claims by click_id. Failure never blocks the redirect; the visitor still
 * reaches the store, only the join is lost.
 */
async function recordClick(
  request: Request,
  row: {
    clickId: string;
    utm: ClickUtm;
    platform: string;
    referrer?: string;
    landingPage: string;
    destination: string;
    posthogDistinctId?: string;
  }
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;

  const userAgent = request.headers.get('user-agent') ?? '';
  const device = deviceFromUserAgent(userAgent);
  const ip = clientIp(request.headers.get('x-forwarded-for'));
  const salt = Deno.env.get('ATTRIBUTION_IP_SALT');
  const ipHash =
    ip && salt ? await sha256Hex(ipHashInput(ip, salt, new Date().toISOString().slice(0, 10))) : null;

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.from('marketing_clicks').insert({
      click_id: row.clickId,
      utm_source: row.utm.source,
      utm_medium: row.utm.medium,
      utm_campaign: row.utm.campaign,
      utm_content: row.utm.content ?? null,
      utm_term: row.utm.term ?? null,
      platform: row.platform,
      referrer: row.referrer ?? null,
      landing_page: row.landingPage,
      destination: row.destination.slice(0, 1000),
      user_agent: userAgent.slice(0, 500),
      ip_hash: ipHash,
      device_type: device,
      os: device === 'ios' ? 'iOS' : device === 'android' ? 'Android' : device,
      country: request.headers.get('cf-ipcountry'),
      posthog_distinct_id: row.posthogDistinctId ?? null,
    }).abortSignal(AbortSignal.timeout(3000));
    // 23505: the same click id re-sent (a double tap). The first row stands.
    if (error && error.code !== '23505') {
      console.error('[app-link] click log failed', error.message);
    }
  } catch (error) {
    console.error('[app-link] click log failed', error);
  }
}

async function captureRedirect(
  distinctId: string,
  properties: Record<string, unknown>
): Promise<void> {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!apiKey) return;
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        api_key: apiKey,
        event: 'app_store_redirect_clicked',
        properties: {
          // The website passes its visitor's id, so this server event lands
          // on the same person as their $pageview. Other callers (share
          // links, guerilla posts) have none and stay anonymous.
          distinct_id: distinctId,
          ...properties,
        },
      }),
    });
  } catch (error) {
    console.error('[app-link] PostHog capture failed', error);
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams;
  const segments = requestUrl.pathname.split('/').filter(Boolean);
  const functionIndex = segments.lastIndexOf('app-link');
  const source = slug(segments[functionIndex + 1], 'direct');
  const campaign = slug(segments[functionIndex + 2], 'general');
  const medium = slug(query.get('medium') ?? undefined, source === 'share' ? 'organic' : 'guerilla');
  const deepLinkPath = query.get('path')?.replace(/^\/+/, '').slice(0, 500);
  const configuredOrigin = Deno.env.get('PUBLIC_MARKETING_ORIGIN') ?? 'https://bountyfinder.net';
  const landingPage = query.get('landing')?.slice(0, 1000) ?? `${configuredOrigin}/r/${source}/${campaign}`;
  const referrer = request.headers.get('referer')?.slice(0, 1000);
  const userAgent = request.headers.get('user-agent') ?? '';

  // The website sends the visitor's own first-touch UTMs (the traffic source
  // that actually brought them) on top of its /website/<cta> path. Path-only
  // callers keep the path values.
  const utm: ClickUtm = {
    source: cleanText(query.get('utm_source'), 100) ?? source,
    medium: cleanText(query.get('utm_medium'), 100) ?? medium,
    campaign: cleanText(query.get('utm_campaign'), 100) ?? campaign,
    content: cleanText(query.get('utm_content'), 100) ?? (source === 'website' ? campaign : undefined),
    term: cleanText(query.get('utm_term'), 100),
  };
  // `cid` is minted by the website at tap time, so the same id can also be
  // handed to the app on iOS (clipboard). Anyone else gets a fresh one.
  const clickId = asUuid(query.get('cid')) ?? crypto.randomUUID();
  const posthogDistinctId = cleanDistinctId(query.get('ph'));

  const fallbackUrl = storeFallbackUrl(userAgent, configuredOrigin, utm, clickId);
  const branchKey = Deno.env.get('BRANCH_KEY');

  let url: string | undefined;
  if (branchKey) {
    try {
      const branchResponse = await fetch('https://api2.branch.io/v1/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          branch_key: branchKey,
          channel: utm.source,
          feature: utm.medium,
          campaign: utm.campaign,
          data: {
            ...(deepLinkPath ? { $deeplink_path: deepLinkPath } : {}),
            $canonical_url: landingPage,
            utm_source: utm.source,
            utm_medium: utm.medium,
            utm_campaign: utm.campaign,
            initial_referrer: referrer,
            initial_landing_page: landingPage,
            install_source: utm.source,
            install_campaign: utm.campaign,
            click_id: clickId,
          },
        }),
      });
      if (!branchResponse.ok) {
        console.error('[app-link] Branch link creation failed', branchResponse.status);
      } else {
        ({ url } = (await branchResponse.json()) as { url?: string });
      }
    } catch (error) {
      console.error('[app-link] Branch link creation failed', error);
    }
  }
  const destination = url ?? fallbackUrl;

  // Phones only: a desktop click goes back to the marketing site and cannot
  // install anything, so it is not an install click.
  const device = deviceFromUserAgent(userAgent);
  await Promise.all([
    device === 'ios' || device === 'android'
      ? recordClick(request, {
          clickId,
          utm,
          platform: source,
          referrer,
          landingPage,
          destination,
          posthogDistinctId,
        })
      : Promise.resolve(),
    captureRedirect(posthogDistinctId ?? crypto.randomUUID(), {
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      utm_content: utm.content,
      // The link itself (/r/<channel>/<cta>), kept apart from the visitor's
      // own UTMs above: website clicks used to report utm_source=website.
      channel: source,
      cta: campaign,
      initial_referrer: referrer,
      initial_landing_page: landingPage,
      link_provider: url ? 'branch' : 'store_fallback',
      click_id: clickId,
      device,
    }),
  ]);

  return Response.redirect(destination, 302);
});
