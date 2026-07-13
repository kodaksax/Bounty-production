// Supabase Edge Function (Deno) to forward Expo push messages
// Deploy under your Supabase project as an Edge Function named `send-expo-push`.
// This function accepts a POST JSON body with an array of Expo push messages
// matching the Expo push API format: [{ to, title, body, data, sound }]

// Example request body:
// [{ "to": "ExponentPushToken[...]", "title": "Hi", "body": "Test", "data": {} }]

// Use an explicit Deno std URL to ensure the Supabase bundler can resolve it
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'

// This function accepts an arbitrary array of { to, title, body, data } and
// forwards it verbatim to Expo — there is no per-recipient ownership check,
// so it must only ever be callable by trusted, server-side callers (this
// project's `services/api` bridge). The Supabase gateway's JWT check alone is
// not enough here: any signed-up app user has a valid JWT and could otherwise
// use this as an open push-notification relay to spam arbitrary titles/bodies
// to arbitrary Expo tokens. Require the caller to present the service role
// key specifically.
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  if (!SERVICE_ROLE_KEY) {
    console.error('[send-expo-push] SUPABASE_SERVICE_ROLE_KEY not configured')
    return new Response('Server misconfigured', { status: 500 })
  }
  const authHeader = req.headers.get('Authorization')
  const presentedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (presentedToken !== SERVICE_ROLE_KEY) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const messages = await req.json()
    if (!Array.isArray(messages)) return new Response('Invalid payload - expected array', { status: 400 })

    // Chunk messages into 100-item batches per Expo API recommendation
    const chunkSize = 100
    const chunks: any[][] = []
    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize))
    }

    const results: any[] = []

    for (const chunk of chunks) {
      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })

      const body = await resp.json().catch(() => null)
      results.push({ status: resp.status, body })
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200 })
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
})
