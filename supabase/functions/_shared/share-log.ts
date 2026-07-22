// Shared helper for logging to `share_link_events` (see
// supabase/migrations/20260723_add_share_link_events.sql). Used by
// share-bounty/share-profile both for the initial page view and for the
// app_redirect/store_redirect beacons fired by the client-side redirect
// script in _shared/og-html.ts.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type ShareEventType = 'page_view' | 'app_redirect' | 'store_redirect';

export async function logShareEvent(
  supabaseAdmin: SupabaseClient,
  params: {
    contentType: 'bounty' | 'profile';
    contentId: string;
    eventType: ShareEventType;
    req: Request;
  }
): Promise<void> {
  const { contentType, contentId, eventType, req } = params;
  try {
    await supabaseAdmin.from('share_link_events').insert({
      content_type: contentType,
      content_id: contentId,
      event_type: eventType,
      user_agent: req.headers.get('user-agent'),
      referrer: req.headers.get('referer'),
    });
  } catch (err) {
    // Analytics logging must never break the share page itself.
    console.error('[share-log] failed to log share event', err);
  }
}
