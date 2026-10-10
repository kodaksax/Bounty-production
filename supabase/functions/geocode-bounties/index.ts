// Supabase Edge Function: geocode-bounties  (cron, service role only)
//
// Gives open in-person bounties that have no map point one, server-side, and
// hands the ones it can't place to a person.
//
// Why: bounty 5e96aaed (web, in-person, Alexandria, 2026-10-06) reached
// public.bounties with address text and no coordinates, so geom stayed NULL:
// no nearby search, no radius / service-area notifications. bounty-checkout's
// best-effort fallback geocode can fail (3 s timeout, no match) and it logged
// a console.warn that nobody saw, with no retry. As of 2026-10-08, 22 open
// in-person bounties have no point.
//
// What it does, each run:
//   fn_claim_geocode_batch  locks up to N candidates (SKIP LOCKED) and pushes
//                           their next attempt into the future, so overlapping
//                           runs never process the same bounty twice
//   Photon lookup           on the PRIVATE address (bounty_private_locations)
//   fn_apply_bounty_geocode writes lat/lng through bounties, so the existing
//                           privacy trigger stores the exact point privately and
//                           publishes only a jittered geom, and the existing
//                           nearby-notification trigger runs (for bounties under
//                           24 h old — see fn_bounties_claim_nearby_notification)
//   fn_record_geocode_failure  backs off (10 min doubling, max 6 h); after 5
//                           attempts, or at once when there is no address, opens
//                           one support case per bounty
//
// A missing point is never treated as "no hunters nearby": it is a job for a
// person, which is why every give-up opens a case.
//
// Privacy: the address is sent to Photon (the same provider the website's
// autocomplete already sends it to) and nowhere else. It is never logged and
// never put in an analytics event or a support-case summary.
//
// Auth: Authorization: Bearer <service role key> (pg_cron via net.http_post,
// as the other cron functions do). Schedule suggestion: every 15 minutes.

declare const Deno: any

// @ts-ignore: runtime URL import for the Deno edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { capture } from '../_shared/support-cases.ts'
import { isTerminal, photonQueryUrl, pickGeocodeHit, precheckAddress, type GeocodeOutcome } from './logic.ts'

const BATCH_SIZE = 10
const PROVIDER_TIMEOUT_MS = 5000
// Photon is a free shared service; stay well under any fair-use rate.
const DELAY_BETWEEN_CALLS_MS = 1100

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500)
  const presented = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (presented !== serviceKey) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: batch, error: claimErr } = await admin.rpc('fn_claim_geocode_batch', { p_limit: BATCH_SIZE })
  if (claimErr) {
    console.error('[geocode-bounties] claim failed', { code: claimErr.code, message: claimErr.message })
    return json({ ok: false, error: 'claim_failed' }, 500)
  }

  const results: Array<{ bounty_id: string; outcome: string }> = []
  const newCases: string[] = []

  for (const [i, row] of ((batch ?? []) as Array<{ bounty_id: string; address: string | null; attempts: number }>).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CALLS_MS))

    const outcome: GeocodeOutcome = precheckAddress(row.address) ?? (await lookup(row.address as string))

    if (outcome.ok) {
      const { data: applied, error } = await admin.rpc('fn_apply_bounty_geocode', {
        p_bounty_id: row.bounty_id,
        p_latitude: outcome.hit.latitude,
        p_longitude: outcome.hit.longitude,
        p_zip_code: outcome.hit.zipCode,
        p_neighborhood: outcome.hit.neighborhood,
      })
      if (error) {
        console.error('[geocode-bounties] apply failed', { bountyId: row.bounty_id, code: error.code })
        await recordFailure(admin, row.bounty_id, 'apply_failed', false, newCases)
        results.push({ bounty_id: row.bounty_id, outcome: 'apply_failed' })
        continue
      }
      results.push({ bounty_id: row.bounty_id, outcome: String(applied) })
      capture('system', 'bounty_geocode_result', {
        bounty_id: row.bounty_id, outcome: String(applied), exact: outcome.hit.exact, attempts: row.attempts,
      })
      continue
    }

    await recordFailure(admin, row.bounty_id, outcome.reason, isTerminal(outcome.reason), newCases)
    results.push({ bounty_id: row.bounty_id, outcome: outcome.reason })
    capture('system', 'bounty_geocode_result', { bounty_id: row.bounty_id, outcome: outcome.reason, attempts: row.attempts })
  }

  // One digest per run rather than one email per bounty, so the first run's
  // backlog doesn't flood the support inbox.
  if (newCases.length > 0) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          supportAlert: true,
          title: `${newCases.length} in-person bount${newCases.length === 1 ? 'y needs' : 'ies need'} a location set by hand`,
          body:
            'These open in-person bounties could not be placed on the map automatically, so nearby hunters are not being matched to them. ' +
            `Open each support case (kind geocode_failed) to fix the address. Bounties: ${newCases.join(', ')}`,
          data: {},
        }),
      })
    } catch (_) { /* the cases are the record */ }
  }

  console.log('[geocode-bounties] run complete', {
    claimed: results.length,
    outcomes: results.reduce<Record<string, number>>((acc, r) => ((acc[r.outcome] = (acc[r.outcome] ?? 0) + 1), acc), {}),
    new_cases: newCases.length,
  })
  return json({ ok: true, processed: results.length, results, new_cases: newCases.length })
})

async function lookup(address: string): Promise<GeocodeOutcome> {
  try {
    const resp = await fetch(photonQueryUrl(address), {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: { 'User-Agent': 'Bounty geocode-bounties (support@bountyfinder.app)' },
    })
    if (!resp.ok) return { ok: false, reason: 'provider_error' }
    return pickGeocodeHit(address, await resp.json())
  } catch {
    return { ok: false, reason: 'provider_error' }
  }
}

async function recordFailure(admin: any, bountyId: string, reason: string, terminal: boolean, newCases: string[]): Promise<void> {
  const { data, error } = await admin.rpc('fn_record_geocode_failure', {
    p_bounty_id: bountyId,
    p_reason: reason,
    p_terminal: terminal,
  })
  if (error) {
    console.error('[geocode-bounties] record failure failed', { bountyId, code: error.code })
    return
  }
  const row = Array.isArray(data) ? data[0] : data
  if (row?.case_created) newCases.push(bountyId)
}
