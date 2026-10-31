// Supabase Edge Function: proof-pages
//
// Read-only JSON (and photo bytes) for the website's completed-bounty proof
// pages: https://www.bountyfinder.net/proof/<slug>-<public_id>, rendered by
// Bounty-landing-page worker/proof.js. The website never talks to the
// database: it calls this function, which calls the proof_public_* SQL
// functions (supabase/migrations/20261027120000_bounty_proof_pages.sql) with
// the service role.
//
// What can come out of here is decided in SQL, not here. Those functions
// return only consented, reviewed, still-eligible proofs and an allowlist of
// fields: title, reward, category, "City, ST", derived timestamps, reviewer-
// approved photo roles and alt text, an approved quote and an optional first
// name. Never the bounty's id, its description, an address, a user id or a
// storage path. Photo bytes are streamed from here so the storage path (which
// embeds the bounty id and the original file name) stays on the server.
//
// ROUTES (GET/HEAD only, no auth: everything returned is already public)
//   /proof-pages/proofs/:public_id            { proof, related } | 404
//   /proof-pages/list?city=&category=&limit=&offset=   { total, items }
//   /proof-pages/index                        { proofs }
//   /proof-pages/img/:public_id/:n            image bytes | 404
//
// A malformed ?city= is a 400 (never cached); unknown categories are dropped.
//
// Caching: JSON for 60 s, photos for 300 s. A withdrawal or a takedown is
// live in the database at once; these TTLs (plus the website's own) bound how
// long a cached copy can outlive it.

declare const Deno: any

// @ts-ignore: runtime URL import for the Deno edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PUBLIC_ID = /^[a-z0-9]{8}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CATEGORY = /^[a-z0-9_-]{1,40}$/
const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function json(body: unknown, status = 200, maxAge = 60): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// Service-role client, built once per warm instance. It holds no session, so
// sharing it across requests carries nothing from one caller to the next.
let client: any = null
function serviceClient(): any {
  if (client) return client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return null
  client = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  return client
}

function intParam(v: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  const db = serviceClient()
  if (!db) return json({ error: 'Server misconfigured' }, 500)

  const url = new URL(req.url)
  const seg = (url.pathname.split('/proof-pages')[1] ?? '').split('/').filter(Boolean)

  try {
    if (seg.length === 2 && seg[0] === 'proofs') {
      if (!PUBLIC_ID.test(seg[1])) return json({ error: 'Not found' }, 404)
      const { data, error } = await db.rpc('proof_public_get', { p_public_id: seg[1] })
      if (error) throw error
      return data ? json(data) : json({ error: 'Not found' }, 404)
    }

    if (seg.length === 1 && seg[0] === 'list') {
      const city = url.searchParams.get('city')
      const categories = url.searchParams.getAll('category').filter((c) => CATEGORY.test(c)).slice(0, 10)
      // A malformed slug is the caller's mistake, not an empty city: say so,
      // uncached (json() sends no-store for anything but a 200).
      if (city !== null && !SLUG.test(city)) return json({ error: 'Invalid city' }, 400)
      const { data, error } = await db.rpc('proof_public_list', {
        p_city_slug: city,
        p_categories: categories.length ? categories : null,
        p_limit: intParam(url.searchParams.get('limit'), 24, 1, 48),
        p_offset: intParam(url.searchParams.get('offset'), 0, 0, 10000),
      })
      if (error) throw error
      return json(data ?? { total: 0, items: [] })
    }

    if (seg.length === 1 && seg[0] === 'index') {
      const { data, error } = await db.rpc('proof_public_index')
      if (error) throw error
      return json(data ?? { proofs: [] })
    }

    if (seg.length === 3 && seg[0] === 'img') {
      const n = Number.parseInt(seg[2], 10)
      if (!PUBLIC_ID.test(seg[1]) || !/^[0-5]$/.test(seg[2])) return new Response(null, { status: 404 })
      const { data: path, error } = await db.rpc('proof_public_photo', { p_public_id: seg[1], p_index: n })
      if (error) throw error
      const ext = typeof path === 'string' ? path.split('.').pop()?.toLowerCase() ?? '' : ''
      if (!path || !IMAGE_TYPES[ext]) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

      const { data: blob, error: dlError } = await db.storage.from('bounty-attachments').download(path)
      if (dlError || !blob || blob.size > MAX_IMAGE_BYTES) {
        console.error('[proof-pages] photo unavailable', seg[1], n, dlError?.message ?? (blob ? 'too large' : 'empty'))
        return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
      }
      return new Response(req.method === 'HEAD' ? null : blob, {
        status: 200,
        headers: {
          'Content-Type': IMAGE_TYPES[ext],
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'inline',
        },
      })
    }

    return json({ error: 'Not found' }, 404)
  } catch (e) {
    console.error('[proof-pages] failed', { route: seg[0], message: (e as Error)?.message })
    return json({ error: 'Unavailable' }, 503)
  }
})
