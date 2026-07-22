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
import { notFoundOgPage, renderOgPage } from '../_shared/og-html.ts';
import { redirectToSharePage } from '../_shared/share-page-storage.ts';
import { logShareEvent } from '../_shared/share-log.ts';

const SITE_ORIGIN = 'https://bountyfinder.app';
// TODO: fill in once the app is listed on the App Store (numeric app id).
const IOS_STORE_URL = '';
const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=app.bountyfinder.BOUNTYExpo';

const DESCRIPTION_TRUNCATE_LENGTH = 200;

function truncate(text: string | null | undefined, length: number): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= length) return trimmed;
  return `${trimmed.slice(0, length).trimEnd()}...`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Path is /share-bounty/:id (function name segment stripped by the gateway
  // in some setups, present in others) — take the final non-empty segment.
  const segments = url.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  const logEvent = url.searchParams.get('log');

  if (!id || id === 'share-bounty') {
    return new Response('Missing bounty id', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[share-bounty] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return new Response('Server misconfiguration', { status: 500 });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Beacon from the client-side redirect script — log and bail out early,
  // no need to re-fetch the bounty or render a page.
  if (logEvent === 'app_redirect' || logEvent === 'store_redirect') {
    await logShareEvent(supabaseAdmin, { contentType: 'bounty', contentId: id, eventType: logEvent, req });
    return new Response(null, { status: 204 });
  }

  const canonicalUrl = `${SITE_ORIGIN}/bounty/${id}`;
  const appDeepLink = `bountyexpo-workspace://bounty/${id}`;

  const { data: bounty, error } = await supabaseAdmin
    .from('bounties')
    .select(
      'id, title, description, amount, is_for_honor, category, location, username, attachments_json, status, created_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[share-bounty] fetch error', error);
  }

  if (!bounty) {
    // Log the view even for a missing/removed bounty — still useful signal
    // that a share link was clicked.
    await logShareEvent(supabaseAdmin, { contentType: 'bounty', contentId: id, eventType: 'page_view', req });
    const fallbackImageUrl = `${supabaseUrl}/functions/v1/share-og-image?type=bounty&id=_fallback`;
    const notFoundHtml = notFoundOgPage('bounty', fallbackImageUrl);
    return redirectToSharePage(supabaseAdmin, `bounty/${id}-notfound.html`, notFoundHtml, appDeepLink);
  }

  await logShareEvent(supabaseAdmin, { contentType: 'bounty', contentId: id, eventType: 'page_view', req });

  const rewardLine = bounty.is_for_honor ? 'For Honor' : `$${Number(bounty.amount).toLocaleString()} reward`;
  const detailParts = [bounty.category, bounty.location].filter(Boolean);
  const descriptionParts = [rewardLine];
  if (detailParts.length > 0) descriptionParts.push(detailParts.join(' • '));
  const truncatedDescription = truncate(bounty.description, DESCRIPTION_TRUNCATE_LENGTH);
  if (truncatedDescription) descriptionParts.push(truncatedDescription);
  if (bounty.username) descriptionParts.push(`Posted by @${bounty.username}`);

  const ogImageUrl = `${supabaseUrl}/functions/v1/share-og-image?type=bounty&id=${encodeURIComponent(
    String(id)
  )}&v=${encodeURIComponent(bounty.created_at || '')}`;

  const html = renderOgPage({
    title: bounty.title,
    description: descriptionParts.join(' — '),
    imageUrl: ogImageUrl,
    canonicalUrl,
    appDeepLink,
    iosStoreUrl: IOS_STORE_URL || undefined,
    androidStoreUrl: ANDROID_STORE_URL,
  });

  return redirectToSharePage(supabaseAdmin, `bounty/${id}.html`, html, appDeepLink);
});
