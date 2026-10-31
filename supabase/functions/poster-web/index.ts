// Supabase Edge Function: poster-web
//
// The website's poster dashboard (https://www.bountyfinder.net/manage/, in
// Bounty-landing-page). Lets someone who posted on the web see their bounties,
// review applicants, accept or decline, confirm the job is done and reach a
// person — in a browser, without installing the app.
//
// Why (incident 2026-10-06, bounty 5e96aaed): a customer posted and paid on
// the website, got applicant emails whose only action was an app link, replied
// "Accept" to an unread inbox, and could not finish until the founder phoned
// her. She could discover, understand and pay; she could not decide.
//
// SECURITY MODEL
//   - Every route requires a Supabase Auth session (Authorization: Bearer
//     <user access token>). Links in emails carry only ids; nothing in a URL
//     authenticates anyone.
//   - State-changing routes act AS THE USER: they call the same RPC / RLS
//     paths the mobile app calls, with the user's own token, so the database
//     enforces ownership (fn_accept_bounty_request checks poster_id and
//     assert_account_active when auth.role() = 'authenticated';
//     bounty_requests / completion_submissions updates go through RLS).
//   - Reads use the service role (hunter profiles and ratings are not
//     readable by posters under RLS) with an explicit poster_id filter, and
//     return only allowlisted fields (logic.ts summarizeHunter). A bounty the
//     caller doesn't own is 404, not 403, so ids can't be probed.
//   - Money: completion calls the UNCHANGED bounty-payments/release endpoint
//     with the user's token. This function never talks to Stripe.
//
// ROUTES
//   GET  /poster-web/bounties
//   GET  /poster-web/bounties/:id
//   POST /poster-web/requests/:id/accept
//   POST /poster-web/requests/:id/decline
//   POST /poster-web/bounties/:id/confirm-completion
//   POST /poster-web/support            { bounty_id?, request_id?, reason, message, phone? }
//   GET  /poster-web/bounties/:id/proof
//   POST /poster-web/bounties/:id/proof  { share_task, share_photos, testimonial?, share_testimonial,
//                                          attribution: 'anonymous'|'first_name', first_name? }
//
// The proof routes are the poster's permission for a public proof page
// (bountyfinder.net/proof, migration 20261027120000_bounty_proof_pages). Both
// call the SQL functions AS THE USER, which check ownership with auth.uid();
// nothing here decides who may publish what.

declare const Deno: any

// @ts-ignore: runtime URL import for the Deno edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isUuid, webManageLink } from '../_shared/web-links.ts'
import { capture, openSupportCase } from '../_shared/support-cases.ts'
import {
  classifyAccept,
  classifyDecline,
  classifyRelease,
  decisionResult,
  explainBountyStatus,
  explainPayment,
  formatMoney,
  normalizeProofConsentInput,
  normalizeSupportInput,
  summarizeHunter,
  type DecisionState,
} from './logic.ts'

const DEFAULT_ORIGINS = ['https://www.bountyfinder.net', 'https://bountyfinder.net']

