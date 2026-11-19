// Supabase Edge Function: open-app
//
// The button in an emailed sign-in code, for codes requested in the app.
// send-auth-email links here:
//
//   https://<project>.supabase.co/functions/v1/open-app?token_hash=…&type=magiclink
//
// Why it exists (2026-11-18): Gmail strips links that are not http(s), so an
// email button pointing straight at bountyexpo-workspace://… does nothing in
// Gmail. This https link survives. On an iPhone it 302s to the app's own
// scheme, where app/auth/callback.tsx (reached via /auth/callback) verifies
// the token_hash with verifyOtp and signs the person in. Android goes through
// a tap-to-continue page first (see the Android branch below).
//
// Safe for mail link scanners: this function never touches the token. Only
// the app, or a real tap on the website's Continue button, spends it, so a
// scanner following the link uses nothing up (the old
// supabase.co/auth/v1/verify link was spent by the first GET).
//
// DO NOT add a branch here that redirects to /auth/v1/verify. The emailed
// 6-digit code shares the token with this link, so spending it on a GET kills
// the code too. 2026-11-18: a desktop auto-verify branch (gated on Sec-Fetch
// headers) was deployed, and Gmail's link checker (Google IPs, headless
// Chrome sending Sec-Fetch-User ?1 / Site none / Mode navigate) passed the
// gate and spent tokens seconds after delivery, so Gmail users (mostly
// Android) got "code expired". Rolled back.
//
// Not an open redirect: the only destinations are the app's fixed callback
// path and the website's fixed landing page, and only a validated token_hash
// and type are passed through.
//
// Public by design (an email link carries no JWT): deploy with
// verify_jwt = false.

const APP_CALLBACK = 'bountyexpo-workspace://auth/callback'
// Tap-to-continue page on the website (Bounty-landing-page
// assets/auth-landing.js). Shows a Continue button and spends the token only
// on that tap, never on load.
const ANDROID_LANDING = 'https://www.bountyfinder.net/auth/open/'
const TYPES = new Set(['magiclink', 'signup', 'invite', 'recovery', 'email_change'])
const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{8,200}$/

function text(status: number, body: string): Response {
  return new Response(body + '\n', {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  })
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

Deno.serve((req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Method not allowed')

  const q = new URL(req.url).searchParams
  const tokenHash = q.get('token_hash') ?? ''
  const type = q.get('type') ?? ''
  if (!TOKEN_HASH_RE.test(tokenHash) || !TYPES.has(type)) {
    return text(400, "This link doesn't look right.\n\nRequest a new code from the Bounty sign-in screen, or type the 6-digit code from your email into Bounty.")
  }

  const ua = req.headers.get('user-agent') ?? ''

  // Android: Chrome will not leave the browser for an app's own scheme at the
  // end of a redirect chain unless a tap inside the browser started it. Gmail
  // opens the button through google.com/url, whose script redirect is not a
  // tap, so a 302 straight to bountyexpo-workspace:// was silently dropped and
  // left a blank google.com tab (production 2026-11-18, Samsung, Chrome 157).
  // The landing page's Continue tap is that gesture: /verify then redirects to
  // bountyexpo-workspace://auth/callback#access_token=…, Chrome opens the app,
  // and app/auth/callback.tsx reads the session from the fragment (the same
  // path password-reset links take).
  //
  // Linux user agents go there too: Android Chrome with "Desktop site" on (the
  // default on Samsung tablets, foldables and DeX) sends "X11; Linux x86_64"
  // with no "Android" (production 2026-11-19). The server cannot tell that
  // from a Linux computer; the page can (touch screen), and on a computer its
  // Continue signs in on the website instead. ChromeOS (CrOS) is left out.
  const isAndroid = /Android/i.test(ua)
  const maybeAndroidDesktopMode = /X11; Linux/.test(ua) && !/CrOS/.test(ua)
  if (isAndroid || maybeAndroidDesktopMode) {
    const page = new URL(ANDROID_LANDING)
    page.searchParams.set('token_hash', tokenHash)
    page.searchParams.set('type', type)
    page.searchParams.set('redirect_to', APP_CALLBACK)
    return redirect(page.toString())
  }

  // The app scheme does nothing on a computer, so say what to do instead of
  // redirecting into nothing. Never spend the token here (see header).
  if (!/iPhone|iPad|iPod/i.test(ua)) {
    return text(200, 'This button opens the Bounty app on your phone.\n\nOpen this email on the phone that has Bounty installed and tap the button there, or type the 6-digit code from the email into Bounty.')
  }

  return redirect(`${APP_CALLBACK}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`)
})
