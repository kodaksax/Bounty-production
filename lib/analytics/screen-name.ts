// lib/analytics/screen-name.ts
//
// Maps expo-router's file-based route segments to a stable, human-readable
// `screen_name` for analytics. `useSegments()` returns the literal route
// filenames (e.g. "[id]"), never resolved param values, so dynamic IDs never
// leak into the slug here — put them in separate event properties instead.

const OVERRIDES: Record<string, string> = {
  index: 'home', // app/index.tsx — auth gate / cold-start landing
  tabs_bounty_app: 'home_feed',
  tabs_search: 'search',
  tabs_wallet_screen: 'wallet',
  tabs_postings_screen: 'postings',
  tabs_profile_screen: 'profile',
  tabs_messenger_screen: 'messages',
  tabs_messenger: 'messages',
  tabs_messenger_conversationid: 'conversation',
  tabs_messenger_user_userid: 'conversation_new',
  bounty_id: 'bounty_detail',
  bounty_id_public: 'bounty_detail_public',
  bounty_id_dispute: 'bounty_dispute',
  bounty_id_cancel: 'bounty_cancel',
  bounty_id_cancellation_response: 'bounty_cancellation_response',
  screens_createbounty: 'post_step',
  profile_userid: 'profile_other',
  profile_edit: 'profile_edit',
  postings_bountyid: 'posting_detail',
  postings_bountyid_payout: 'posting_payout',
  postings_bountyid_review_and_verify: 'posting_review',
  in_progress_bountyid_hunter: 'hunter_job_detail',
  in_progress_bountyid_hunter_apply: 'hunter_apply',
  in_progress_bountyid_hunter_payout: 'hunter_payout',
  in_progress_bountyid_hunter_review_and_verify: 'hunter_review',
  in_progress_bountyid_hunter_work_in_progress: 'hunter_work_in_progress',
  dispute_disputeid: 'dispute_detail',
  dispute_create: 'dispute_create',
  admin: 'admin_dashboard',
  admin_bounty_id: 'admin_bounty_detail',
  admin_user_id: 'admin_user_detail',
  admin_disputes_id: 'admin_dispute_detail',
  wallet_connect_embedded_onboarding: 'wallet_connect_onboarding',
};

/**
 * Normalizes expo-router segments into a stable analytics slug. Route groups
 * `(admin)` and dynamic segments `[id]` are flattened into plain tokens, so
 * this is safe on its own even for routes not listed in `OVERRIDES` — it just
 * produces a less human-friendly (but still ID-free and stable) name.
 */
export function normalizeScreenName(segments: readonly string[]): string {
  const parts = segments
    .map(seg => seg.replace(/^\(([^)]*)\)$/, '$1')) // (admin) -> admin
    .map(seg => seg.replace(/^\[\.\.\.(.+)\]$/, '$1')) // [...rest] -> rest
    .map(seg => seg.replace(/^\[(.+)\]$/, '$1')) // [id] -> id
    .map(seg => seg.replace(/-/g, '_').toLowerCase())
    .filter(Boolean)
    .filter((seg, i, arr) => !(seg === 'index' && i === arr.length - 1));

  const key = parts.length === 0 ? 'index' : parts.join('_');
  return OVERRIDES[key] ?? key;
}

// app/tabs/bounty-app.tsx implements its own tab shell (BottomNav) whose
// switches never change the route/segments — see `activeScreen` state there.
// Keep these values in sync with the `allowedScreens` set in that file.
export function screenNameForBountyAppTab(tab: string): string {
  switch (tab) {
    case 'bounty':
      return 'home_feed';
    case 'wallet':
      return 'wallet';
    case 'postings':
      return 'postings';
    case 'profile':
      return 'profile';
    case 'messages':
      return 'messages';
    case 'admin':
      return 'admin_dashboard';
    default:
      return `tab_${tab}`;
  }
}
