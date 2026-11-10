// Supabase Edge Function: bounty-checkout
//
// Public "Post a Bounty" intake for https://www.bountyfinder.net/#post.
//
// FLOW
//   website form -> POST /bounty-checkout
//                    - validate every field server-side
//                    - INSERT pending_bounties (durable, status pending_payment)
//                    - create a Stripe Checkout Session priced from the
//                      STORED amount, carrying only the pending id
//                  -> { checkout_url, pending_bounty_id }
//   website redirects the customer to checkout_url
//   customer pays -> Stripe -> `webhooks` function -> account + bounty + escrow
//
//   When payment_experiment_config.web_card_at_post_enabled is true the session
//   is mode 'setup' instead: the customer saves a card and pays nothing, the
//   webhook creates a v1 at_accept bounty, and accept-bounty-request charges the
//   card when a hunter is accepted. The switch is read here on every request; a
//   client cannot choose the mode.
//
// WHY A SERVER-CREATED CHECKOUT SESSION AND NOT A PAYMENT LINK
//   Passing the reference is NOT the problem: Stripe officially supports
//   appending `?client_reference_id=<value>` to a Payment Link URL
//   (alphanumeric/dashes/underscores, <=200 chars - a UUID qualifies) and
//   returns it on checkout.session.completed. That part would work fine.
//
//   The blocker is the AMOUNT. A Payment Link is bound to a Price. The only
//   variable-amount option is "customer chooses what to pay", where the
//   *customer* types the number - so someone could pay $1 for a $150 bounty.
//   Since the charge must equal the server-validated bounty amount, a single
//   static Payment Link cannot be used.
//
// LOCATION
//   An in-person bounty needs a point, not just text: public.bounties.geom
//   drives nearby search and the radius/service-area notifications. The
//   website sends latitude/longitude from the address picked in its
//   autocomplete. A caller that sends only text (older clients) is geocoded
//   here, best-effort. fn_create_bounty_from_pending copies the point into
//   bounties, whose privacy trigger keeps the exact point private.
//
// Routes:
//   POST /bounty-checkout            - the Sintra integration point
//   POST /bounty-checkout/create-session  - alias (back-compat)
//   GET  /bounty-checkout/status?pending_bounty_id=... | ?session_id=cs_...
//   GET  /bounty-checkout/config  which mode a post gets now, so the form's copy is true
//   GET  /bounty-checkout/shortfall?request_id=...  (signed in) what hiring still needs
//   POST /bounty-checkout/shortfall  { request_id } (signed in) Checkout for that amount
//
// This function NEVER creates an account, a bounty, or a payment record. Only
// the signature-verified webhook does. See docs/payments/SINTRA_INTEGRATION.md.

declare const Deno: any

// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore: Allow runtime npm import for Deno/edge function.
import Stripe from 'npm:stripe@14'
import { isUuid, webManageLink } from '../_shared/web-links.ts'
import {
  buildCheckoutSessionParams,
  buildShortfallSessionParams,
  checkoutModeForSwitch,
  checkoutReturnUrls,
  shortfallChargeCents,
  shortfallIdempotencyKey,
} from './logic.ts'

// The public website calls this from a browser, so CORS has to allow its
// origin. Prefer an explicit allowlist (BOUNTY_CHECKOUT_ALLOWED_ORIGINS,
// comma-separated) over '*' - this endpoint writes rows and creates Stripe
// objects, so it should not be callable from any page on the internet.
function resolveCorsHeaders(req: Request): Record<string, string> {
  const configured = (Deno.env.get('BOUNTY_CHECKOUT_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o: string) => o.trim())
    .filter(Boolean)

  const requestOrigin = req.headers.get('Origin') ?? ''
  let allowOrigin = '*'

  if (configured.length > 0) {
    // Echo the origin only when it is on the list; otherwise send a value that
    // matches nothing so the browser blocks the response.
    allowOrigin = configured.includes(requestOrigin) ? requestOrigin : configured[0]
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    Vary: 'Origin',
  }
}

function jsonResponse(data: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const DB_TIMEOUT_MS = 8000
function withDbTimeout<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('DB_TIMEOUT'), { code: 'DB_TIMEOUT' })), DB_TIMEOUT_MS)
    ),
  ])
}

