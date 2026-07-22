// Supabase Edge Function: share-profile
//
// Public, unauthenticated HTML page for a user's profile share link
// (bountyfinder.app/profile/:id, once DNS/reverse-proxy is wired to this
// function). Mirrors share-bounty: Open Graph/Twitter Card metadata for
// link-unfurling bots, smart-redirect (app deep link -> store fallback) for
// real visitors. Only public-safe profile columns are selected — this
// function uses the service role key (bypasses RLS), so the select list
// itself is what keeps balance/email/phone/etc. out of the response.
//
// Route shape: GET /share-profile/:id
//   ?log=app_redirect|store_redirect — beacon from the client redirect script.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notFoundOgPage, renderOgPage } from '../_shared/og-html.ts';
import { redirectToSharePage } from '../_shared/share-page-storage.ts';
import { logShareEvent } from '../_shared/share-log.ts';

const SITE_ORIGIN = 'https://bountyfinder.app';
// TODO: fill in once the app is listed on the App Store (numeric app id).
const IOS_STORE_URL = '';
const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=app.bountyfinder.BOUNTYExpo';

const ABOUT_TRUNCATE_LENGTH = 200;

function truncate(text: string | null | undefined, length: number): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= length) return trimmed;
  return `${trimmed.slice(0, length).trimEnd()}...`;
}

async function getRatingStats(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string
): Promise<{ averageRating: number; ratingCount: number }> {
  const { data, error } = await supabaseAdmin.from('ratings').select('rating').eq('to_user_id', userId);
  if (!error) {
    const rows = data || [];
    if (rows.length === 0) return { averageRating: 0, ratingCount: 0 };
    const total = rows.reduce((sum: number, row: any) => sum + Number(row.rating || 0), 0);
    return { averageRating: total / rows.length, ratingCount: rows.length };
  }

  // Legacy schema fallback (see lib/services/ratings.ts for the same pattern).
  const { data: legacyRows, error: legacyError } = await supabaseAdmin
    .from('user_ratings')
    .select('score')
    .eq('user_id', userId);
  if (legacyError || !legacyRows || legacyRows.length === 0) {
    return { averageRating: 0, ratingCount: 0 };
  }
  const total = legacyRows.reduce((sum: number, row: any) => sum + Number(row.score || 0), 0);
  return { averageRating: total / legacyRows.length, ratingCount: legacyRows.length };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  const logEvent = url.searchParams.get('log');

  if (!id || id === 'share-profile') {
    return new Response('Missing profile id', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[share-profile] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return new Response('Server misconfiguration', { status: 500 });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  if (logEvent === 'app_redirect' || logEvent === 'store_redirect') {
    await logShareEvent(supabaseAdmin, { contentType: 'profile', contentId: id, eventType: logEvent, req });
    return new Response(null, { status: 204 });
  }

  const canonicalUrl = `${SITE_ORIGIN}/profile/${id}`;
  const appDeepLink = `bountyexpo-workspace://profile/${id}`;

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name, avatar, about, title, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[share-profile] fetch error', error);
  }

  if (!profile) {
    await logShareEvent(supabaseAdmin, { contentType: 'profile', contentId: id, eventType: 'page_view', req });
    const fallbackImageUrl = `${supabaseUrl}/functions/v1/share-og-image?type=profile&id=_fallback`;
    const notFoundHtml = notFoundOgPage('profile', fallbackImageUrl);
    return redirectToSharePage(supabaseAdmin, `profile/${id}-notfound.html`, notFoundHtml, appDeepLink);
  }

  await logShareEvent(supabaseAdmin, { contentType: 'profile', contentId: id, eventType: 'page_view', req });

  const [{ averageRating, ratingCount }, { count: completedCount }] = await Promise.all([
    getRatingStats(supabaseAdmin, id),
    supabaseAdmin
      .from('bounties')
      .select('id', { count: 'exact', head: true })
      .eq('accepted_by', id)
      .eq('status', 'completed'),
  ]);

  const displayName = profile.display_name || (profile.username ? `@${profile.username}` : 'This user');

  const statParts: string[] = [];
  if (averageRating > 0) statParts.push(`⭐ ${averageRating.toFixed(1)} (${ratingCount})`);
  if ((completedCount || 0) > 0) statParts.push(`${completedCount} bounties completed`);

  const descriptionParts = [...statParts];
  const truncatedAbout = truncate(profile.about, ABOUT_TRUNCATE_LENGTH);
  if (truncatedAbout) descriptionParts.push(truncatedAbout);
  if (descriptionParts.length === 0) descriptionParts.push('Check out this profile on Bounty.');

  const ogImageUrl = `${supabaseUrl}/functions/v1/share-og-image?type=profile&id=${encodeURIComponent(
    String(id)
  )}&v=${encodeURIComponent(profile.created_at || '')}`;

  const html = renderOgPage({
    title: `${displayName} on Bounty`,
    description: descriptionParts.join(' — '),
    imageUrl: ogImageUrl,
    canonicalUrl,
    appDeepLink,
    iosStoreUrl: IOS_STORE_URL || undefined,
    androidStoreUrl: ANDROID_STORE_URL,
  });

  return redirectToSharePage(supabaseAdmin, `profile/${id}.html`, html, appDeepLink);
});
