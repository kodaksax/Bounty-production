// Supabase Edge Function: poster-web
//
// The website's bounty page (https://www.bountyfinder.net/bounty) for posters
// who posted on the web and never installed the app. Every email a poster
// gets about a bounty links there (process-notification WEB_BOUNTY_URL_BASE).
//
// Routes (all require the poster's own Supabase session as a Bearer token):
//   GET  /poster-web/bounties              the caller's bounties, newest first
//   GET  /poster-web/bounty?id=<uuid>      one bounty: applicants, hunter,
//                                          submitted work, payment, dispute
//   POST /poster-web/accept   { bounty_id, request_id }
//   POST /poster-web/approve  { bounty_id }
//   POST /poster-web/dispute  { bounty_id, reason, reason_code? }
//
// MONEY: this function never moves money itself and holds no service-role
// release path. Accept forwards to accept-bounty-request and approve forwards
// to bounty-payments/release, each with the poster's own token, so the exact
// checks the app goes through (caller is the poster, escrow state, hunter
// payout readiness, Stripe idempotency) apply unchanged. Automatic release
// at the end of the review window is deliberately NOT here: see Phase B in
// docs/security/escrow-recourse-review-window-2026-10-02.md.
//
// Approve follows the order the app uses (lib/services/completion-approval.ts):
// release first, and only after Stripe has accepted the transfer mark the
// submission approved and the bounty completed. Those two writes use the
// service role because fn_bounties_guard_paid_completion refuses a client
// completion until transfer.created has been reconciled, which for v2 lands a
// moment after /release returns; the transfer already exists at that point.
// A retry after a lost write is safe: /release answers 409 release_pending
// with the same transfer id, which counts as released (interpretReleaseResponse).
//
// Disputes are inserted with the poster's token so the
// bounty_disputes_insert_participant RLS policy decides, exactly as for the
// app's dispute-service.createWorkflowDispute.

declare const Deno: any

// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ACTIVE_DISPUTE_STATUSES,
  DEFAULT_REVIEW_WINDOW_HOURS,
  deriveStage,
  hunterPayout,
  interpretReleaseResponse,
  isHunterPayoutSetupFailure,
  isUuid,
  parseProofItems,
  reviewDeadline,
  validateDisputeInput,
} from './logic.ts'

const DEFAULT_ALLOWED_ORIGINS = ['https://www.bountyfinder.net', 'https://bountyfinder.net']