// Mirrors bounty-payments/index.ts: strip angle brackets, trim, bound length.
function sanitizeText(input: unknown, maxLen = 1000): string {
  if (!input) return ''
  return String(input).replace(/[<>]/g, '').trim().slice(0, maxLen)
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/
  return emailRegex.test(email)
}

// Amount guardrails for a publicly writable endpoint.
const MIN_BOUNTY_AMOUNT = 5
const MAX_BOUNTY_AMOUNT = 10000

// Abuse throttle: submissions per email per hour.
const MAX_SUBMISSIONS_PER_EMAIL_PER_HOUR = 10

// public.bounties.work_type is work_type_enum NOT NULL. We require it rather
// than defaulting, so an in-person job is never silently posted as online.
const WORK_TYPES = ['online', 'in_person'] as const
type WorkType = (typeof WORK_TYPES)[number]

interface BountyDraft {
  email: string
  contactName: string
  title: string
  description: string
  amount: number
  workType: WorkType
  location: string
  latitude: number | null
  longitude: number | null
  zipCode: string | null
  neighborhood: string | null
  category: string
  deadline: string | null
}

function toCoordinate(raw: unknown, limit: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  return isFinite(n) && Math.abs(n) <= limit ? n : NaN
}

/**
 * Validates the submission BEFORE anything is stored or charged. This is the
 * authoritative validation: a bad submission never becomes a payment, so the
 * "paid but unprocessable" case stays vanishingly rare.
 */
function validateSubmission(body: any): { draft?: BountyDraft; error?: string; code?: string } {
  const email = sanitizeText(body?.email ?? body?.customer_email, 320).toLowerCase()
  if (!email || !isValidEmail(email)) {
    return { error: 'A valid email address is required.', code: 'invalid_email' }
  }

  const title = sanitizeText(body?.title ?? body?.bounty_title, 200)
  if (title.length < 3) {
    return { error: 'A bounty title of at least 3 characters is required.', code: 'invalid_title' }
  }

  // REQUIRED: public.bounties.description is NOT NULL in production, so an
  // empty description would fail the insert *after* the customer is charged.
  const description = sanitizeText(body?.description ?? body?.bounty_description, 5000)
  if (description.length < 10) {
    return {
      error: 'A bounty description of at least 10 characters is required.',
      code: 'invalid_description',
    }
  }

  // REQUIRED: never guess between an online and an in-person job.
  const rawWorkType = sanitizeText(body?.work_type ?? body?.workType, 20).toLowerCase()
  if (!WORK_TYPES.includes(rawWorkType as WorkType)) {
    return {
      error: 'work_type is required and must be either "online" or "in_person".',
      code: 'invalid_work_type',
    }
  }
  const workType = rawWorkType as WorkType

  const rawAmount = body?.amount ?? body?.bounty_amount
  const amount = typeof rawAmount === 'string' ? Number(rawAmount.replace(/[$,\s]/g, '')) : Number(rawAmount)
  if (!isFinite(amount) || amount <= 0) {
    return { error: 'Bounty amount must be a number greater than zero.', code: 'invalid_amount' }
  }
  if (amount < MIN_BOUNTY_AMOUNT) {
    return { error: `Bounty amount must be at least $${MIN_BOUNTY_AMOUNT}.`, code: 'amount_too_small' }
  }
  if (amount > MAX_BOUNTY_AMOUNT) {
    return { error: `Bounty amount cannot exceed $${MAX_BOUNTY_AMOUNT.toLocaleString()}.`, code: 'amount_too_large' }
  }
  // Reject sub-cent precision rather than silently rounding someone's money.
  const rounded = Math.round(amount * 100) / 100
  if (rounded !== amount) {
    return { error: 'Bounty amount cannot have more than two decimal places.', code: 'invalid_amount_precision' }
  }

  const contactName = sanitizeText(body?.name ?? body?.contact_name, 120)
  const location = sanitizeText(body?.location ?? body?.bounty_location, 300)
  const category = sanitizeText(body?.category ?? body?.bounty_category, 100)

  // Optional, but both-or-neither and in range. Online work never keeps one.
  let latitude = toCoordinate(body?.latitude ?? body?.lat, 90)
  let longitude = toCoordinate(body?.longitude ?? body?.lng ?? body?.lon, 180)
  if (Number.isNaN(latitude) || Number.isNaN(longitude) || (latitude === null) !== (longitude === null)) {
    return { error: 'That location could not be read. Pick the address again.', code: 'invalid_coordinates' }
  }
  const rawZip = sanitizeText(body?.zip_code ?? body?.zipCode, 10)
  let zipCode = /^\d{5}$/.test(rawZip) ? rawZip : null
  let neighborhood = sanitizeText(body?.neighborhood, 120) || null
  if (workType === 'online') {
    latitude = longitude = null
    zipCode = neighborhood = null
  }

  let deadline: string | null = null
  const rawDeadline = body?.deadline ?? body?.bounty_deadline
  if (rawDeadline) {
    const parsed = new Date(String(rawDeadline))
    if (isNaN(parsed.getTime())) {
      return { error: 'Deadline must be a valid date.', code: 'invalid_deadline' }
    }
    if (parsed.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      return { error: 'Deadline cannot be in the past.', code: 'deadline_in_past' }
    }
    deadline = parsed.toISOString()
  }

  return {
    draft: {
      email, contactName, title, description, amount, workType, location,
      latitude, longitude, zipCode, neighborhood, category, deadline,
    },
  }
}

