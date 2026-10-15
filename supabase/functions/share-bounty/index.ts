// Supabase Edge Function: share-bounty
//
// Public, unauthenticated HTML page for a single bounty's share link
// (bountyfinder.app/bounty/:id — requires DNS/reverse-proxy in front of
// bountyfinder.app to route that path to this function; not yet wired up,
// see the sharing feature's follow-up notes). Serves Open Graph/Twitter
// Card metadata for link-unfurling bots (Slack, Discord, iMessage, X,
// Facebook, LinkedIn, ...) and a smart-redirect page for real visitors: try
// the app's custom-scheme deep link first, then fall back to the App/Play
// Store after a short timeout.
//
// Route shape: GET /share-bounty/:id
//   ?log=app_redirect|store_redirect  — beacon from the client-side redirect
//     script (see _shared/og-html.ts); logs to share_link_events and returns
//     204 without re-rendering the page.
//
// Manual test:
//   curl "https://<project>.supabase.co/functions/v1/share-bounty/<bounty-id>"
//   curl -A "Slackbot-LinkExpanding" "https://<project>.supabase.co/functions/v1/share-bounty/<bounty-id>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderOgPage } from '../_shared/og-html.ts';
import { logShareEvent } from '../_shared/share-log.ts';
import { redirectToSharePage } from '../_shared/share-page-storage.ts';

const SITE_ORIGIN = 'https://bountyfinder.app';
const IOS_STORE_URL = 'https://apps.apple.com/app/id6756679797';
const ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.bountyfinder.BOUNTYExpo';

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(req.url);
  // Path is /share-bounty/:id (function name segment stripped by the gateway
  // in some setups, present in others) — take the final non-empty segment.
  const segments = url.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  const logEvent = url.searchParams.get('log');

  if (!id || id === 'share-bounty' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return new Response('Missing or invalid bounty id', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[share-bounty] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return new Response('Server misconfiguration', { status: 500 });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Beacon from the client-side redirect script — log and bail out early,
  // no need to re-fetch the bounty or render a page.
  if (logEvent === 'app_redirect' || logEvent === 'store_redirect') {
    await logShareEvent(supabaseAdmin, {
      contentType: 'bounty',
      contentId: id,
      eventType: logEvent,
      req,
    });
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const canonicalUrl = `${SITE_ORIGIN}/bounty/${id}`;
  const appDeepLink = `bountyexpo-workspace://bounty/${id}`;
  const handoffUrl = `${supabaseUrl}/functions/v1/app-link/share/bounty?path=${encodeURIComponent(
    `bounty/${id}`
  )}&landing=${encodeURIComponent(canonicalUrl)}`;

  await logShareEvent(supabaseAdmin, {
    contentType: 'bounty',
    contentId: id,
    eventType: 'page_view',
    req,
  });

  // Bounty reads are authenticated-only. A service-role lookup here would
  // bypass that boundary and syndicate private free text/photos to crawlers.
  // Keep all public previews generic until a consented projection exists.
  const ogImageUrl = `${supabaseUrl}/functions/v1/share-og-image?type=bounty&id=_fallback`;

  const html = renderOgPage({
    title: 'Get help with Bounty',
    description: 'A task worth getting done. View this bounty in the app, or post a task of your own. Task details require sign-in and may no longer be available.',
    imageUrl: ogImageUrl,
    canonicalUrl,
    appDeepLink,
    handoffUrl,
    iosStoreUrl: IOS_STORE_URL || undefined,
    androidStoreUrl: ANDROID_STORE_URL,
    websiteUrl: 'https://bountyfinder.net',
  });

  return redirectToSharePage(supabaseAdmin, `bounty/${id}.html`, html, handoffUrl);
});