function resolveCorsHeaders(req: Request): Record<string, string> {
  const configured = (Deno.env.get('POSTER_WEB_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean)
  const allowed = configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS
  const origin = req.headers.get('Origin') ?? ''
  return {
    // Echo the origin only when it is on the list; otherwise send a value that
    // matches nothing so the browser blocks the response.
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  }
}

function jsonResponse(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const WEB_BOUNTY_URL_BASE = Deno.env.get('WEB_BOUNTY_URL_BASE') || 'https://www.bountyfinder.net/bounty'

function bountyPageUrl(bountyId: string): string {
  return `${WEB_BOUNTY_URL_BASE.replace(/\/+$/, '')}?id=${encodeURIComponent(bountyId)}`
}

Deno.serve(async (req: Request) => {
  const cors = resolveCorsHeaders(req)
  const reply = (data: unknown, status = 200) => jsonResponse(data, status, cors)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const parts = url.pathname.split('/poster-web')
  const subPath = parts.length > 1 ? parts[1].replace(/\/$/, '') : ''

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return reply({ error: 'Please sign in.', code: 'authentication_required' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const user = authData?.user
  if (authError || !user) {
    return reply({ error: 'Your sign-in has expired. Please sign in again.', code: 'authentication_required' }, 401)
  }
  const userId: string = user.id

  // Client acting as the poster, for writes RLS should judge.
  const asPoster = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })

  const feePercent = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '10')

  // Loads a bounty only if the caller posted it. A bounty someone else posted
  // reads as not found, so ids cannot be probed.
  async function loadOwnBounty(bountyId: unknown) {
    if (!isUuid(bountyId)) return null
    const { data, error } = await admin
      .from('bounties')
      .select(
        // One string literal: supabase-js infers the row type from it, and a
        // concatenated (widened) string types every row as an error.
        'id, title, description, amount, is_for_honor, status, work_type, location, created_at, completed_at, poster_id, user_id, accepted_by, accepted_request_id, payment_architecture_version'
      )
      .eq('id', bountyId)
      .maybeSingle()
    if (error) throw error
    if (!data || (data.poster_id ?? data.user_id) !== userId) return null
    return data
  }

  async function activeDispute(bountyId: string) {
    const { data, error } = await admin
      .from('bounty_disputes')
      .select('id, status, reason, created_at, initiator_id')
      .eq('bounty_id', bountyId)
      .in('status', ACTIVE_DISPUTE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  }

  // Latest submission from the accepted hunter (a revision is a new row).
  async function latestSubmission(bountyId: string, hunterId: string | null) {
    if (!hunterId) return null
    const { data, error } = await admin
      .from('completion_submissions')
      .select('id, status, message, proof_items, submitted_at, revision_count')
      .eq('bounty_id', bountyId)
      .eq('hunter_id', hunterId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  }

  async function reviewWindowHours(): Promise<number> {
    // completion_review_policy ships with 20261002120100; until it is applied
    // the documented 72h default applies.
    const { data, error } = await admin.from('completion_review_policy').select('window_hours').maybeSingle()
    if (error || !data?.window_hours) return DEFAULT_REVIEW_WINDOW_HOURS
    return Number(data.window_hours)
  }

  // Public card for a hunter: what the app shows a poster choosing between
  // applicants. No contact details.
  async function hunterCards(hunterIds: string[]) {
    const ids = [...new Set(hunterIds)].filter(isUuid)
    if (ids.length === 0) return new Map<string, any>()
    const [{ data: profiles }, { data: ratings }, { data: done }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, display_name, full_name, username, avatar, id_verification_status, verified, created_at')
        .in('id', ids),
      admin.from('ratings').select('to_user_id, rating').in('to_user_id', ids).is('hidden_at', null),
      admin.from('bounties').select('accepted_by').in('accepted_by', ids).eq('status', 'completed'),
    ])
    const cards = new Map<string, any>()
    for (const p of (profiles ?? []) as any[]) {
      const own = ((ratings ?? []) as any[]).filter((r) => r.to_user_id === p.id)
      const avg = own.length ? own.reduce((s, r) => s + Number(r.rating || 0), 0) / own.length : null
      cards.set(p.id, {
        id: p.id,
        name: p.display_name || p.full_name || p.username || 'Hunter',
        avatar: typeof p.avatar === 'string' && p.avatar.startsWith('https://') ? p.avatar : null,
        id_verified: p.id_verification_status === 'verified' || p.verified === true,
        rating: avg === null ? null : Math.round(avg * 10) / 10,
        rating_count: own.length,
        jobs_completed: ((done ?? []) as any[]).filter((b) => b.accepted_by === p.id).length,
        member_since: p.created_at,
      })
    }
    return cards
  }

  // Best-effort notification through the outbox (push, in-app and email per
  // the recipient's preferences). Never fails the action that triggered it.
  async function notify(recipientId: string, title: string, body: string, data: Record<string, unknown>) {
    const { error } = await admin.from('notifications_outbox').insert({
      recipients: [recipientId],
      title,
      body,
      data,
      bounty_id: typeof data.bounty_id === 'string' ? data.bounty_id : null,
    })
    if (error) console.error('[poster-web] notification enqueue failed', { type: data.type, error })
  }

  try {
    // ── GET /poster-web/bounties ──────────────────────────────────────────
    if (req.method === 'GET' && subPath === '/bounties') {
      const { data, error } = await admin
        .from('bounties')
        .select('id, title, amount, is_for_honor, status, created_at')
        .or(`poster_id.eq.${userId},user_id.eq.${userId}`)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return reply({ bounties: data ?? [] })
    }

    // ── GET /poster-web/bounty?id= ────────────────────────────────────────
    if (req.method === 'GET' && subPath === '/bounty') {
      const bounty = await loadOwnBounty(url.searchParams.get('id'))
      if (!bounty) return reply({ error: 'We could not find that bounty on your account.', code: 'not_found' }, 404)

      const hunterId: string | null = bounty.accepted_by ?? null
      const [dispute, submission, windowHours, pendingRequests, payment] = await Promise.all([
        activeDispute(bounty.id),
        latestSubmission(bounty.id, hunterId),
        reviewWindowHours(),
        bounty.status === 'open'
          ? admin
              .from('bounty_requests')
              .select('id, hunter_id, message, created_at')
              .eq('bounty_id', bounty.id)
              .eq('status', 'pending')
              .order('created_at', { ascending: true })
              .then((r: any) => {
                if (r.error) throw r.error
                return (r.data ?? []) as any[]
              })
          : Promise.resolve([] as any[]),
        admin
          .from('bounty_payments')
          .select('status')
          .eq('bounty_id', bounty.id)
          .maybeSingle()
          .then((r: any) => r.data),
      ])

      const cards = await hunterCards([...pendingRequests.map((r) => r.hunter_id), ...(hunterId ? [hunterId] : [])])
      const amount = Number(bounty.amount ?? 0)

      return reply({
        bounty: {
          id: bounty.id,
          title: bounty.title,
          description: bounty.description,
          amount,
          is_for_honor: !!bounty.is_for_honor,
          hunter_receives: bounty.is_for_honor ? 0 : hunterPayout(amount, feePercent),
          fee_percent: feePercent,
          status: bounty.status,
          work_type: bounty.work_type,
          location: bounty.location,
          created_at: bounty.created_at,
          completed_at: bounty.completed_at,
        },
        stage: deriveStage({
          bountyStatus: String(bounty.status),
          hasActiveDispute: !!dispute,
          latestSubmissionStatus: submission?.status ?? null,
        }),
        applicants: pendingRequests
          .filter((r) => cards.has(r.hunter_id))
          .map((r) => ({
            request_id: r.id,
            applied_at: r.created_at,
            message: typeof r.message === 'string' ? r.message.slice(0, 1000) : null,
            hunter: cards.get(r.hunter_id),
          })),
        hunter: hunterId ? cards.get(hunterId) ?? null : null,
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              message: submission.message,
              submitted_at: submission.submitted_at,
              is_revision: Number(submission.revision_count ?? 0) > 0,
              proof: parseProofItems(submission.proof_items, supabaseUrl),
              review_deadline:
                submission.status === 'pending' ? reviewDeadline(submission.submitted_at, windowHours) : null,
            }
          : null,
        payment_status: payment?.status ?? null,
        dispute: dispute ? { status: dispute.status, reason: dispute.reason, created_at: dispute.created_at } : null,
        // v1 (wallet ledger) bounties settle through the app's wallet flow,
        // which this page does not drive.
        web_actions_supported: bounty.is_for_honor || [2, 3].includes(Number(bounty.payment_architecture_version)),
      })
    }

    // ── POST /poster-web/accept ───────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/accept') {
      const body = await req.json().catch(() => ({}))
      const bounty = await loadOwnBounty(body?.bounty_id)
      if (!bounty) return reply({ error: 'We could not find that bounty on your account.', code: 'not_found' }, 404)
      if (!isUuid(body?.request_id)) return reply({ error: 'Pick a hunter to accept.', code: 'request_id_required' }, 400)

      const { data: request } = await admin
        .from('bounty_requests')
        .select('id, bounty_id, hunter_id')
        .eq('id', body.request_id)
        .maybeSingle()
      if (!request || request.bounty_id !== bounty.id) {
        return reply({ error: 'That application is not on this bounty.', code: 'not_found' }, 404)
      }

      // Same function, same checks, same token as the app's accept button.
      const resp = await fetch(`${supabaseUrl}/functions/v1/accept-bounty-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader, apikey: anonKey },
        body: JSON.stringify({ request_id: request.id }),
      })
      const result = await resp.json().catch(() => null)
      if (!resp.ok) {
        const message =
          resp.status === 409
            ? 'This bounty is no longer taking applications, or that application was withdrawn.'
            : resp.status === 402
              ? 'This bounty is not funded yet.'
              : 'We could not accept that hunter. Please try again.'
        return reply({ error: message, code: `accept_failed_${resp.status}` }, resp.status >= 500 ? 502 : resp.status)
      }

      // The hunter's "Bounty Accepted!" comes from the bounty_requests
      // trigger. The poster accepted on the web, so tell them what happens
      // next and give them the way to report a problem.
      const cards = await hunterCards([request.hunter_id])
      const hunterName = cards.get(request.hunter_id)?.name ?? 'Your hunter'
      await notify(
        userId,
        'Work is in progress',
        `${hunterName} is working on "${String(bounty.title ?? 'your bounty').slice(0, 80)}". ` +
          "We'll email you when they submit the work for your review. If something goes wrong, you can report a problem from your bounty page.",
        {
          type: 'update',
          subtype: 'work_in_progress',
          bounty_id: bounty.id,
          bountyId: bounty.id,
          ctaUrl: bountyPageUrl(bounty.id),
          ctaLabel: 'View your bounty',
        }
      )

      return reply({ ok: true, hunter_payout_ready: result?.hunterPayoutReady ?? null })
    }

    // ── POST /poster-web/approve ──────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/approve') {
      const body = await req.json().catch(() => ({}))
      const bounty = await loadOwnBounty(body?.bounty_id)
      if (!bounty) return reply({ error: 'We could not find that bounty on your account.', code: 'not_found' }, 404)

      const hunterId: string | null = bounty.accepted_by ?? null
      if (bounty.status === 'completed') return reply({ ok: true, already_completed: true })
      if (bounty.status !== 'in_progress' || !hunterId) {
        return reply({ error: 'This bounty has no work waiting for approval.', code: 'not_in_progress' }, 409)
      }
      const isPaid = !bounty.is_for_honor && Number(bounty.amount ?? 0) > 0
      if (isPaid && ![2, 3].includes(Number(bounty.payment_architecture_version))) {
        return reply({ error: 'Approve this bounty in the Bounty app.', code: 'use_app' }, 409)
      }
      if (await activeDispute(bounty.id)) {
        return reply(
          { error: 'There is an open dispute on this bounty. Bounty support will resolve it with you.', code: 'disputed' },
          409
        )
      }
      const submission = await latestSubmission(bounty.id, hunterId)
      if (!submission || submission.status !== 'pending') {
        return reply({ error: 'The hunter has not submitted work for review yet.', code: 'no_pending_submission' }, 409)
      }

      // 1. Money first. Same endpoint and token as the app.
      if (isPaid) {
        const resp = await fetch(`${supabaseUrl}/functions/v1/bounty-payments/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader, apikey: anonKey },
          body: JSON.stringify({ bountyId: bounty.id, hunterId }),
        })
        const outcome = interpretReleaseResponse(resp.status, await resp.json().catch(() => null))
        if (!outcome.ok) {
          if (isHunterPayoutSetupFailure(outcome.code)) {
            await notify(
              hunterId,
              'Finish payout setup to get paid',
              `Your work on "${String(bounty.title ?? 'a bounty').slice(0, 80)}" was approved. Finish payout setup in the Bounty app and the payment will be sent to you.`,
              { type: 'payment', subtype: 'payout_setup_needed', bounty_id: bounty.id, bountyId: bounty.id }
            )
          }
          console.warn('[poster-web] release refused', { bountyId: bounty.id, code: outcome.code })
          return reply({ error: outcome.message, code: outcome.code }, outcome.httpStatus === 401 ? 401 : 409)
        }
      }

      // 2. Then the approval. trg_completion_review_notification sends the
      //    hunter "Work Approved!" on this transition.
      const now = new Date().toISOString()
      const { error: subErr } = await admin
        .from('completion_submissions')
        .update({ status: 'approved', reviewed_at: now })
        .eq('id', submission.id)
        .eq('status', 'pending')
      if (subErr) {
        console.error('[poster-web] CRITICAL: released but could not approve submission; retry is safe', {
          bountyId: bounty.id,
          submissionId: submission.id,
          subErr,
        })
        return reply({ error: 'Payment sent, but we could not finish saving your approval. Please try again.', code: 'approve_write_failed', retryable: true }, 500)
      }

      const { error: bountyErr } = await admin
        .from('bounties')
        .update({ status: 'completed', completed_at: now })
        .eq('id', bounty.id)
        .eq('status', 'in_progress')
      if (bountyErr) {
        console.error('[poster-web] CRITICAL: approved but could not complete bounty; retry is safe', {
          bountyId: bounty.id,
          bountyErr,
        })
        return reply({ error: 'Payment sent, but we could not finish saving your approval. Please try again.', code: 'complete_write_failed', retryable: true }, 500)
      }

      return reply({ ok: true })
    }

    // ── POST /poster-web/dispute ──────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/dispute') {
      const body = await req.json().catch(() => ({}))
      const bounty = await loadOwnBounty(body?.bounty_id)
      if (!bounty) return reply({ error: 'We could not find that bounty on your account.', code: 'not_found' }, 404)

      const input = validateDisputeInput(body)
      if (!input.ok) return reply({ error: input.error, code: input.code }, 400)

      const hunterId: string | null = bounty.accepted_by ?? null
      if (bounty.status !== 'in_progress' || !hunterId) {
        return reply({ error: 'You can report a problem once a hunter is working on this bounty.', code: 'not_in_progress' }, 409)
      }
      if (await activeDispute(bounty.id)) {
        return reply({ error: 'You already reported a problem on this bounty. Bounty support is on it.', code: 'already_disputed' }, 409)
      }
      const submission = await latestSubmission(bounty.id, hunterId)

      const row: Record<string, unknown> = {
        bounty_id: bounty.id,
        initiator_id: userId,
        respondent_id: hunterId,
        reason: input.reason,
        dispute_stage: submission?.status === 'pending' ? 'review_verify' : 'in_progress',
        evidence_json: null,
        status: 'open',
        ...(input.reasonCode ? { reason_code: input.reasonCode } : {}),
      }
      let { error } = await asPoster.from('bounty_disputes').insert(row)
      // Before 20261002120100 there is no reason_code column; the dispute
      // matters more than its category (as in dispute-service).
      if (error && input.reasonCode && (error as any).code === 'PGRST204') {
        const { reason_code: _omit, ...withoutCode } = row
        ;({ error } = await asPoster.from('bounty_disputes').insert(withoutCode))
      }
      if (error) {
        console.error('[poster-web] dispute insert failed', { bountyId: bounty.id, error })
        return reply({ error: 'We could not file your report. Please try again.', code: 'dispute_failed' }, 400)
      }

      await notify(
        hunterId,
        'Dispute Raised',
        `A dispute has been raised for bounty: ${String(bounty.title ?? '').slice(0, 80)}`,
        { type: 'workflow_dispute_created', bounty_id: bounty.id, bountyId: bounty.id }
      )
      return reply({ ok: true })
    }

    return reply({ error: 'Not found', code: 'not_found' }, 404)
  } catch (err: any) {
    console.error('[poster-web] unhandled error', { subPath, message: err?.message })
    return reply({ error: 'Something went wrong. Please try again.', code: 'server_error' }, 500)
  }
})