function corsFor(req: Request): Record<string, string> {
  const configured = (Deno.env.get('POSTER_WEB_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean)
  const allowed = configured.length ? configured : DEFAULT_ORIGINS
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

const SUPPORT_EMAIL = Deno.env.get('NOTIFICATION_REPLY_TO_EMAIL') || 'support@bountyfinder.app'
const WEB_MANAGE_BASE = Deno.env.get('WEB_MANAGE_BASE')

type Json = Record<string, unknown>

Deno.serve(async (req: Request) => {
  const cors = corsFor(req)
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceKey || !anonKey) return reply({ error: 'Server misconfigured' }, 500)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return reply({ error: 'Please sign in.', code: 'auth_required' }, 401)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userErr || !user?.id) return reply({ error: 'Your sign-in has expired. Please sign in again.', code: 'session_expired' }, 401)
  const userId: string = user.id

  // Acts as the user: RLS and auth.uid() apply exactly as in the app.
  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const path = new URL(req.url).pathname.split('/poster-web')[1]?.replace(/\/$/, '') ?? ''
  const seg = path.split('/').filter(Boolean)

  try {
    // ── GET /bounties ───────────────────────────────────────────────────
    if (req.method === 'GET' && seg.length === 1 && seg[0] === 'bounties') {
      const { data: rows, error } = await admin
        .from('bounties')
        .select('id, title, amount, status, work_type, location, created_at, accepted_by, funding_mode, is_for_honor')
        .or(`poster_id.eq.${userId},user_id.eq.${userId}`)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      const bounties = (rows ?? []) as Json[]
      const ids = bounties.map((b) => b.id as string)

      const [pending, payments, submissions] = ids.length
        ? await Promise.all([
            admin.from('bounty_requests').select('bounty_id').in('bounty_id', ids).eq('status', 'pending'),
            admin.from('bounty_payments').select('bounty_id, status, amount').in('bounty_id', ids),
            admin.from('completion_submissions').select('bounty_id').in('bounty_id', ids).eq('status', 'pending'),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }]

      const pendingBy = countBy((pending.data ?? []) as Json[], 'bounty_id')
      const paymentBy = new Map(((payments.data ?? []) as Json[]).map((p) => [p.bounty_id as string, p]))
      const submittedBy = countBy((submissions.data ?? []) as Json[], 'bounty_id')

      return reply({
        bounties: bounties.map((b) => {
          const id = b.id as string
          const pendingApplicants = pendingBy.get(id) ?? 0
          const hasSubmission = (submittedBy.get(id) ?? 0) > 0
          return {
            id,
            title: b.title,
            amount: Number(b.amount),
            amount_display: formatMoney(b.amount),
            status: b.status,
            work_type: b.work_type,
            location_label: b.location ?? null,
            created_at: b.created_at,
            pending_applicants: pendingApplicants,
            has_submission: hasSubmission,
            status_info: explainBountyStatus(b.status as string, { pendingApplicants, hasSubmission }),
            payment: explainPayment((paymentBy.get(id) as Json) ?? null, b),
          }
        }),
        support_email: SUPPORT_EMAIL,
      })
    }

    // ── GET /bounties/:id ───────────────────────────────────────────────
    if (req.method === 'GET' && seg.length === 2 && seg[0] === 'bounties') {
      const bountyId = seg[1]
      const bounty = await loadOwnedBounty(admin, bountyId, userId)
      if (!bounty) return reply({ error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404)

      const [{ data: reqRows }, { data: submission }, { data: payment }] = await Promise.all([
        admin
          .from('bounty_requests')
          .select('id, status, message, created_at, hunter_id, rejection_source')
          .eq('bounty_id', bountyId)
          .order('created_at', { ascending: true }),
        admin
          .from('completion_submissions')
          .select('id, status, message, submitted_at, proof_items, revision_count')
          .eq('bounty_id', bountyId)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from('bounty_payments').select('status, amount').eq('bounty_id', bountyId).maybeSingle(),
      ])

      const requests = (reqRows ?? []) as Json[]
      const hunterIds = [...new Set(requests.map((r) => r.hunter_id as string).filter(isUuid))]

      let profiles: Json[] = []
      let activityStats: Json[] = []
      const reviewsByHunter = new Map<string, Json[]>()
      if (hunterIds.length) {
        const [{ data: profileRows }, { data: statsRows }] = await Promise.all([
          admin
            .from('profiles')
            .select('id, display_name, full_name, username, avatar, created_at, id_verification_status, stripe_identity_status, phone_verified')
            .in('id', hunterIds),
          admin.rpc('get_profile_activity_stats_batch', { target_user_ids: hunterIds }),
        ])
        profiles = (profileRows ?? []) as Json[]
        activityStats = (statsRows ?? []) as Json[]
        await Promise.all(hunterIds.map(async (hunterId) => {
          const { data } = await admin.rpc('get_user_reviews', { p_user_id: hunterId, p_limit: 3, p_offset: 0 })
          reviewsByHunter.set(hunterId, (data ?? []) as Json[])
        }))
      }

      const profileBy = new Map(((profiles ?? []) as Json[]).map((p) => [p.id as string, p]))
      const statsBy = new Map(((activityStats ?? []) as Json[]).map((stats) => [stats.user_id as string, stats]))

      // Viewing applicants is the poster engaging with them. The absent-poster
      // sweep and the request-expiry copy read poster_interacted_at, and a
      // web-only poster has no app session to count — without this, someone
      // actively reviewing on the web could be treated as absent.
      const pendingIds = requests.filter((r) => r.status === 'pending').map((r) => r.id as string)
      if (pendingIds.length) {
        await admin.from('bounty_requests').update({ poster_interacted_at: new Date().toISOString() }).in('id', pendingIds)
      }

      const pendingApplicants = pendingIds.length
      const sub = submission as Json | null
      const hasSubmission = sub?.status === 'pending'

      return reply({
        bounty: {
          id: bounty.id,
          title: bounty.title,
          description: bounty.description,
          amount: Number(bounty.amount),
          amount_display: formatMoney(bounty.amount),
          status: bounty.status,
          work_type: bounty.work_type,
          location_label: bounty.location ?? null,
          created_at: bounty.created_at,
          accepted_request_id: bounty.accepted_request_id ?? null,
          status_info: explainBountyStatus(bounty.status as string, { pendingApplicants, hasSubmission }),
        },
        payment: explainPayment((payment as Json) ?? null, bounty),
        applicants: requests.map((r) => ({
          request_id: r.id,
          status: r.status,
          // A closed request's reason, in words, never the internal code.
          closed_reason: r.status === 'rejected' ? closedReason(r.rejection_source as string | null) : null,
          message: typeof r.message === 'string' ? r.message.slice(0, 1000) : null,
          applied_at: r.created_at,
          hunter: summarizeHunter(
            (profileBy.get(r.hunter_id as string) as Json) ?? null,
            (statsBy.get(r.hunter_id as string) as { rating_avg?: number | string | null; rating_count?: number; hunter_completed?: number } | undefined) ?? null,
            (reviewsByHunter.get(r.hunter_id as string) ?? []) as Array<{ rating: number; comment: string | null; created_at: string }>
          ),
        })),
        submission: sub
          ? {
              id: sub.id,
              status: sub.status,
              message: typeof sub.message === 'string' ? sub.message.slice(0, 2000) : null,
              submitted_at: sub.submitted_at,
              proof_count: Array.isArray(sub.proof_items) ? sub.proof_items.length : 0,
            }
          : null,
        support_email: SUPPORT_EMAIL,
      })
    }

    // ── POST /requests/:id/accept | decline ─────────────────────────────
    if (req.method === 'POST' && seg.length === 3 && seg[0] === 'requests' && (seg[2] === 'accept' || seg[2] === 'decline')) {
      const requestId = seg[1]
      if (!isUuid(requestId)) return reply(decisionResult('not_found'), 404)

      // Ownership first, with the service role, so a stranger's id is a 404
      // before any user-scoped call is made.
      const before = await loadDecisionState(admin, requestId)
      const owned = before.bounty && (await loadOwnedBounty(admin, before.bounty.id, userId))
      if (!before.request || !owned) return reply(decisionResult('not_found'), 404)

      if (seg[2] === 'accept') {
        // The same atomic transition the app uses, as the user: row locks on
        // the request then the bounty, open-status check, escrow reservation
        // for pay-at-accept bounties, and every other pending request
        // rejected — all in one transaction.
        const { error: rpcErr } = await asUser.rpc('fn_accept_bounty_request', { p_request_id: requestId })
        const after = await loadDecisionState(admin, requestId)
        const result = classifyAccept(after, rpcErr ? String(rpcErr.message ?? rpcErr.code ?? 'error') : null)
        if (rpcErr && result.outcome === 'retry') console.error('[poster-web] accept failed', { requestId, code: rpcErr.code, message: rpcErr.message })

        if (result.outcome === 'accepted') {
          // The hunter is told by the existing acceptance trigger
          // (handle_bounty_request_notification -> 'Bounty Accepted!'). The
          // poster gets a written confirmation here.
          await emailPoster(supabaseUrl, serviceKey, userId, {
            title: `You accepted a hunter for "${owned.title}"`,
            body:
              `You chose someone for "${owned.title}". They've been told and will be in touch. ` +
              `Your payment stays held until you confirm the job is done. If anything goes wrong, contact us and a person will help.`,
            ctaUrl: webManageLink(WEB_MANAGE_BASE, { bountyId: owned.id, campaign: 'accept_confirmation' }),
            ctaLabel: 'See your bounty',
            helpUrl: webManageLink(WEB_MANAGE_BASE, { bountyId: owned.id, view: 'help', campaign: 'accept_confirmation' }),
            bountyId: owned.id,
          })
          capture(userId, 'web_applicant_decision_completed', {
            decision: 'accept', outcome: result.outcome, bounty_id: owned.id, request_id: requestId,
          })
        }
        return reply({ ...result, bounty_id: owned.id }, result.httpStatus)
      }

      // Decline: the app's own path — a status update through RLS ("Posters
      // can update requests for their bounties"); fn_bounty_requests_stamp_decision
      // stamps rejected_at and rejection_source = 'poster'. Conditional on
      // still pending, so a repeat or a race is a no-op, not an overwrite.
      const { data: updated, error: updErr } = await asUser
        .from('bounty_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('id')
      if (updErr) {
        console.error('[poster-web] decline failed', { requestId, code: updErr.code, message: updErr.message })
        return reply(decisionResult('retry'), 503)
      }
      const after = await loadDecisionState(admin, requestId)
      const result = classifyDecline(after, (updated ?? []).length)
      if (result.outcome === 'declined') {
        capture(userId, 'web_applicant_decision_completed', {
          decision: 'decline', outcome: result.outcome, bounty_id: owned.id, request_id: requestId,
        })
      }
      return reply({ ...result, bounty_id: owned.id }, result.httpStatus)
    }

    // ── POST /bounties/:id/confirm-completion ───────────────────────────
    if (req.method === 'POST' && seg.length === 3 && seg[0] === 'bounties' && seg[2] === 'confirm-completion') {
      const bountyId = seg[1]
      const bounty = await loadOwnedBounty(admin, bountyId, userId)
      if (!bounty) return reply({ error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404)

      if (bounty.status === 'completed') {
        return reply({ ok: true, outcome: 'paid', message: 'This job is already complete. Nothing else to do.' })
      }
      if (bounty.status !== 'in_progress') {
        return reply({ ok: false, outcome: 'not_in_progress', message: 'This bounty isn’t in progress, so there’s nothing to confirm yet.' }, 409)
      }

      const { data: submission } = await admin
        .from('completion_submissions')
        .select('id, status')
        .eq('bounty_id', bountyId)
        .in('status', ['pending', 'approved'])
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!submission) {
        // The hunter never marked it done (e.g. finished in person). Payment
        // is not released from a poster's word alone with no hunter record of
        // the work — a person checks with both sides first.
        const { id: caseId } = await openSupportCase(admin, supabaseUrl, serviceKey, {
          kind: 'completion_without_submission',
          channel: 'web',
          posterId: userId,
          bountyId,
          summary: `Poster says "${bounty.title}" is finished, but the hunter hasn't marked it done. Confirm with the hunter, then complete and release.`,
          metadata: { amount: Number(bounty.amount) },
        })
        return reply({
          ok: true,
          outcome: 'no_submission',
          case_id: caseId,
          message:
            'Thanks for letting us know. Your hunter hasn’t marked the job done yet, so a person on our team will check with them and finish up. Your money stays held until then. We’ll email you.',
        })
      }

      // 1. Record the poster's approval — the app's own write, as the user.
      if ((submission as Json).status === 'pending') {
        const { error: approveErr } = await asUser
          .from('completion_submissions')
          .update({ status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', (submission as Json).id)
          .eq('status', 'pending')
        if (approveErr) {
          console.error('[poster-web] approve failed', { bountyId, code: approveErr.code, message: approveErr.message })
          return reply({ ok: false, outcome: 'retry', message: 'We couldn’t save your confirmation. Nothing changed — please try again.' }, 503)
        }
      }

      if (bounty.is_for_honor) {
        const { data: completed, error: completeErr } = await asUser
          .from('bounties')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', bountyId)
          .eq('status', 'in_progress')
          .select('id')
        if (completeErr || !completed?.length) {
          console.error('[poster-web] honor completion failed', { bountyId, code: completeErr?.code })
          return reply({ ok: false, outcome: 'retry', message: 'We couldn’t save your confirmation. Nothing changed — please try again.' }, 503)
        }
        capture(userId, 'web_completion_confirmed', { bounty_id: bountyId, outcome: 'completed' })
        return reply({ ok: true, outcome: 'completed', message: 'Thank you — the job is complete.' })
      }

      // 2. Release through the unchanged payments endpoint, as the user. It
      //    is idempotent (Stripe idempotency keys + status checks), so a
      //    retried confirmation can't pay twice.
      let releaseStatus = 0
      let releaseBody: Json | null = null
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/bounty-payments/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: anonKey },
          body: JSON.stringify({ bountyId }),
        })
        releaseStatus = resp.status
        releaseBody = (await resp.json().catch(() => null)) as Json | null
      } catch (e) {
        console.error('[poster-web] release request failed', { bountyId, e: String(e) })
      }
      const result = classifyRelease(releaseStatus, releaseBody)

      // 3. Only a confirmed transfer completes a paid bounty (the same rule
      //    as fn_bounties_guard_paid_completion).
      if (result.outcome === 'paid') {
        const { error: completeErr } = await asUser
          .from('bounties')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', bountyId)
          .eq('status', 'in_progress')
        if (completeErr) console.error('[poster-web] mark completed failed (release succeeded)', { bountyId, code: completeErr.code })
      }

      let caseId: string | null = null
      if (result.needsSupport) {
        const opened = await openSupportCase(admin, supabaseUrl, serviceKey, {
          kind: 'release_blocked',
          channel: 'web',
          posterId: userId,
          bountyId,
          summary: `Poster confirmed "${bounty.title}" is done, but payout could not start (${String(releaseBody?.code ?? releaseStatus)}). Help the hunter finish payout setup, then release.`,
          metadata: { release_status: releaseStatus, release_code: releaseBody?.code ?? null },
          dedupeKey: `release_blocked:${bountyId}`,
          reopenResolved: true,
        })
        caseId = opened.id
      }
      capture(userId, 'web_completion_confirmed', { bounty_id: bountyId, outcome: result.outcome })
      return reply({ ...result, case_id: caseId }, result.httpStatus)
    }

    // ── GET|POST /bounties/:id/proof ────────────────────────────────────
    if (seg.length === 3 && seg[0] === 'bounties' && seg[2] === 'proof' && (req.method === 'GET' || req.method === 'POST')) {
      const bountyId = seg[1]
      if (!isUuid(bountyId)) return reply({ error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404)

      if (req.method === 'GET') {
        const { data, error } = await asUser.rpc('proof_poster_get', { p_bounty_id: bountyId })
        if (error) return reply(...proofError(error))
        return reply({ ok: true, proof: data })
      }

      const body = (await req.json().catch(() => null)) as Json | null
      const input = normalizeProofConsentInput(body)
      if (input.error) return reply({ ok: false, error: input.error, code: 'invalid_input' }, 400)

      // Read only to know whether this answer takes a live page down (for
      // analytics). A "not yours" answers now; any other failure must not block
      // a withdrawal, so it is logged and the unpublish event is skipped. The
      // SQL records proof.unpublished in bounty_events either way.
      const { data: before, error: beforeError } = await asUser.rpc('proof_poster_get', { p_bounty_id: bountyId })
      if (beforeError?.code === 'P0002') return reply(...proofError(beforeError))
      if (beforeError) console.warn('[poster-web] proof pre-read failed', { code: beforeError.code, message: beforeError.message })
      const { data, error } = await asUser.rpc('proof_poster_set_consent', {
        p_bounty_id: bountyId,
        p_share_task: input.shareTask,
        p_share_photos: input.sharePhotos,
        p_testimonial: input.testimonial,
        p_share_testimonial: input.shareTestimonial,
        p_attribution: input.attribution,
        p_attribution_name: input.firstName,
        p_source: 'web',
      })
      if (error) return reply(...proofError(error))

      // Ids and booleans only: never the quote or the name.
      capture(userId, 'proof_consent_recorded', {
        bounty_id: bountyId,
        share_task: input.shareTask,
        share_photos: input.sharePhotos,
        share_testimonial: input.shareTestimonial && Boolean(input.testimonial),
        attribution: input.attribution,
        status: (data as Json | null)?.status ?? null,
      })
      if ((before as Json | null)?.status === 'published' && !input.shareTask) {
        capture(userId, 'proof_bounty_unpublished', { bounty_id: bountyId, reason: 'poster_withdrew_consent' })
      }
      return reply({ ok: true, proof: data })
    }

    // ── POST /support ───────────────────────────────────────────────────
    if (req.method === 'POST' && seg.length === 1 && seg[0] === 'support') {
      const body = (await req.json().catch(() => null)) as Json | null
      const input = normalizeSupportInput(body)
      if (input.error) return reply({ ok: false, error: input.error, code: 'invalid_input' }, 400)

      let bountyId: string | null = null
      if (isUuid(body?.bounty_id)) {
        const owned = await loadOwnedBounty(admin, body!.bounty_id as string, userId)
        bountyId = owned ? owned.id : null
      }
      let requestId: string | null = null
      if (isUuid(body?.request_id)) {
        const { data: request } = await admin
          .from('bounty_requests')
          .select('id, bounty_id')
          .eq('id', body!.request_id as string)
          .maybeSingle()
        const requestBounty = request ? await loadOwnedBounty(admin, request.bounty_id as string, userId) : null
        if (!request || !requestBounty) return reply({ ok: false, error: 'We couldn’t find that application on your account.', code: 'not_found' }, 404)
        if (bountyId && requestBounty.id !== bountyId) {
          return reply({ ok: false, error: 'That application doesn’t match this bounty.', code: 'invalid_input' }, 400)
        }
        bountyId = requestBounty.id
        requestId = request.id as string
      }
      const { id: caseId } = await openSupportCase(admin, supabaseUrl, serviceKey, {
        kind: input.reason === 'general' || input.reason === 'payment' ? 'web_contact' : 'problem_report',
        channel: 'web',
        posterId: userId,
        bountyId,
        requestId,
        summary: input.message || '(No message — please call back.)',
        metadata: { reason: input.reason, ...(input.phone ? { callback_phone: input.phone } : {}) },
      })
      if (!caseId) return reply({ ok: false, error: `We couldn’t send that. Please email ${SUPPORT_EMAIL}.` }, 503)
      capture(userId, 'web_support_requested', { reason: input.reason, bounty_id: bountyId, callback_requested: Boolean(input.phone) })
      return reply({
        ok: true,
        case_id: caseId,
        message: input.phone
          ? 'Thanks — a real person will call you back, usually within one business day.'
          : 'Thanks — a real person will reply by email, usually within one business day.',
      })
    }

    return reply({ error: 'Not found' }, 404)
  } catch (e) {
    console.error('[poster-web] unhandled', { path, message: (e as Error)?.message })
    return reply({ error: 'Something went wrong on our side. Please try again in a moment.', code: 'server_error' }, 500)
  }
})

// ── helpers ───────────────────────────────────────────────────────────────

// The proof SQL functions raise P0002 for "not yours / not found" and 22023
// for a request they refuse; their messages are written for the poster.
// 42501 (a missing grant, or the bounty_proofs guard) is a permission refusal,
// not a fault: say so without echoing the database's wording.
function proofError(error: { code?: string; message?: string }): [Json, number] {
  if (error.code === 'P0002') return [{ ok: false, error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404]
  if (error.code === '22023') return [{ ok: false, error: error.message ?? 'That can’t be saved.', code: 'invalid_input' }, 400]
  if (error.code === '42501') {
    console.warn('[poster-web] proof rpc refused', { code: error.code, message: error.message })
    return [{ ok: false, error: 'You can’t change sharing for this bounty.', code: 'forbidden' }, 403]
  }
  console.error('[poster-web] proof rpc failed', { code: error.code, message: error.message })
  return [{ ok: false, error: 'Something went wrong on our side. Please try again in a moment.', code: 'server_error' }, 500]
}

function countBy(rows: Json[], key: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r[key] as string
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

interface OwnedBounty {
  id: string
  title: string
  description: string | null
  amount: number | string
  status: string
  work_type: string
  location: string | null
  created_at: string
  poster_id: string | null
  user_id: string | null
  accepted_request_id: string | null
  funding_mode: string | null
  is_for_honor: boolean | null
}

async function loadOwnedBounty(admin: any, bountyId: string, userId: string): Promise<OwnedBounty | null> {
  if (!isUuid(bountyId)) return null
  const { data } = await admin
    .from('bounties')
    .select('id, title, description, amount, status, work_type, location, created_at, poster_id, user_id, accepted_request_id, funding_mode, is_for_honor')
    .eq('id', bountyId)
    .maybeSingle()
  if (!data || data.status === 'deleted') return null
  return (data.poster_id ?? data.user_id) === userId ? data : null
}

async function loadDecisionState(admin: any, requestId: string): Promise<DecisionState> {
  const { data: request } = await admin.from('bounty_requests').select('id, status, hunter_id, bounty_id').eq('id', requestId).maybeSingle()
  if (!request) return { request: null, bounty: null }
  const { data: bounty } = await admin.from('bounties').select('id, status, accepted_request_id').eq('id', request.bounty_id).maybeSingle()
  return { request, bounty: bounty ?? null }
}

function closedReason(source: string | null): string {
  switch (source) {
    case 'poster': return 'You declined this application.'
    case 'system_expiry': return 'This application closed because it wasn’t answered in time.'
    case 'system_bounty_closed': return 'This application closed when the bounty closed.'
    case 'system_poster_absent': return 'This application closed after a long time without an answer.'
    default: return 'This application is closed.'
  }
}

async function emailPoster(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  e: { title: string; body: string; ctaUrl: string; ctaLabel: string; helpUrl: string; bountyId: string }
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        userIds: [userId],
        category: 'marketplace',
        type: 'poster_decision_confirmation',
        title: e.title,
        body: e.body,
        data: { bountyId: e.bountyId, ctaUrl: e.ctaUrl, ctaLabel: e.ctaLabel, helpUrl: e.helpUrl },
      }),
    })
  } catch (err) {
    // The decision already succeeded; a missing confirmation email must not
    // turn it into an error for the poster.
    console.error('[poster-web] confirmation email failed (non-fatal)', String(err))
  }
}
