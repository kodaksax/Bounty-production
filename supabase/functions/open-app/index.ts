// Supabase Edge Function: open-app
//
// The button in an emailed sign-in code, for codes requested in the app.
// send-auth-email links here:
//
//   https://<project>.supabase.co/functions/v1/open-app?token_hash=…&type=magiclink
//
// Why it exists (2026-11-18): Gmail strips links that are not http(s), so an
// email button pointing straight at bountyexpo-workspace://… does nothing in
// Gmail. This https link survives, and on an iPhone it 302s to the app's own
// scheme (on Android it goes through a tap-to-continue page; see below), where app/auth/callback.tsx (reached via /auth/callback) verifies
// the token_hash with verifyOtp and signs the person in.
//
// Safe for mail link scanners: this function never touches the token. Only
// the app (or, on a computer, a real click) spends it, so a scanner following
// the link uses nothing up (the old supabase.co/auth/v1/verify link was spent
// by the first GET).
//
// On a computer, a clicked sign-in link signs the person in on
// bountyfinder.net instead (see the desktop branch below).
//
// Not an open redirect: the only destinations are the app's fixed callback
// path and this project's /verify with a fixed website redirect, and only a
// validated token_hash and type are passed through.
//
// Public by design (an email link carries no JWT): deploy with
// verify_jwt = false.

const APP_CALLBACK = 'bountyexpo-workspace://auth/callback'
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
// Where a sign-in link opened on a computer lands, signed in. Must be in the
// project's Auth redirect allowlist (it is: the website's own sign-in uses it).
const WEB_SIGN_IN_URL = Deno.env.get('WEB_SIGN_IN_URL') || 'https://www.bountyfinder.net/bounty'
// Tap-to-continue page on the website (assets/auth-landing.js). It accepts
// redirect_to=bountyexpo-workspace://… and verifies only on a real tap.
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

Deno.serve((req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Method not allowed')

  const q = new URL(req.url).searchParams
  const tokenHash = q.get('token_hash') ?? ''
  const type = q.get('type') ?? ''
  if (!TOKEN_HASH_RE.test(tokenHash) || !TYPES.has(type)) {
    return text(400, "This link doesn't look right.\n\nRequest a new code from the Bounty sign-in screen, or type the 6-digit code from your email into Bounty.")
  }

  const ua = req.headers.get('user-agent') ?? ''
  if (!/iPhone|iPad|iPod|Android/i.test(ua)) {
    // On a computer the app scheme goes nowhere, so a sign-in link signs the
    // person in on the website instead: Supabase's /verify spends the token
    // and redirects to bountyfinder.net with the session.
    //
    // Only for a page opened in a real browser. /verify spends the token on
    // the first GET, and the emailed code shares that token, so a mail
    // security scanner fetching this link (desktop user agents) would kill
    // both the button and the code. Real browsers mark top-level page loads
    // with Sec-Fetch-Mode: navigate plus Sec-Fetch-Site; plain HTTP fetchers
    // (most link scanners) send no Sec-Fetch headers at all.
    //
    // Sec-Fetch-User: ?1 (user activation) would be stricter, but Safari does
    // not send it for links opened from mail: production 2026-11-18, macOS
    // Safari 18.6 sent mode=navigate, site=cross-site and no Sec-Fetch-User.
    // Residual risk: scanners that drive a full headless browser. Still far
    // narrower than Supabase's default link, which /verify-spends on any GET.
    const secFetchUser = req.headers.get('sec-fetch-user')
    const secFetchMode = req.headers.get('sec-fetch-mode')
    const secFetchSite = req.headers.get('sec-fetch-site')
    const userClick = secFetchUser === '?1' || (secFetchMode === 'navigate' && !!secFetchSite)
    console.log('[open-app] desktop', {
      type,
      userClick,
      secFetchUser,
      secFetchSite,
      secFetchMode,
    })
    if (type === 'magiclink' && userClick && req.method === 'GET' && SUPABASE_URL) {
      const verify = new URL(`${SUPABASE_URL}/auth/v1/verify`)
      verify.searchParams.set('token', tokenHash)
      verify.searchParams.set('type', type)
      verify.searchParams.set('redirect_to', WEB_SIGN_IN_URL)
      return new Response(null, {
        status: 302,
        headers: { Location: verify.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      })
    }
    return text(200, 'This button opens the Bounty app on your phone.\n\nOpen this email on the phone that has Bounty installed and tap the button there, or type the 6-digit code from the email into Bounty.')
  }

  // Android: Chrome will not leave the browser for an app's own scheme at the
  // end of a redirect chain unless that chain began with a tap inside the
  // browser. Gmail opens the button through google.com/url, whose script
  // redirect is not a tap, so a 302 straight to bountyexpo-workspace:// was
  // silently dropped and left a blank google.com tab (production 2026-11-18,
  // Samsung, Chrome 157). Send Android to the website's tap-to-continue page
  // instead: its Continue tap is the gesture, /verify then redirects to
  // bountyexpo-workspace://auth/callback#access_token=…, which Chrome opens,
  // and app/auth/callback.tsx reads the session from the fragment (the same
  // path password-reset links already take). The page spends the token only
  // on that tap, so link scanners still use nothing up.
  if (/Android/i.test(ua)) {
    const page = new URL(ANDROID_LANDING)
    page.searchParams.set('token_hash', tokenHash)
    page.searchParams.set('type', type)
    page.searchParams.set('redirect_to', APP_CALLBACK)
    return new Response(null, {
      status: 302,
      headers: { Location: page.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  }

  const target = `${APP_CALLBACK}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
