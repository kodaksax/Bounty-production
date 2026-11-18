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
// the app spends it, so a scanner following the link uses nothing up (the
// old supabase.co/auth/v1/verify link was spent by the first GET).
//
// Not an open redirect: the only destination is the app's fixed callback
// path, and only a validated token_hash and type are passed through.
//
// Public by design (an email link carries no JWT): deploy with
// verify_jwt = false.

const APP_CALLBACK = 'bountyexpo-workspace://auth/callback'
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

  // The app scheme does nothing on a computer, so say what to do instead of
  // redirecting into nothing.
  const ua = req.headers.get('user-agent') ?? ''
  if (!/iPhone|iPad|iPod|Android/i.test(ua)) {
    return text(200, 'This button opens the Bounty app on your phone.\n\nOpen this email on the phone that has Bounty installed and tap the button there, or type the 6-digit code from the email into Bounty.')
  }

  const target = `${APP_CALLBACK}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
