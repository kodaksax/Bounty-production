// Supabase Edge Function: web-account
//
// Web accounts on bountyfinder.net for people who never install the app:
// "My posts", "My work", and one thread per (bounty, hunter) with event cards.
//
//   GET  /web-account/overview                 My posts + My work, each with a stage
//   GET  /web-account/bounty?id=               one bounty: role, threads, payout state
//   GET  /web-account/thread?conversation_id=  messages + cards built from live state
//   POST /web-account/message        { conversation_id, text }     rate-limited
//   POST /web-account/accept         { request_id }   -> accept-bounty-request
//   POST /web-account/approve-release { bounty_id }   approve, then release
//   POST /web-account/finish         { bounty_id }    mark completed once release is confirmed
//   POST /web-account/payout-link    { bounty_id }    -> connect/create-account-link
//
// Decline, withdraw and "report a problem" are NOT here: the website does them
// with the same direct, RLS-checked table writes the app makes
// (bounty-request-service.rejectRequest, application-withdrawal,
// dispute-service.createWorkflowDispute).
//
// Money never moves in this function. approve-release forwards to the same
// release endpoint the app uses, with the poster's own token, routed by
// bounties.payment_architecture_version (1 -> wallet/release,
// 2 or 3 -> bounty-payments/release), so every check those endpoints make
// (poster ownership, payout readiness, Stripe idempotency, double-release
// guards) applies unchanged. What it adds is the link the release endpoints
// lack: it releases only after an approved submission exists, and it records
// the approval first, so "approved, not yet released" is a real, retryable
// state rather than a lost one.
//
// Threads and messages are read and written with the caller's token, so
// messages RLS (participants only, via my_conversation_ids()) decides who can
// see a thread. The service role is used only to read the state cards show,
// always scoped to a bounty the caller already proved they belong to.
//
// Depends on 20261009000000_bounty_thread_event_cards (messages.event_type /
// ref_id, fn_bounty_thread_id, fn_upsert_thread_event). Without it, threads
// are not created and cards are absent; everything else still works.

declare const Deno: any

// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  acceptedCard,
  appliedCard,
  bountyStage,
  type Card,
  type CardContext,
  EVENT_TYPES,
  type EventType,
  hunterNetCents,
  interpretPaymentsRelease,
  interpretWalletRelease,
  isUuid,
  type PayoutStage,
  payoutCard,
  payoutStageV1,
  payoutStageV2,
  payoutStageV3,
  platformFeePercent,
  rateLimited,
  releaseMayStart,
  releaseRoute,
  type Role,
  submittedCard,
  validateMessageText,
} from './logic.ts'

const DEFAULT_ALLOWED_ORIGINS = ['https://www.bountyfinder.net', 'https://bountyfinder.net']
const ACTIVE_DISPUTE_STATUSES = ['open', 'under_review', 'stripe_dispute']
const DEFAULT_REVIEW_WINDOW_HOURS = 72
const BOUNTY_COLUMNS =
  'id, title, description, amount, is_for_honor, status, work_type, location, created_at, completed_at, updated_at, poster_id, user_id, accepted_by, accepted_request_id, payment_architecture_version'

