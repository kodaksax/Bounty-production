// Supabase Edge Functions force-rewrite any GET response with
// Content-Type: text/html to text/plain ("Edge Functions are designed for
// APIs and data processing, not serving web pages" — see
// https://supabase.com/docs/guides/functions/http-methods). That silently
// breaks both crawler OG-tag parsing and the client-side redirect script
// (browsers won't execute <script> inside a text/plain document).
//
// Workaround: Storage objects have no such restriction — they serve
// whatever contentType they were uploaded with. So share-bounty/
// share-profile render the HTML as usual, upload/overwrite it as a public
// Storage object, and 302-redirect the request there. Bots (Facebook,
// Slack, Discord, X, ...) and browsers both follow HTTP redirects
// transparently when fetching a URL to unfurl/render.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'share-pages';

export async function publishSharePage(
  supabaseAdmin: SupabaseClient,
  path: string,
  html: string
): Promise<string> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, html, {
    contentType: 'text/html; charset=utf-8',
    cacheControl: '60',
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Redirects to the published page, or straight to the app deep link if publishing itself fails. */
export async function redirectToSharePage(
  supabaseAdmin: SupabaseClient,
  path: string,
  html: string,
  fallbackUrl: string
): Promise<Response> {
  try {
    const publicUrl = await publishSharePage(supabaseAdmin, path, html);
    return new Response(null, { status: 302, headers: { Location: publicUrl, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[share-page-storage] failed to publish share page, falling back to deep link', err);
    return new Response(null, { status: 302, headers: { Location: fallbackUrl, 'Cache-Control': 'no-store' } });
  }
}
