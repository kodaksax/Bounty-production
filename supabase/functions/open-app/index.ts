// Supabase Edge Function: open-app
//
// The button in an emailed sign-in code, for codes requested in the app.
// send-auth-email links here:
//
//   https://<project>.supabase.co/functions/v1/open-app?token_hash=…&type=magiclink
//
// Why it exists (2026-11-18): Gmail strips links that are not http(s), so an
// email button pointing straight at bountyexpo-workspace://… does nothing in
// Gmail. This https link survives, and on a phone it 302s to the app's own
// scheme, where app/auth/callback.tsx (reached via /auth/callback) verifies
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
    // Only on a real click. /verify spends the token on the first GET, and the
    // emailed code shares that token, so a mail security scanner fetching this
    // link (Microsoft Safe Links, Mimecast, ... all present desktop user
    // agents) would kill both the button and the code. Browsers send
    // Sec-Fetch-User: ?1 only for user-activated navigations; automated
    // fetchers do not.
    const userClick = req.headers.get('sec-fetch-user') === '?1'
    console.log('[open-app] desktop', {
      type,
      userClick,
      secFetchSite: req.headers.get('sec-fetch-site'),
      secFetchMode: req.headers.get('sec-fetch-mode'),
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

  const target = `${APP_CALLBACK}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