function resolveCorsHeaders(req: Request): Record<string, string> {
  const configured = (Deno.env.get('WEB_ACCOUNT_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean)
  const allowed = configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS
  const origin = req.headers.get('Origin') ?? ''
  return {
    // Echo the origin only when it is on the list; otherwise a value that
    // matches nothing, so the browser blocks the response.
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  }
}

const WEB_BOUNTY_URL_BASE = Deno.env.get('WEB_BOUNTY_URL_BASE') || 'https://www.bountyfinder.net/bounty'

function bountyPageUrl(bountyId: string, extra = ''): string {
  return `${WEB_BOUNTY_URL_BASE.replace(/\/+$/, '')}?id=${encodeURIComponent(bountyId)}${extra}`
}

function parseProofItems(raw: unknown, supabaseUrl: string) {
  let items: unknown = raw
  if (typeof raw === 'string') {
    try {
      items = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(items)) return []
  // Only files in this project's public storage; device-local paths are dropped.
  const publicPrefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/`
  const out: Array<{ name: string; type: 'image' | 'file'; url: string }> = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const url = [it.remoteUri, it.url].find(
      (u): u is string => typeof u === 'string' && u.startsWith(publicPrefix)
    )
    if (!url) continue
    out.push({
      name: typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 200) : 'Attachment',
      type: it.type === 'image' ? 'image' : 'file',
      url,
    })
  }
  return out
}

Deno.serve(async (req: Request) => {
  const cors = resolveCorsHeaders(req)
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const parts = url.pathname.split('/web-account')
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
  const { data: authData, error: authError } = await admin.auth.getUser(authHeader.substring(7))
  const user = authData?.user
  if (authError || !user) {
    return reply({ error: 'Your sign-in has expired. Please sign in again.', code: 'authentication_required' }, 401)
  }
  const userId: string = user.id

  // The caller's own client: RLS judges every read and write made with it.
  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })

  // Same variable, same default as the release endpoints.
  const feePercent = platformFeePercent(Deno.env.get('PLATFORM_FEE_PERCENT'))

  // ── loaders ──────────────────────────────────────────────────────────────

  async function loadBounty(bountyId: unknown) {
    if (!isUuid(bountyId)) return null
    const { data, error } = await admin.from('bounties').select(BOUNTY_COLUMNS).eq('id', bountyId).maybeSingle()
    if (error) throw error
    return data as any
  }

  const isPosterOf = (b: any) => b.poster_id === userId || b.user_id === userId

  async function myRequest(bountyId: string) {
    const { data, error } = await admin
      .from('bounty_requests')
      .select('id, status, created_at')
      .eq('bounty_id', bountyId)
      .eq('hunter_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data as any
  }

  async function roleFor(b: any): Promise<Role | null> {
    if (isPosterOf(b)) return 'poster'
    if (b.accepted_by === userId) return 'hunter'
    return (await myRequest(b.id)) ? 'hunter' : null
  }

  async function activeDispute(bountyId: string) {
    const { data } = await admin
      .from('bounty_disputes')
      .select('id, status, reason, created_at, initiator_id')
      .eq('bounty_id', bountyId)
      .in('status', ACTIVE_DISPUTE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as any) ?? null
  }

  async function latestSubmission(bountyId: string, hunterId: string | null) {
    if (!hunterId) return null
    const { data, error } = await admin
      .from('completion_submissions')
      .select('id, status, message, proof_items, submitted_at, revision_count, poster_feedback, reviewed_at')
      .eq('bounty_id', bountyId)
      .eq('hunter_id', hunterId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data as any
  }

  // Same rule accept-bounty-request reports as hunterPayoutReady.
  async function payoutReady(hunterIds: string[]): Promise<Map<string, boolean>> {
    const ids = [...new Set(hunterIds.filter(isUuid))]
    const out = new Map<string, boolean>()
    if (!ids.length) return out
    const { data } = await admin
      .from('profiles')
      .select('id, stripe_connect_account_id, stripe_connect_payouts_enabled')
      .in('id', ids)
    for (const p of (data ?? []) as any[]) {
      out.set(p.id, Boolean(p.stripe_connect_account_id) && p.stripe_connect_payouts_enabled === true)
    }
    return out
  }

  async function reviewWindowHours(): Promise<number> {
    const { data, error } = await admin.from('completion_review_policy').select('window_hours').maybeSingle()
    if (error || !data?.window_hours) return DEFAULT_REVIEW_WINDOW_HOURS
    return Number(data.window_hours)
  }

  // Payment state for many bounties at once: stage plus the receipt numbers.
  async function payments(bounties: any[]) {
    const out = new Map<string, { stage: PayoutStage; refId: string | null; receipt: Record<string, unknown> }>()
    const v1 = bounties.filter((b) => releaseRoute(b.payment_architecture_version) === 'wallet' && !b.is_for_honor)
    const v2 = bounties.filter((b) => Number(b.payment_architecture_version) === 2 && !b.is_for_honor)
    const v3 = bounties.filter((b) => Number(b.payment_architecture_version) === 3 && !b.is_for_honor)

    const baseReceipt = (b: any) => {
      const amountCents = Math.round(Number(b.amount || 0) * 100)
      const net = hunterNetCents(Number(b.amount || 0), feePercent)
      return { amount_cents: amountCents, fee_cents: amountCents - net, hunter_net_cents: net, fee_percent: feePercent }
    }

    const [bpRes, v3Res, v1Res] = await Promise.all([
      v2.length
        ? admin.from('bounty_payments')
            .select('id, bounty_id, status, stripe_transfer_id, amount, platform_fee_amount, updated_at')
            .in('bounty_id', v2.map((b) => b.id))
        : Promise.resolve({ data: [] }),
      v3.length
        ? admin.from('bounty_v3_funding')
            .select('bounty_id, state, stripe_transfer_id, amount_cents, platform_fee_cents, hunter_amount_cents, released_at, updated_at')
            .in('bounty_id', v3.map((b) => b.id))
        : Promise.resolve({ data: [] }),
      v1.length
        ? admin.from('wallet_transactions')
            .select('id, bounty_id, status, settlement_state, amount, created_at')
            .eq('type', 'release')
            .in('bounty_id', v1.map((b) => b.id))
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])

    for (const b of bounties) out.set(b.id, { stage: 'none', refId: null, receipt: baseReceipt(b) })
    for (const bp of ((bpRes as any).data ?? []) as any[]) {
      const receipt = baseReceipt(bounties.find((b) => b.id === bp.bounty_id))
      if (bp.platform_fee_amount != null) {
        // Recorded at release: the numbers that actually moved.
        receipt.amount_cents = Math.round(Number(bp.amount) * 100)
        receipt.fee_cents = Math.round(Number(bp.platform_fee_amount) * 100)
        receipt.hunter_net_cents = receipt.amount_cents - receipt.fee_cents
      }
      out.set(bp.bounty_id, { stage: payoutStageV2(bp), refId: bp.id, receipt: { ...receipt, updated_at: bp.updated_at } })
    }
    for (const f of ((v3Res as any).data ?? []) as any[]) {
      const receipt = baseReceipt(bounties.find((b) => b.id === f.bounty_id))
      if (f.hunter_amount_cents != null && f.platform_fee_cents != null) {
        receipt.amount_cents = Number(f.amount_cents)
        receipt.fee_cents = Number(f.platform_fee_cents)
        receipt.hunter_net_cents = Number(f.hunter_amount_cents)
      }
      out.set(f.bounty_id, { stage: payoutStageV3(f), refId: f.bounty_id, receipt: { ...receipt, updated_at: f.released_at ?? f.updated_at } })
    }
    for (const b of v1) {
      const tx = ((v1Res as any).data ?? []).find((t: any) => t.bounty_id === b.id) ?? null
      out.set(b.id, {
        stage: payoutStageV1(tx, Number(b.amount) > 0),
        refId: tx?.id ?? null,
        receipt: { ...baseReceipt(b), updated_at: tx?.created_at ?? null },
      })
    }
    return out
  }

  // Public card for a person: no contact details.
  async function people(ids: string[]) {
    const uniq = [...new Set(ids.filter(isUuid))]
    const out = new Map<string, any>()
    if (!uniq.length) return out
    const [{ data: profiles }, { data: ratings }, { data: done }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, display_name, full_name, username, avatar, id_verification_status, verified, created_at')
        .in('id', uniq),
      admin.from('ratings').select('to_user_id, rating').in('to_user_id', uniq).is('hidden_at', null),
      admin.from('bounties').select('accepted_by').in('accepted_by', uniq).eq('status', 'completed'),
    ])
    for (const p of (profiles ?? []) as any[]) {
      const own = ((ratings ?? []) as any[]).filter((r) => r.to_user_id === p.id)
      const avg = own.length ? own.reduce((s, r) => s + Number(r.rating || 0), 0) / own.length : null
      out.set(p.id, {
        id: p.id,
        name: p.display_name || p.full_name || p.username || 'Bounty member',
        avatar: typeof p.avatar === 'string' && p.avatar.startsWith('https://') ? p.avatar : null,
        id_verified: p.id_verification_status === 'verified' || p.verified === true,
        rating: avg === null ? null : Math.round(avg * 10) / 10,
        rating_count: own.length,
        jobs_completed: ((done ?? []) as any[]).filter((b) => b.accepted_by === p.id).length,
        member_since: p.created_at,
      })
    }
    return out
  }

  // Get-or-create the (bounty, hunter) thread. Null when the migration that
  // provides fn_bounty_thread_id is not applied yet.
  async function threadId(bountyId: string, hunterId: string): Promise<string | null> {
    const { data, error } = await admin.rpc('fn_bounty_thread_id', { p_bounty_id: bountyId, p_hunter_id: hunterId })
    if (error) {
      console.warn('[web-account] fn_bounty_thread_id unavailable', { code: error.code })
      return null
    }
    return (data as string) ?? null
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
    if (error) console.error('[web-account] notification enqueue failed', { type: data.type, error })
  }

  async function callFunction(path: string, body: unknown) {
    const resp = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: authHeader, apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    if (!resp) return { status: 502, body: { error: 'We couldn’t reach Bounty. Please try again.', code: 'upstream_unreachable' } }
    return { status: resp.status, body: await resp.json().catch(() => null) }
  }

  // Everything a card or a stage needs about one bounty and one hunter.
  async function bountyState(b: any, hunterId: string | null) {
    const [dispute, submission, pay, ready] = await Promise.all([
      activeDispute(b.id),
      latestSubmission(b.id, hunterId),
      payments([b]),
      payoutReady(hunterId ? [hunterId] : []),
    ])
    const p = pay.get(b.id)!
    return {
      dispute,
      submission,
      payoutStage: p.stage,
      payoutRefId: p.refId,
      receipt: p.receipt,
      hunterPayoutReady: hunterId ? (ready.get(hunterId) ?? false) : null,
    }
  }

  try {
    // ── GET /overview ────────────────────────────────────────────────────
    if (req.method === 'GET' && subPath === '/overview') {
      const [{ data: posts, error: postsErr }, { data: reqs, error: reqsErr }, { data: accepted, error: accErr }] =
        await Promise.all([
          admin.from('bounties').select(BOUNTY_COLUMNS)
            .or(`poster_id.eq.${userId},user_id.eq.${userId}`)
            .neq('status', 'deleted')
            .order('created_at', { ascending: false })
            .limit(50),
          admin.from('bounty_requests').select('id, bounty_id, status, created_at')
            .eq('hunter_id', userId)
            .order('created_at', { ascending: false })
            .limit(100),
          admin.from('bounties').select(BOUNTY_COLUMNS)
            .eq('accepted_by', userId)
            .neq('status', 'deleted')
            .order('updated_at', { ascending: false })
            .limit(50),
        ])
      if (postsErr || reqsErr || accErr) throw postsErr || reqsErr || accErr

      const workIds = new Set<string>(((accepted ?? []) as any[]).map((b) => b.id))
      const reqByBounty = new Map<string, any>()
      for (const r of (reqs ?? []) as any[]) if (!reqByBounty.has(r.bounty_id)) reqByBounty.set(r.bounty_id, r)
      const missing = [...reqByBounty.keys()].filter((id) => !workIds.has(id))
      const { data: applied } = missing.length
        ? await admin.from('bounties').select(BOUNTY_COLUMNS).in('id', missing).neq('status', 'deleted')
        : { data: [] as any[] }
      const work = [...((accepted ?? []) as any[]), ...((applied ?? []) as any[])]
      const all = [...((posts ?? []) as any[]), ...work]
      const ids = all.map((b) => b.id)

      const [pay, { data: pending }, { data: subs }, { data: disputes }, ready] = await Promise.all([
        payments(all),
        ids.length
          ? admin.from('bounty_requests').select('bounty_id').eq('status', 'pending').in('bounty_id', ((posts ?? []) as any[]).map((b) => b.id))
          : Promise.resolve({ data: [] }),
        ids.length
          ? admin.from('completion_submissions').select('bounty_id, hunter_id, status, submitted_at').in('bounty_id', ids)
              .order('submitted_at', { ascending: false, nullsFirst: false })
          : Promise.resolve({ data: [] }),
        ids.length
          ? admin.from('bounty_disputes').select('bounty_id').in('bounty_id', ids).in('status', ACTIVE_DISPUTE_STATUSES)
          : Promise.resolve({ data: [] }),
        payoutReady(all.map((b) => b.accepted_by).filter(Boolean)),
      ])

      const item = (b: any, role: Role) => {
        const sub = ((subs ?? []) as any[]).find((s) => s.bounty_id === b.id && s.hunter_id === b.accepted_by)
        const isAcceptedHunter = b.accepted_by === userId
        const { stage, label } = bountyStage({
          role,
          bountyStatus: b.status,
          requestStatus: reqByBounty.get(b.id)?.status ?? null,
          isAcceptedHunter,
          pendingApplications: ((pending ?? []) as any[]).filter((p) => p.bounty_id === b.id).length,
          submissionStatus: role === 'poster' || isAcceptedHunter ? (sub?.status ?? null) : null,
          hasActiveDispute: ((disputes ?? []) as any[]).some((d) => d.bounty_id === b.id),
          payoutStage: pay.get(b.id)?.stage ?? 'none',
          hunterPayoutReady: b.accepted_by ? (ready.get(b.accepted_by) ?? false) : null,
          isForHonor: Boolean(b.is_for_honor),
        })
        return {
          id: b.id,
          title: b.title,
          amount: b.amount,
          is_for_honor: b.is_for_honor,
          status: b.status,
          stage,
          stage_label: label,
          // The hunter's figure is what they receive, from the server's fee.
          hunter_net_cents: b.is_for_honor ? 0 : (pay.get(b.id)?.receipt.hunter_net_cents ?? null),
          updated_at: b.updated_at,
        }
      }

      return reply({
        me: { id: userId, email: user.email ?? null },
        posts: ((posts ?? []) as any[]).map((b) => item(b, 'poster')),
        work: work.map((b) => item(b, 'hunter')),
      })
    }

    // ── GET /bounty?id= ──────────────────────────────────────────────────
    if (req.method === 'GET' && subPath === '/bounty') {
      const b = await loadBounty(url.searchParams.get('id'))
      const role = b ? await roleFor(b) : null
      if (!b || !role) return reply({ error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404)

      const state = await bountyState(b, b.accepted_by ?? null)
      const base = {
        bounty: {
          id: b.id,
          title: b.title,
          description: b.description,
          amount: b.amount,
          is_for_honor: b.is_for_honor,
          status: b.status,
          work_type: b.work_type,
          location: b.location,
          created_at: b.created_at,
        },
        role,
        fee_percent: feePercent,
        hunter_net_cents: b.is_for_honor ? 0 : state.receipt.hunter_net_cents,
        // Only the poster and the hired hunter see where the money is.
        payout_stage: role === 'poster' || b.accepted_by === userId ? state.payoutStage : null,
        has_active_dispute: Boolean(state.dispute),
      }

      if (role === 'hunter') {
        const [tid, cards] = await Promise.all([threadId(b.id, userId), people([b.poster_id])])
        return reply({
          ...base,
          accepted_hunter_is_me: b.accepted_by === userId,
          threads: [{ conversation_id: tid, counterpart: cards.get(b.poster_id) ?? null }],
          payouts_ready: (await payoutReady([userId])).get(userId) ?? false,
        })
      }

      const { data: requests, error: reqErr } = await admin
        .from('bounty_requests')
        .select('id, hunter_id, status, message, created_at')
        .eq('bounty_id', b.id)
        .order('created_at', { ascending: true })
      if (reqErr) throw reqErr
      const hunterIds = [...new Set([
        ...(b.accepted_by ? [b.accepted_by] : []),
        ...((requests ?? []) as any[]).map((r) => r.hunter_id).filter(Boolean),
      ])]
      const [cards, tids] = await Promise.all([
        people(hunterIds),
        Promise.all(hunterIds.map((h) => threadId(b.id, h))),
      ])
      const order = (h: string) => {
        const r = ((requests ?? []) as any[]).find((x) => x.hunter_id === h)
        return h === b.accepted_by ? 0 : r?.status === 'pending' ? 1 : 2
      }
      const threads = hunterIds
        .map((h, i) => {
          const r = ((requests ?? []) as any[]).find((x) => x.hunter_id === h) ?? null
          return {
            conversation_id: tids[i],
            counterpart: cards.get(h) ?? null,
            request_id: r?.id ?? null,
            request_status: h === b.accepted_by ? 'accepted' : (r?.status ?? null),
            applied_at: r?.created_at ?? null,
          }
        })
        .sort((x, y) => order(x.counterpart?.id) - order(y.counterpart?.id))
      return reply({ ...base, threads })
    }

    // ── GET /thread?conversation_id= ──────────────────────────────────────
    if (req.method === 'GET' && subPath === '/thread') {
      const cid = url.searchParams.get('conversation_id')
      if (!isUuid(cid)) return reply({ error: 'Unknown conversation.', code: 'not_found' }, 404)

      // RLS: a conversation is visible only to its participants.
      const { data: conv } = await asUser.from('conversations').select('id, bounty_id').eq('id', cid).maybeSingle()
      if (!conv?.bounty_id) return reply({ error: 'Unknown conversation.', code: 'not_found' }, 404)
      const b = await loadBounty(conv.bounty_id)
      if (!b) return reply({ error: 'Unknown conversation.', code: 'not_found' }, 404)

      const posterId = b.poster_id
      const { data: parts } = await admin
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', cid)
      const hunterId = ((parts ?? []) as any[]).map((p) => p.user_id).find((u) => u !== posterId) ?? null
      const role: Role = userId === posterId ? 'poster' : 'hunter'
      if (role === 'hunter' && userId !== hunterId) return reply({ error: 'Unknown conversation.', code: 'not_found' }, 404)

      let msgs: any[] = []
      {
        const { data, error } = await asUser
          .from('messages')
          .select('id, sender_id, text, created_at, updated_at, message_type, event_type, ref_id')
          .eq('conversation_id', cid)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(200)
        if (error) throw error
        msgs = ((data ?? []) as any[]).reverse()
      }

      const isThreadHunterAccepted = hunterId !== null && b.accepted_by === hunterId
      const state = await bountyState(b, hunterId)
      const net = b.is_for_honor ? 0 : Number(state.receipt.hunter_net_cents)
      const ctx: CardContext = {
        role,
        bountyStatus: b.status,
        isForHonor: Boolean(b.is_for_honor),
        hasActiveDispute: Boolean(state.dispute),
        payoutStage: isThreadHunterAccepted ? state.payoutStage : 'none',
        hunterPayoutReady: state.hunterPayoutReady,
        hunterNetCents: net,
      }

      // Live rows every card points at, each re-checked against this thread's
      // bounty and hunter. A card whose row belongs elsewhere is dropped.
      const refIds = (t: EventType) => msgs.filter((m) => m.event_type === t && isUuid(m.ref_id)).map((m) => m.ref_id)
      const reqIds = [...new Set([...refIds('applied'), ...refIds('accepted')])]
      const subIds = refIds('submitted')
      const [{ data: reqRows }, { data: subRows }, windowHours, cards] = await Promise.all([
        reqIds.length ? admin.from('bounty_requests').select('id, bounty_id, hunter_id, status, message').in('id', reqIds) : Promise.resolve({ data: [] }),
        subIds.length
          ? admin.from('completion_submissions').select('id, bounty_id, hunter_id, status, message, proof_items, submitted_at, revision_count, poster_feedback').in('id', subIds)
          : Promise.resolve({ data: [] }),
        reviewWindowHours(),
        people([posterId, hunterId].filter(Boolean) as string[]),
      ])
      const own = (row: any) => row && row.bounty_id === b.id && row.hunter_id === hunterId

      const items: any[] = []
      for (const m of msgs) {
        const mine = m.sender_id === userId
        if (m.message_type !== 'system' || !EVENT_TYPES.includes(m.event_type)) {
          if (m.message_type === 'system') continue // legacy system text without a card
          items.push({ kind: 'message', id: m.id, mine, text: m.text, created_at: m.created_at })
          continue
        }
        let card: Card | null = null
        if (m.event_type === 'applied') {
          const r = ((reqRows ?? []) as any[]).find((x) => x.id === m.ref_id) ?? null
          if (r && !own(r)) continue
          card = appliedCard(r, ctx)
          if (r?.message) card.detail = { message: r.message, request_id: r.id }
          else if (r) card.detail = { request_id: r.id }
        } else if (m.event_type === 'accepted') {
          const r = ((reqRows ?? []) as any[]).find((x) => x.id === m.ref_id)
          if (!own(r)) continue
          card = acceptedCard(ctx)
        } else if (m.event_type === 'submitted') {
          const s = ((subRows ?? []) as any[]).find((x) => x.id === m.ref_id) ?? null
          if (s && !own(s)) continue
          card = submittedCard(s, ctx)
          if (s) {
            const submittedMs = s.submitted_at ? Date.parse(s.submitted_at) : NaN
            card.detail = {
              ...card.detail,
              message: s.message ?? null,
              proof: parseProofItems(s.proof_items, supabaseUrl),
              submitted_at: s.submitted_at,
              revision_count: s.revision_count ?? 0,
              poster_feedback: s.poster_feedback ?? null,
              review_deadline: Number.isNaN(submittedMs) ? null : new Date(submittedMs + windowHours * 3600e3).toISOString(),
            }
          }
        } else if (m.event_type === 'payout') {
          if (!isThreadHunterAccepted || m.ref_id !== state.payoutRefId) continue
          card = payoutCard(ctx, state.receipt)
        }
        if (card) {
          items.push({
            kind: 'card',
            id: m.id,
            mine,
            created_at: m.created_at,
            updated_at: m.updated_at,
            ref_id: m.ref_id,
            card,
          })
        }
      }

      // Best-effort read receipt on the caller's own participant row.
      await asUser
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', cid)
        .eq('user_id', userId)

      const counterpartId = role === 'poster' ? hunterId : posterId
      return reply({
        conversation_id: cid,
        bounty: { id: b.id, title: b.title, status: b.status, is_for_honor: b.is_for_honor },
        role,
        counterpart: counterpartId ? (cards.get(counterpartId) ?? null) : null,
        hunter_id: hunterId,
        items,
      })
    }

    // ── POST /message ────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/message') {
      const body = await req.json().catch(() => ({}))
      if (!isUuid(body?.conversation_id)) return reply({ error: 'Unknown conversation.', code: 'not_found' }, 404)
      const v = validateMessageText(body?.text)
      if (!v.ok) return reply({ error: v.error, code: 'invalid_message' }, 400)

      const since = (ms: number) => new Date(Date.now() - ms).toISOString()
      const [{ count: lastMinute }, { count: lastHour }] = await Promise.all([
        admin.from('messages').select('id', { count: 'exact', head: true }).eq('sender_id', userId).gte('created_at', since(60e3)),
        admin.from('messages').select('id', { count: 'exact', head: true }).eq('sender_id', userId).gte('created_at', since(3600e3)),
      ])
      if (rateLimited(lastMinute ?? 0, lastHour ?? 0)) {
        return reply({ error: 'You’re sending messages too quickly. Wait a minute and try again.', code: 'rate_limited' }, 429)
      }

      // RLS decides: participant, active account, no block in the thread.
      const { data, error } = await asUser
        .from('messages')
        .insert({ conversation_id: body.conversation_id, sender_id: userId, text: v.text })
        .select('id, created_at')
        .single()
      if (error || !data) {
        return reply({ error: 'You can’t send messages in this conversation.', code: 'forbidden' }, 403)
      }
      return reply({ id: data.id, created_at: data.created_at })
    }

    // ── POST /accept ─────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/accept') {
      const body = await req.json().catch(() => ({}))
      if (!isUuid(body?.request_id)) return reply({ error: 'Unknown application.', code: 'not_found' }, 404)
      // accept-bounty-request checks the caller is the poster and reserves
      // funding in the same transaction as the acceptance.
      const res = await callFunction('accept-bounty-request', { request_id: body.request_id })
      if (res.status !== 200) {
        const msg =
          res.status === 409 ? 'This application can’t be accepted any more — the bounty may already have a hunter.'
          : res.status === 402 ? 'This bounty isn’t funded yet, so nobody can be accepted.'
          : res.status === 403 || res.status === 404 ? 'We couldn’t find that application on your bounty.'
          : 'We couldn’t accept this application. Please try again.'
        return reply({ error: msg, code: `accept_${res.status}` }, res.status >= 400 ? res.status : 502)
      }
      return reply({ accepted: true, hunterPayoutReady: res.body?.hunterPayoutReady ?? null })
    }

    // ── POST /approve-release ────────────────────────────────────────────
    // Idempotent: approve (pending -> approved) if not already, then release.
    // Safe to repeat at any point; each release endpoint is idempotent itself.
    if (req.method === 'POST' && subPath === '/approve-release') {
      const body = await req.json().catch(() => ({}))
      const b = await loadBounty(body?.bounty_id)
      if (!b || !isPosterOf(b)) return reply({ error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404)
      if (!b.accepted_by) return reply({ error: 'Nobody is working on this bounty yet.', code: 'no_hunter' }, 409)
      if (!['in_progress', 'completed'].includes(b.status)) {
        return reply({ error: 'This bounty is not in progress.', code: 'invalid_status' }, 409)
      }

      const state = await bountyState(b, b.accepted_by)
      if (state.dispute) {
        return reply({ error: 'A problem is open on this bounty. Bounty support will resolve it first.', code: 'dispute_open' }, 409)
      }
      const sub = state.submission
      if (!sub || !['pending', 'approved'].includes(sub.status)) {
        return reply({ error: 'There’s no submitted work to approve yet.', code: 'no_submission' }, 409)
      }

      // 1. Approve, with the poster's own token (the same write the app makes).
      if (sub.status === 'pending') {
        const { error } = await asUser
          .from('completion_submissions')
          .update({ status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', sub.id)
          .eq('status', 'pending')
        if (error) {
          console.error('[web-account] approve failed', { bountyId: b.id, error })
          return reply({ error: 'We couldn’t save your approval. Nothing was released. Please try again.', code: 'approve_failed' }, 500)
        }
      }

      const completeBounty = async () => {
        // trg_bounties_a_paid_completion_guard allows this only once a release
        // is confirmed (20261005010000); a refusal just leaves it in_progress.
        const { error } = await asUser
          .from('bounties')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', b.id)
          .eq('status', 'in_progress')
        if (error) console.warn('[web-account] could not mark completed yet', { bountyId: b.id, code: error.code })
      }

      if (b.is_for_honor) {
        await completeBounty()
        return reply({ state: 'approved_done' })
      }

      // 2. Release, unless it already happened or is under way.
      if (!releaseMayStart(state.payoutStage)) {
        if (state.payoutStage === 'paid' || state.payoutStage === 'balance_credited') await completeBounty()
        return reply({ state: state.payoutStage === 'sending' ? 'approved_sending' : 'approved_done', payout_stage: state.payoutStage })
      }

      const route = releaseRoute(b.payment_architecture_version)
      if (!route) {
        return reply({ error: 'This bounty can’t be paid out from the website. Please contact support.', code: 'unsupported_payment' }, 409)
      }
      const res = route === 'wallet'
        ? await callFunction('wallet/release', { bountyId: b.id, idempotencyKey: `web_release_${sub.id}` })
        : await callFunction('bounty-payments/release', { bountyId: b.id })
      const outcome = route === 'wallet'
        ? interpretWalletRelease(res.status, res.body)
        : interpretPaymentsRelease(res.status, res.body)

      if (!outcome.ok) {
        console.warn('[web-account] release refused', { bountyId: b.id, code: outcome.code })
        if (outcome.waitingOnHunter) {
          await notify(
            b.accepted_by,
            'Set up payouts to receive your payment',
            `Your work on "${String(b.title ?? 'a bounty').slice(0, 80)}" was approved. Set up payouts and the payment will be sent to you.`,
            { type: 'payout_setup_required', bounty_id: b.id, ctaUrl: bountyPageUrl(b.id), ctaLabel: 'Set up payouts' }
          )
          return reply({ state: 'approved_waiting_on_hunter', message: outcome.message })
        }
        return reply({ error: outcome.message, code: outcome.code, state: 'approved_not_released' }, outcome.httpStatus)
      }

      // 3. v1 has no trigger-written payout card (the v1 ledger is left as
      //    is), so record it here, pointing at the release ledger row.
      if (route === 'wallet') {
        let txId = outcome.transactionId
        if (!txId) {
          const { data } = await admin.from('wallet_transactions').select('id')
            .eq('bounty_id', b.id).eq('type', 'release').eq('status', 'completed')
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          txId = (data as any)?.id ?? null
        }
        if (txId) {
          const { error } = await admin.rpc('fn_upsert_thread_event', {
            p_bounty_id: b.id,
            p_hunter_id: b.accepted_by,
            p_event_type: 'payout',
            p_ref_id: txId,
            p_sender_id: userId,
            p_fallback_text: 'Released the payment.',
          })
          if (error) console.warn('[web-account] v1 payout card not recorded', { bountyId: b.id, code: error.code })
        }
      }

      if (outcome.state === 'paid' || outcome.state === 'balance_credited') await completeBounty()
      return reply({ state: outcome.state === 'sending' ? 'approved_sending' : 'approved_done', payout_stage: outcome.state })
    }

    // ── POST /finish ─────────────────────────────────────────────────────
    // A v2/v3 release is confirmed later by Stripe's webhook, which does not
    // complete the bounty. The page calls this when it sees "paid" on a bounty
    // still in progress. Moves no money.
    if (req.method === 'POST' && subPath === '/finish') {
      const body = await req.json().catch(() => ({}))
      const b = await loadBounty(body?.bounty_id)
      if (!b || !isPosterOf(b)) return reply({ error: 'We couldn’t find that bounty on your account.', code: 'not_found' }, 404)
      if (b.status !== 'in_progress') return reply({ completed: b.status === 'completed' })
      const state = await bountyState(b, b.accepted_by ?? null)
      if (state.submission?.status !== 'approved' || !['paid', 'balance_credited'].includes(state.payoutStage)) {
        return reply({ completed: false })
      }
      const { error } = await asUser
        .from('bounties')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', b.id)
        .eq('status', 'in_progress')
      return reply({ completed: !error })
    }

    // ── POST /payout-link ────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/payout-link') {
      const body = await req.json().catch(() => ({}))
      const back = isUuid(body?.bounty_id) ? bountyPageUrl(body.bounty_id, '&payouts=') : `${WEB_BOUNTY_URL_BASE}?payouts=`
      const res = await callFunction('connect/create-account-link', {
        returnUrl: `${back}done`,
        refreshUrl: `${back}refresh`,
      })
      const link = typeof res.body?.url === 'string' && res.body.url.startsWith('https://') ? res.body.url : null
      if (res.status !== 200 || !link) {
        return reply({ error: 'We couldn’t open payout setup. Please try again.', code: 'payout_link_failed' }, 502)
      }
      return reply({ url: link })
    }

    return reply({ error: 'Not found', code: 'not_found' }, 404)
  } catch (err) {
    console.error('[web-account] unhandled', err)
    return reply({ error: 'Something went wrong. Please try again.', code: 'server_error' }, 500)
  }
})