// Best-effort fallback for callers that send an address as text only. Same
// source as the website's autocomplete (Photon / OpenStreetMap), biased to
// the DMV and limited to the US. Never blocks a post: no answer = no point.
const GEOCODE_TIMEOUT_MS = 3000
// Kept in step with assets/app.js (5a): Photon needs "Road", not "rd", and
// transit stops share every street name.
const STREET_WORDS: Record<string, string> = {
  st: 'Street', rd: 'Road', ave: 'Avenue', av: 'Avenue', blvd: 'Boulevard', dr: 'Drive',
  ln: 'Lane', ct: 'Court', pl: 'Place', ter: 'Terrace', terr: 'Terrace', pkwy: 'Parkway',
  hwy: 'Highway', cir: 'Circle', sq: 'Square',
  nw: 'Northwest', ne: 'Northeast', sw: 'Southwest', se: 'Southeast',
  n: 'North', s: 'South', e: 'East', w: 'West',
}
const GEOCODE_JUNK = ['bus_stop', 'bicycle_rental', 'platform', 'stop_position', 'station', 'charging_station', 'parking_entrance']
function expandAddress(q: string): string {
  const words = q.replace(/\./g, '').replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  return words
    .map((w, i) => {
      const k = w.toLowerCase()
      if (k.length === 1 && /^(st|street)$/i.test(words[i + 1] ?? '')) return w
      return STREET_WORDS[k] ?? w
    })
    .join(' ')
}
async function geocodeLocation(
  text: string
): Promise<{ latitude: number; longitude: number; zipCode: string | null; neighborhood: string | null } | null> {
  if (text.length < 3) return null
  const url = 'https://photon.komoot.io/api/?limit=10&lang=en&lat=38.9072&lon=-77.0369&q=' + encodeURIComponent(expandAddress(text))
  const num = (text.match(/^\s*(\d+[a-z]?)\b/i) ?? [])[1]?.toLowerCase()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json()
    const usable = (data?.features ?? []).filter(
      (f: any) =>
        f?.properties?.countrycode === 'US' &&
        !['country', 'state', 'county'].includes(f?.properties?.type) &&
        !GEOCODE_JUNK.includes(f?.properties?.osm_value) &&
        Array.isArray(f?.geometry?.coordinates)
    )
    const hit =
      (num && usable.find((f: any) => String(f.properties.housenumber ?? '').toLowerCase() === num)) || usable[0]
    if (!hit) return null
    const [lon, lat] = hit.geometry.coordinates
    if (!isFinite(lat) || !isFinite(lon)) return null
    const p = hit.properties
    const hood = sanitizeText(p.locality ?? p.district, 120)
    return {
      latitude: lat,
      longitude: lon,
      zipCode: /^\d{5}$/.test(p.postcode ?? '') ? p.postcode : null,
      neighborhood: hood && !/^ward\s+\d+$/i.test(hood) ? hood : null,
    }
  } catch (_e) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// False on a failed read, which keeps the pay-up-front session.
