/**
 * Auth Open Route — universal link entry for emailed sign-in links.
 *
 * Sign-in emails for codes requested in the app link to
 * `https://www.bountyfinder.net/auth/open/?token_hash=…&type=magiclink`
 * (built by supabase/functions/send-auth-email). The app claims that path as a
 * universal link (iOS: associatedDomains + the site's AASA; Android: the
 * `/auth/open` intent filter in app.json), so on a phone with Bounty installed
 * the tap lands here instead of in a browser.
 *
 * The link carries a `token_hash`, not session tokens, so nothing is spent
 * until this screen calls `verifyOtp` — a mail scanner fetching the same URL
 * hits the website's static page and uses nothing up. Parsing, verification,
 * error states and the post-sign-in destination are all the callback
 * screen's; this route only gives the URL somewhere to land, the same way
 * `app/auth/index.tsx` does for `bountyexpo-workspace://auth`.
 */

import AuthCallbackScreen from './callback';

export default function AuthOpen() {
  return <AuthCallbackScreen />;
}