async function readWebCardAtPostEnabled(admin: any): Promise<boolean> {
  try {
    const { data, error } = (await withDbTimeout(
      admin.from('payment_experiment_config').select('web_card_at_post_enabled').eq('id', true).maybeSingle()
    )) as any
    if (error) throw error
    return data?.web_card_at_post_enabled === true
  } catch (err: any) {
    console.warn('[bounty-checkout] Could not read web_card_at_post_enabled', { message: err?.message })
    return false
  }
}

// The new-account cap on free posting (fn_bounties_enforce_posting_quality,
// rule 2), asked before the poster saves a card so they get told. Setup sessions
// only: a paid post is deliberately exempt from the cap, because the charge has
// already happened by the time it inserts. Fails open, since the trigger still
// refuses the insert.
async function newAccountCapReached(admin: any, authedUserId: string | null, email: string): Promise<boolean> {
  try {
    let userId = authedUserId
    if (!userId) {
      const { data: found, error: findErr } = (await withDbTimeout(
        admin.rpc('fn_find_user_id_by_email', { p_email: email })
      )) as any
      if (findErr) throw findErr
      userId = found ?? null
    }
    if (!userId) return false

    const { data: reached, error: capErr } = (await withDbTimeout(
      admin.rpc('fn_new_account_open_cap_reached', { p_user_id: userId })
    )) as any
    if (capErr) throw capErr
    return reached === true
  } catch (err: any) {
    console.warn('[bounty-checkout] Could not check the new-account cap', { message: err?.message })
    return false
  }
}

// Resolves a hire the signed-in poster is trying to make: a 404 for anyone else's
// request, and the wallet shortfall read as that poster, from the same function
// the app uses. The bounty's own poster decides ownership; bounty_requests.poster_id
// is client-written.
async function loadShortfall(
  admin: any,
  supabaseUrl: string,
  apiKey: string,
  token: string,
  userId: string,
  requestId: string
): Promise<
  | { ok: false; status: number; body: Record<string, unknown> }
  | { ok: true; shortfall: number; bounty: Record<string, any>; requestStatus: string }
> {
  const notFound = { ok: false as const, status: 404, body: { error: 'Not found', code: 'not_found' } }
  if (!isUuid(requestId)) return notFound

  const { data: request, error: reqErr } = (await withDbTimeout(
    admin.from('bounty_requests').select('bounty_id, status').eq('id', requestId).maybeSingle()
  )) as any
  if (reqErr) throw reqErr
  if (!request) return notFound

  const { data: bounty, error: bountyErr } = (await withDbTimeout(
    admin.from('bounties').select('id, title, status, poster_id, user_id').eq('id', request.bounty_id).maybeSingle()
  )) as any
  if (bountyErr) throw bountyErr
  if (!bounty || (bounty.poster_id ?? bounty.user_id) !== userId) return notFound

  const res = await withDbTimeout(
    fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/fn_get_bounty_funding_requirement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_bounty_id: bounty.id }),
    })
  )
  if (!res.ok) throw new Error(`funding requirement failed: ${res.status}`)
  const rows = await res.json()
  const row = Array.isArray(rows) ? rows[0] : rows
  return { ok: true, shortfall: Number(row?.shortfall ?? 0), bounty, requestStatus: String(request.status) }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/bounty-checkout')
  const subPath = pathParts.length > 1 ? pathParts[1].replace(/\/$/, '') : ''

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500, corsHeaders)
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Auth is OPTIONAL - the public website posts anonymously. When a caller IS
  // signed in (the Expo app), we bind the submission to their real UUID.
  let authedUserId: string | null = null
  let authedEmail: string | null = null
  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const { data: { user } = { user: null } } = (await withDbTimeout(
        supabaseAdmin.auth.getUser(authHeader.substring(7))
      )) as any
      if (user) {
        authedUserId = user.id
        authedEmail = sanitizeText(user.email ?? '', 320).toLowerCase() || null
      }
    } catch (_e) {
      // A bad/expired token degrades to the anonymous path.
    }
  }

  try {
    // POST /bounty-checkout  (and the /create-session alias)
    if (req.method === 'POST' && (subPath === '' || subPath === '/create-session')) {
      const body = await req.json().catch(() => ({}))

      const { draft, error: draftError, code } = validateSubmission(body)
      if (!draft) {
        return jsonResponse({ error: draftError, code }, 400, corsHeaders)
      }

      // A signed-in caller's own email always wins.
      const email = authedEmail ?? draft.email

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count: recentCount, error: countErr } = (await withDbTimeout(
        supabaseAdmin
          .from('pending_bounties')
          .select('id', { count: 'exact', head: true })
          .eq('email', email)
          .gte('created_at', oneHourAgo)
      )) as any
      if (!countErr && (recentCount ?? 0) >= MAX_SUBMISSIONS_PER_EMAIL_PER_HOUR) {
        return jsonResponse(
          { error: 'Too many bounty submissions. Please try again later.', code: 'rate_limited' },
          429,
          corsHeaders
        )
      }

      const checkoutMode = checkoutModeForSwitch(await readWebCardAtPostEnabled(supabaseAdmin))

      if (checkoutMode === 'setup' && (await newAccountCapReached(supabaseAdmin, authedUserId, email))) {
        return jsonResponse(
          {
            error: 'New accounts can have 2 open bounties on their first day. You can post more tomorrow.',
            code: 'new_account_open_cap',
          },
          409,
          corsHeaders
        )
      }

      // In-person text without a point: look it up rather than post a bounty
      // that no nearby hunter can find.
      if (draft.workType === 'in_person' && draft.latitude === null && draft.location) {
        const found = await geocodeLocation(draft.location)
        if (found) {
          draft.latitude = found.latitude
          draft.longitude = found.longitude
          draft.zipCode = draft.zipCode ?? found.zipCode
          draft.neighborhood = draft.neighborhood ?? found.neighborhood
        } else {
          console.warn('[bounty-checkout] In-person bounty has no coordinates', { location: draft.location })
        }
      }

      const forwardedFor = req.headers.get('x-forwarded-for') ?? ''
      const clientIp = forwardedFor.split(',')[0]?.trim() || null

      // 1. Persist the submission FIRST.
      const { data: pending, error: pendingErr } = (await withDbTimeout(
        supabaseAdmin
          .from('pending_bounties')
          .insert({
            email,
            contact_name: draft.contactName || null,
            title: draft.title,
            description: draft.description,
            amount: draft.amount,
            work_type: draft.workType,
            location: draft.location || null,
            latitude: draft.latitude,
            longitude: draft.longitude,
            zip_code: draft.zipCode,
            neighborhood: draft.neighborhood,
            category: draft.category || null,
            deadline: draft.deadline,
            status: 'pending_payment',
            supabase_user_id: authedUserId,
            source: sanitizeText(body?.source, 50) || 'web',
            submitted_ip: clientIp,
          })
          .select('id, amount')
          .maybeSingle()
      )) as any

      if (pendingErr || !pending?.id) {
        console.error('[bounty-checkout] Failed to store pending bounty', { error: pendingErr })
        return jsonResponse(
          { error: 'Could not save your bounty. Please try again.', code: 'pending_insert_failed' },
          500,
          corsHeaders
        )
      }

      const pendingBountyId = pending.id as string
      // Read the amount back out of the row we just wrote. This is the value
      // the customer is charged - from the database, never the request body.
      const authoritativeAmount = Number(pending.amount)

      let existingCustomerId: string | null = null
      if (authedUserId) {
        const { data: profile } = (await withDbTimeout(
          supabaseAdmin.from('profiles').select('stripe_customer_id').eq('id', authedUserId).maybeSingle()
        )) as any
        existingCustomerId = profile?.stripe_customer_id ?? null
      }

      // Built here, never read from the body (success_url / cancel_url are
      // ignored): see checkoutReturnUrls.
      const { successUrl, cancelUrl } = checkoutReturnUrls({
        origin: req.headers.get('Origin'),
        source: sanitizeText(body?.source, 50) || 'web',
        extraOrigins: (Deno.env.get('BOUNTY_CHECKOUT_ALLOWED_ORIGINS') ?? '')
          .split(',')
          .map((o: string) => o.trim())
          .filter(Boolean),
        supabaseUrl,
      })

      // 2. Create the Session. Stripe carries only the REFERENCE.
      const sessionMetadata: Record<string, string> = {
        flow_type: 'bounty_creation',
        pending_bounty_id: pendingBountyId,
        customer_email: email,
      }
      if (authedUserId) sessionMetadata.supabase_user_id = authedUserId

      let session: any
      try {
        session = await stripe.checkout.sessions.create(
          buildCheckoutSessionParams({
            mode: checkoutMode,
            amount: authoritativeAmount,
            title: draft.title,
            description: draft.description,
            email,
            existingCustomerId,
            successUrl,
            cancelUrl,
            pendingBountyId,
            metadata: sessionMetadata,
            nowSeconds: Math.floor(Date.now() / 1000),
          }) as any,
          { idempotencyKey: `pending_bounty_${pendingBountyId}` }
        )
      } catch (stripeErr: any) {
        console.error('[bounty-checkout] Stripe session creation failed', {
          pendingBountyId,
          message: stripeErr?.message,
        })
        return jsonResponse(
          { error: 'Could not start checkout. Please try again.', code: 'stripe_session_failed', pending_bounty_id: pendingBountyId },
          502,
          corsHeaders
        )
      }

      // 3. Link the session back to the submission.
      const { error: linkErr } = (await withDbTimeout(
        supabaseAdmin
          .from('pending_bounties')
          .update({ stripe_checkout_session_id: session.id })
          .eq('id', pendingBountyId)
      )) as any
      if (linkErr) {
        console.error('[bounty-checkout] Failed to link session to pending bounty (non-fatal)', {
          pendingBountyId,
          sessionId: session.id,
          error: linkErr,
        })
      }

      console.log('[bounty-checkout] Created session', {
        pendingBountyId,
        sessionId: session.id,
        mode: checkoutMode,
        amount: authoritativeAmount,
        authed: !!authedUserId,
        has_coordinates: draft.latitude !== null,
      })

      return jsonResponse(
        {
          checkout_url: session.url,
          pending_bounty_id: pendingBountyId,
          session_id: session.id,
          mode: checkoutMode,
          amount: authoritativeAmount,
          expires_at: session.expires_at,
        },
        200,
        corsHeaders
      )
    }

    // GET /bounty-checkout/status?pending_bounty_id=... (or ?session_id=cs_...)
    // Read-only. Answers from our own DB - the rows only the
    // signature-verified webhook writes.
    if (req.method === 'GET' && subPath === '/status') {
      const pendingId = sanitizeText(url.searchParams.get('pending_bounty_id'), 64)
      const sessionId = sanitizeText(url.searchParams.get('session_id'), 255)

      if (!pendingId && !sessionId) {
        return jsonResponse(
          { error: 'pending_bounty_id or session_id is required.', code: 'missing_identifier' },
          400,
          corsHeaders
        )
      }

      let query = supabaseAdmin
        .from('pending_bounties')
        .select('id, status, resulting_bounty_id, supabase_user_id, amount, title, email')
      query = pendingId ? query.eq('id', pendingId) : query.eq('stripe_checkout_session_id', sessionId)

      const { data: pendingRow, error: pendingErr } = (await withDbTimeout(query.maybeSingle())) as any

      if (pendingErr) {
        return jsonResponse({ error: 'Failed to look up checkout status.' }, 500, corsHeaders)
      }
      if (!pendingRow) {
        return jsonResponse({ state: 'not_found' }, 404, corsHeaders)
      }

      if (pendingRow.status === 'created' && pendingRow.resulting_bounty_id) {
        // Only the owning poster gets the bounty id.
        const isOwner = authedUserId != null && authedUserId === pendingRow.supabase_user_id
        return jsonResponse(
          {
            state: 'ready',
            ...(isOwner
              ? { bounty_id: pendingRow.resulting_bounty_id, title: pendingRow.title, amount: Number(pendingRow.amount) }
              : { requires_sign_in: true }),
          },
          200,
          corsHeaders
        )
      }

      if (pendingRow.status === 'failed') {
        const { data: failure } = (await withDbTimeout(
          supabaseAdmin
            .from('checkout_processing_failures')
            .select('reason')
            .eq('pending_bounty_id', pendingRow.id)
            .maybeSingle()
        )) as any
        return jsonResponse({ state: 'failed', reason: failure?.reason ?? 'processing_failed' }, 200, corsHeaders)
      }

      if (pendingRow.status === 'expired') {
        return jsonResponse({ state: 'expired' }, 200, corsHeaders)
      }

      return jsonResponse({ state: 'pending', submission_status: pendingRow.status }, 200, corsHeaders)
    }

    // GET /bounty-checkout/config: the same decision POST makes, for the form's
    // button. Public and short-lived, since it only says what the form already shows.
    if (req.method === 'GET' && subPath === '/config') {
      const mode = checkoutModeForSwitch(await readWebCardAtPostEnabled(supabaseAdmin))
      return new Response(JSON.stringify({ mode }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      })
    }

    // GET|POST /bounty-checkout/shortfall: paying what a saved card couldn't.
    if (subPath === '/shortfall' && (req.method === 'GET' || req.method === 'POST')) {
      if (!authedUserId) {
        return jsonResponse({ error: 'Please sign in.', code: 'auth_required' }, 401, corsHeaders)
      }
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
      const requestId = sanitizeText(body?.request_id ?? url.searchParams.get('request_id'), 64)
      const hire = await loadShortfall(
        supabaseAdmin,
        supabaseUrl,
        serviceRoleKey,
        authHeader!.substring(7),
        authedUserId,
        requestId
      )
      if (!hire.ok) return jsonResponse(hire.body, hire.status, corsHeaders)

      // Read-only: the page polls this after Stripe sends the poster back, since
      // the deposit lands by webhook.
      if (req.method === 'GET') {
        return jsonResponse({ shortfall: hire.shortfall, covered: !(hire.shortfall > 0) }, 200, corsHeaders)
      }

      if (hire.requestStatus !== 'pending' || hire.bounty.status !== 'open') {
        return jsonResponse(
          { error: 'This application is no longer open, so nothing is needed.', code: 'not_open' },
          409,
          corsHeaders
        )
      }
      if (!(hire.shortfall > 0)) {
        return jsonResponse({ covered: true, shortfall: 0 }, 200, corsHeaders)
      }

      const { data: profile } = (await withDbTimeout(
        supabaseAdmin.from('profiles').select('stripe_customer_id').eq('id', authedUserId).maybeSingle()
      )) as any
      const nowSeconds = Math.floor(Date.now() / 1000)
      const session = await stripe.checkout.sessions.create(
        buildShortfallSessionParams({
          shortfallDollars: hire.shortfall,
          bountyTitle: String(hire.bounty.title ?? 'your bounty'),
          posterId: authedUserId,
          bountyId: hire.bounty.id,
          requestId,
          email: authedEmail,
          existingCustomerId: profile?.stripe_customer_id ?? null,
          returnUrl: webManageLink(Deno.env.get('WEB_MANAGE_BASE'), {
            bountyId: hire.bounty.id,
            requestId,
            view: 'applicant',
            campaign: 'shortfall_checkout',
          }),
          nowSeconds,
        }) as any,
        { idempotencyKey: shortfallIdempotencyKey(requestId, shortfallChargeCents(hire.shortfall), nowSeconds) }
      )
      return jsonResponse(
        { checkout_url: session.url, session_id: session.id, shortfall: hire.shortfall, amount_cents: session.amount_total },
        200,
        corsHeaders
      )
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders)
  } catch (err: any) {
    if (err?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503, corsHeaders)
    }
    console.error('[bounty-checkout] Unhandled error', { subPath, message: err?.message, type: err?.type })
    const message = err?.type?.startsWith?.('Stripe') && err?.message ? err.message : 'An unexpected error occurred. Please try again.'
    return jsonResponse({ error: message }, 500, corsHeaders)
  }
})
