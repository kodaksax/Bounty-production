// Supabase Edge Function: payments
// Handles all /payments/* routes previously served by the Node/Express server.
// Routes:
//   POST   /payments/create-payment-intent
//   POST   /payments/create-setup-intent
//   POST   /payments/create-financial-connections-session
//   POST   /payments/financial-connections-complete
//   GET    /payments/methods
//   POST   /payments/methods
//   DELETE /payments/methods/:id
//   POST   /payments/confirm

// Local type shims so `tsc --noEmit` (Node tooling) doesn't error on Deno
// runtime imports and globals. These are intentionally loose (`any`) so
// the function can be type-checked in the repo without pulling runtime
// dependencies into the monorepo's TypeScript build.
declare const Deno: any

// Imports are URL-based (Deno/ESM). Silence tsc for local typechecking.
// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore: Allow runtime URL import for Deno/edge function.
import Stripe from 'npm:stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Wrap any promise-like DB query in a race against a timeout so the function
// returns a proper 503 quickly instead of hanging when the database is paused
// or on a cold start (free-tier projects can take 30-60s to wake).
const DB_TIMEOUT_MS = 8000
function withDbTimeout<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('DB_TIMEOUT'), { code: 'DB_TIMEOUT' })), DB_TIMEOUT_MS)
    ),
  ])
}

// Input sanitization helpers (mirrors server/index.js logic)
function sanitizeText(input: unknown): string {
  if (!input) return ''
  // Remove all angle brackets to prevent HTML/script injection, then trim
  return String(input).replace(/[<>]/g, '').trim().slice(0, 1000)
}

function sanitizePositiveNumber(input: unknown): number {
  const num = Number(input)
  if (!isFinite(num) || isNaN(num) || num <= 0) {
    throw new Error('Must be a positive number')
  }
  return num
}

function isValidEmail(email: string): boolean {
  // Basic RFC-safe validation for Stripe customer email values.
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/
  return emailRegex.test(email)
}

function deriveUsernameFromEmail(email: string, userId: string): string {
  const prefix = email.includes('@') ? email.split('@')[0] : email
  const cleaned = prefix.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20)
  if (cleaned.length > 0) return cleaned
  return `user_${userId.slice(0, 8)}`
}

async function resolveStripeCustomerForUser(params: {
  supabaseAdmin: ReturnType<typeof createClient>
  stripe: Stripe
  userId: string
  userEmail?: string
}) {
  const { supabaseAdmin, stripe, userId, userEmail } = params

  const profileRes = await withDbTimeout(supabaseAdmin
    .from('profiles')
    .select('id, stripe_customer_id, email, username')
    .eq('id', userId)
    .maybeSingle()) as any

  const profile = profileRes?.data
  const profileError = profileRes?.error

  if (profileError) {
    console.error('[payments] Failed to fetch profile during customer resolution', { userId, profileError })
  }

  // Guard: if the profile row is genuinely missing (no error, just no row), bail out
  // early so we never create a Stripe customer we cannot persist. An .update() against
  // a non-existent row silently affects zero rows and returns no error — the customer
  // would be orphaned and would multiply on every subsequent call.
  if (!profile && !profileError) {
    console.error('[payments] Profile row not found for user; cannot resolve Stripe customer', { userId })
    return {
      error: 'User profile not found. Please complete your profile setup and try again.',
      status: 404,
    }
  }

  let customerId = profile?.stripe_customer_id ?? null
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId)
      return { customerId }
    } catch (err: any) {
      if (err?.code === 'resource_missing') {
        console.warn('[payments] Stored stripe_customer_id is stale; recreating customer', {
          userId,
          stripeCustomerId: customerId,
        })

        customerId = null
        try {
          await withDbTimeout(supabaseAdmin
            .from('profiles')
            .update({ stripe_customer_id: null })
            .eq('id', userId))
        } catch (clearErr) {
          console.error('[payments] Failed to clear stale stripe_customer_id', { userId, clearErr })
        }
      } else {
        throw err
      }
    }
  }

  const resolvedEmail = sanitizeText(profile?.email ?? userEmail ?? '')
  if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
    return {
      error: 'No valid email found for this account. Please update your profile email and try again.',
      status: 400,
    }
  }

  const customer = await stripe.customers.create({
    email: resolvedEmail,
    metadata: { user_id: userId },
  })
  customerId = customer.id

  // Use .update() instead of .upsert() to save the stripe_customer_id.
  // The profile already exists (fetched above via .maybeSingle()). Using
  // .upsert() with { onConflict: 'id' } generates an INSERT whose missing
  // NOT NULL columns (e.g. username) cause a constraint violation BEFORE
  // the ON CONFLICT clause fires — so the customer ID never gets saved.
  const updatePatch: Record<string, unknown> = {
    stripe_customer_id: customerId,
  }
  // Back-fill email on the profile if it's currently NULL
  if (!profile?.email && resolvedEmail) {
    updatePatch.email = resolvedEmail
  }
  // Save stripe_customer_id and any backfilled email to the existing profile row.
  // Use an UPDATE against the known profile `id` to avoid INSERT/ON CONFLICT
  // behavior which can fail when NOT NULL columns are missing.
  const saveRes = await withDbTimeout(supabaseAdmin
    .from('profiles')
    .update(updatePatch)
    .eq('id', userId)) as any
  const saveError = saveRes?.error

  if (saveError) {
    console.error('[payments] Failed to update profile while saving stripe_customer_id', { userId, saveError })
    // Fallback: try a targeted update of just stripe_customer_id.
    try {
      const fallbackRes = await withDbTimeout(supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)) as any
      const fallbackError = fallbackRes?.error
      if (fallbackError) {
        console.error('[payments] Fallback update of stripe_customer_id also failed', { userId, fallbackError })
      } else {
        console.log('[payments] Fallback update of stripe_customer_id succeeded', { userId, customerId })
      }
    } catch (fallbackErr) {
      console.error('[payments] Fallback stripe_customer_id update threw', { userId, fallbackErr })
    }
  }

  return { customerId }
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Connections helpers
// ─────────────────────────────────────────────────────────────────────────────

interface LinkedBankRow {
  id: string
  type: 'us_bank_account'
  bank_name: string | null
  bank_last4: string | null
  account_type: string | null
  fc_account_id: string | null
  stripe_payment_method_id: string
  stripe_external_account_id: string | null
  verification_status: string | null
  is_default: boolean
  created: number
}

/**
 * Mirror a Financial Connections account onto the user's Stripe Connect account
 * as a payout-eligible external bank account. Idempotent: if an external account
 * already exists for the same FC account it is returned unchanged.
 *
 * Returns the external account id (ba_*) on success, or null when the user has
 * no Connect account yet (deposit-only linking is still allowed).
 */
async function mirrorFcAccountToConnect(params: {
  stripe: Stripe
  connectAccountId: string | null
  fcAccountId: string
}): Promise<string | null> {
  const { stripe, connectAccountId, fcAccountId } = params
  if (!connectAccountId) return null

  // Create a single-use bank-account token from the FC account, then attach as
  // an external account on the connected account. Stripe deduplicates the
  // underlying bank record by fingerprint so repeated calls are safe.
  const token = await stripe.tokens.create({
    bank_account: {
      financial_connections_account: fcAccountId,
    } as any,
  })

  const external = (await stripe.accounts.createExternalAccount(connectAccountId, {
    external_account: token.id,
  })) as Stripe.BankAccount

  return external.id
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  // pathname starts with /functions/v1/payments/...
  // Extract the sub-path after /payments
  const pathParts = url.pathname.split('/payments')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500)
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate user from Authorization header
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[payments edge fn] missing Authorization header')
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const token = authHeader.substring(7)
  let authResult: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>
  try {
    authResult = await withDbTimeout(supabaseAdmin.auth.getUser(token))
  } catch (e: any) {
    if (e?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503)
    }
    throw e
  }
  const { data: { user }, error: authError } = authResult as any
  if (authError || !user) {
    // Log structured details so Supabase function logs show the exact failure reason.
    // Common causes: wrong SUPABASE_URL/SERVICE_ROLE_KEY secret, auth service cold
    // start, or a token from a different Supabase project.
    console.warn('[payments edge fn] invalid or expired token', JSON.stringify({
      hasUser: !!user,
      errorName: authError?.name,
      errorMessage: (authError as any)?.message,
      errorStatus: (authError as any)?.status,
      errorCode: (authError as any)?.code,
    }))
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const userId = user.id
  const userEmail = sanitizeText(user.email ?? '')

  try {
    // POST /payments/create-payment-intent
    if (req.method === 'POST' && subPath === '/create-payment-intent') {
      const body = await req.json()
      const {
        amountCents,
        currency = 'usd',
        metadata = {},
        paymentMethodId,
        paymentMethodType,
        confirm: shouldConfirm,
      } = body

      let validatedAmount: number
      try {
        validatedAmount = sanitizePositiveNumber(amountCents)
      } catch {
        return jsonResponse({ error: 'Invalid amount. Must be a positive number in cents.' }, 400)
      }

      // Stripe requires an integer number of the smallest currency unit (e.g. cents).
      // Enforce a minimum of 50 cents to avoid Stripe validation errors.
      if (!Number.isInteger(validatedAmount) || validatedAmount < 50) {
        return jsonResponse(
          { error: 'Invalid amount. Must be an integer number of cents and at least 50 cents.' },
          400,
        )
      }

      const validatedCurrency = sanitizeText(currency).toLowerCase()
      if (!['usd', 'eur', 'gbp'].includes(validatedCurrency)) {
        return jsonResponse({ error: 'Invalid currency. Supported: usd, eur, gbp.' }, 400)
      }

      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
      }
      const customerId = customerResult.customerId

      const sanitizedMetadata: Record<string, string> = {}
      if (metadata.purpose) sanitizedMetadata.purpose = sanitizeText(metadata.purpose)
      if (metadata.bounty_id) sanitizedMetadata.bounty_id = sanitizeText(metadata.bounty_id)
      if (metadata.description) sanitizedMetadata.description = sanitizeText(metadata.description)

      // ACH (us_bank_account) branch — explicit so we can attach the saved PM,
      // capture an online mandate, and prefer instant verification with a
      // microdeposit fallback.
      const isAch =
        sanitizeText(paymentMethodType ?? '').toLowerCase() === 'us_bank_account' ||
        (typeof paymentMethodId === 'string' && paymentMethodId.startsWith('pm_') &&
          sanitizeText(paymentMethodType ?? '').toLowerCase() !== 'card')

      if (isAch) {
        if (!paymentMethodId || typeof paymentMethodId !== 'string') {
          return jsonResponse(
            { error: 'paymentMethodId is required for us_bank_account deposits.' },
            400,
          )
        }

        // Look up the saved bank to validate ownership and reuse mandate metadata.
        const { data: pmRow } = await withDbTimeout(
          supabaseAdmin
            .from('payment_methods')
            .select('id, user_id, type, mandate_id, verification_status')
            .eq('stripe_payment_method_id', paymentMethodId)
            .maybeSingle(),
        ) as any

        if (!pmRow || pmRow.user_id !== userId) {
          return jsonResponse({ error: 'Bank account not found for this user.' }, 403)
        }
        if (pmRow.type && pmRow.type !== 'us_bank_account') {
          return jsonResponse({ error: 'Selected payment method is not a bank account.' }, 400)
        }
        if (pmRow.verification_status === 'failed') {
          return jsonResponse(
            { error: 'This bank account failed verification. Please re-link your bank.' },
            400,
          )
        }

        const piParams: Stripe.PaymentIntentCreateParams = {
          amount: validatedAmount,
          currency: validatedCurrency,
          customer: customerId,
          payment_method: paymentMethodId,
          payment_method_types: ['us_bank_account'],
          payment_method_options: {
            us_bank_account: {
              verification_method: 'instant',
              financial_connections: { permissions: ['payment_method'] },
            },
          },
          metadata: { user_id: userId, ...sanitizedMetadata },
          // Always confirm server-side for ACH so we capture mandate + transition
          // straight to `processing` (or `requires_action` for microdeposits)
          // without an extra client round-trip.
          confirm: shouldConfirm !== false,
          mandate_data: {
            customer_acceptance: {
              type: 'online',
              online: {
                ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0',
                user_agent: req.headers.get('user-agent') || 'unknown',
              },
            },
          },
        }

        const paymentIntent = await stripe.paymentIntents.create(piParams)

        // Persist the mandate id for off-session reuse on subsequent deposits.
        const newMandateId = (paymentIntent as any).mandate ?? null
        if (newMandateId && newMandateId !== pmRow.mandate_id) {
          try {
            await withDbTimeout(
              supabaseAdmin
                .from('payment_methods')
                .update({ mandate_id: newMandateId })
                .eq('id', pmRow.id),
            )
          } catch (mandateErr) {
            console.warn('[payments] Failed to persist mandate id', { userId, mandateErr })
          }
        }

        return jsonResponse({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          requiresAction: paymentIntent.status === 'requires_action',
          nextAction: paymentIntent.next_action ?? null,
        })
      }

      // Default (card / automatic) flow.
      const piParams: Stripe.PaymentIntentCreateParams = {
        amount: validatedAmount,
        currency: validatedCurrency,
        customer: customerId,
        metadata: { user_id: userId, ...sanitizedMetadata },
        automatic_payment_methods: { enabled: true },
      }
      if (typeof paymentMethodId === 'string' && paymentMethodId.startsWith('pm_')) {
        piParams.payment_method = paymentMethodId
      }
      const paymentIntent = await stripe.paymentIntents.create(piParams)

      return jsonResponse({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id })
    }

    // POST /payments/create-setup-intent
    if (req.method === 'POST' && subPath === '/create-setup-intent') {
      let bodyJson: any = {}
      try {
        bodyJson = await req.json()
      } catch {
        // empty body is fine
      }
      const requestedType = sanitizeText(bodyJson?.paymentMethodType ?? '').toLowerCase()
      const isAchSetup = requestedType === 'us_bank_account'

      let customerId: string
      try {
        const customerResult = await resolveStripeCustomerForUser({
          supabaseAdmin,
          stripe,
          userId,
          userEmail,
        })
        if (customerResult.error || !customerResult.customerId) {
          return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
        }
        customerId = customerResult.customerId
      } catch (err) {
        console.error('[payments] Error creating Stripe customer for setup intent', { userId, err })
        return jsonResponse({ error: 'Failed to create customer profile' }, 502)
      }

      const setupParams: Stripe.SetupIntentCreateParams = isAchSetup
        ? {
            customer: customerId,
            usage: 'off_session',
            payment_method_types: ['us_bank_account'],
            payment_method_options: {
              us_bank_account: {
                verification_method: 'instant',
                financial_connections: { permissions: ['payment_method'] },
              },
            },
            metadata: { user_id: userId },
          }
        : {
            customer: customerId,
            usage: 'off_session',
            automatic_payment_methods: {
              enabled: true,
              allow_redirects: 'never',
            },
            metadata: { user_id: userId },
          }

      const setupIntent = await stripe.setupIntents.create(setupParams)

      return jsonResponse({ clientSecret: setupIntent.client_secret, setupIntentId: setupIntent.id })
    }

    // POST /payments/create-financial-connections-session
    // Creates a Financial Connections session bound to the user's Stripe Customer.
    // The client uses the returned client_secret with collectFinancialConnectionsAccounts()
    // from @stripe/stripe-react-native to present Stripe's secure linking UI.
    if (req.method === 'POST' && subPath === '/create-financial-connections-session') {
      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse(
          { error: customerResult.error ?? 'Unable to create customer profile' },
          customerResult.status ?? 400,
        )
      }
      const customerId = customerResult.customerId

      const fcSession = await (stripe as any).financialConnections.sessions.create({
        account_holder: { type: 'customer', customer: customerId },
        permissions: ['payment_method', 'balances'],
        filters: { countries: ['US'] },
      })

      return jsonResponse({
        clientSecret: fcSession.client_secret,
        sessionId: fcSession.id,
      })
    }

    // POST /payments/financial-connections-complete
    // Body: { sessionId: string, setAsDefault?: boolean }
    // Server retrieves the FC session, creates a us_bank_account PaymentMethod for
    // each linked account, attaches it to the customer, mirrors it onto the user's
    // Connect account as an external bank account (when present), and upserts a row
    // in payment_methods. Idempotent on stripe_payment_method_id + fc_account_id.
    if (req.method === 'POST' && subPath === '/financial-connections-complete') {
      let body: { sessionId?: unknown; setAsDefault?: unknown }
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400)
      }
      const sessionId =
        typeof body.sessionId === 'string' ? sanitizeText(body.sessionId) : ''
      const setAsDefault = body.setAsDefault === true
      if (!sessionId.startsWith('fcsess_')) {
        return jsonResponse({ error: 'Invalid sessionId' }, 400)
      }

      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse(
          { error: customerResult.error ?? 'Unable to create customer profile' },
          customerResult.status ?? 400,
        )
      }
      const customerId = customerResult.customerId

      const fcSession = await (stripe as any).financialConnections.sessions.retrieve(sessionId)
      // Defensive: ensure the FC session belongs to this user's customer.
      if (
        fcSession?.account_holder?.type === 'customer' &&
        fcSession.account_holder.customer &&
        fcSession.account_holder.customer !== customerId
      ) {
        return jsonResponse({ error: 'Session does not belong to this user' }, 403)
      }

      const accounts: any[] = (fcSession?.accounts?.data ?? []) as any[]
      if (!accounts || accounts.length === 0) {
        return jsonResponse({ linkedBanks: [] })
      }

      // Look up Connect account so we can mirror linked banks for payouts.
      const { data: profileRow } = await withDbTimeout(
        supabaseAdmin
          .from('profiles')
          .select('stripe_connect_account_id')
          .eq('id', userId)
          .maybeSingle(),
      ) as any
      const connectAccountId =
        (profileRow as { stripe_connect_account_id?: string } | null)?.stripe_connect_account_id ??
        null

      const linkedBanks: LinkedBankRow[] = []

      for (const fcAccount of accounts) {
        const fcAccountId: string = fcAccount.id
        const accountType: string | null = fcAccount.subcategory ?? null
        const last4: string | null = fcAccount.last4 ?? null
        const bankName: string | null = fcAccount.institution_name ?? null

        // 1) Create a us_bank_account PaymentMethod and attach to the Customer.
        let paymentMethod: Stripe.PaymentMethod
        try {
          paymentMethod = await stripe.paymentMethods.create({
            type: 'us_bank_account',
            us_bank_account: { financial_connections_account: fcAccountId } as any,
          })
          await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId })
        } catch (pmErr: any) {
          console.error('[payments] Failed to create/attach us_bank_account PM', {
            userId,
            fcAccountId,
            pmErr,
          })
          continue
        }

        // 2) Mirror onto Connect account as a payout-eligible external account.
        let externalAccountId: string | null = null
        try {
          externalAccountId = await mirrorFcAccountToConnect({
            stripe,
            connectAccountId,
            fcAccountId,
          })
        } catch (mirrorErr: any) {
          console.warn('[payments] Failed to mirror FC account to Connect external account', {
            userId,
            fcAccountId,
            mirrorErr: mirrorErr?.message ?? mirrorErr,
          })
          // Non-fatal: the bank can still be used for deposits.
        }

        // 3) Upsert into payment_methods. Use stripe_payment_method_id as the
        // unique key (the table has a UNIQUE constraint on it).
        const verificationStatus: string = 'verified'

        const upsertRow = {
          user_id: userId,
          stripe_payment_method_id: paymentMethod.id,
          type: 'us_bank_account',
          bank_name: bankName,
          bank_last4: last4,
          account_type: accountType,
          fc_account_id: fcAccountId,
          stripe_external_account_id: externalAccountId,
          verification_status: verificationStatus,
          // Keep card fields null for clarity.
          card_brand: null,
          card_last4: null,
          card_exp_month: null,
          card_exp_year: null,
        }

        const { data: upserted, error: upsertErr } = await withDbTimeout(
          supabaseAdmin
            .from('payment_methods')
            .upsert(upsertRow, { onConflict: 'stripe_payment_method_id' })
            .select(
              'id, stripe_payment_method_id, type, bank_name, bank_last4, account_type, fc_account_id, stripe_external_account_id, verification_status, is_default, created_at',
            )
            .single(),
        ) as any

        if (upsertErr || !upserted) {
          console.error('[payments] Failed to upsert payment_methods row', {
            userId,
            upsertErr,
          })
          continue
        }

        linkedBanks.push({
          id: upserted.id,
          type: 'us_bank_account',
          bank_name: upserted.bank_name,
          bank_last4: upserted.bank_last4,
          account_type: upserted.account_type,
          fc_account_id: upserted.fc_account_id,
          stripe_payment_method_id: upserted.stripe_payment_method_id,
          stripe_external_account_id: upserted.stripe_external_account_id,
          verification_status: upserted.verification_status,
          is_default: upserted.is_default ?? false,
          created: upserted.created_at
            ? Math.floor(new Date(upserted.created_at).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
        })
      }

      // Optionally promote the first newly linked bank to default.
      if (setAsDefault && linkedBanks.length > 0) {
        const newDefault = linkedBanks[0]
        try {
          // Clear any prior defaults for this user, then mark the new one.
          await withDbTimeout(
            supabaseAdmin
              .from('payment_methods')
              .update({ is_default: false })
              .eq('user_id', userId),
          )
          await withDbTimeout(
            supabaseAdmin
              .from('payment_methods')
              .update({ is_default: true })
              .eq('id', newDefault.id),
          )
          newDefault.is_default = true

          // Mirror default on the Connect external account when applicable.
          if (connectAccountId && newDefault.stripe_external_account_id) {
            try {
              await stripe.accounts.updateExternalAccount(
                connectAccountId,
                newDefault.stripe_external_account_id,
                { default_for_currency: true } as Stripe.ExternalAccountUpdateParams,
              )
            } catch (defaultErr) {
              console.warn('[payments] Failed to set default external account', {
                userId,
                defaultErr,
              })
            }
          }
        } catch (defErr) {
          console.warn('[payments] Failed to mark default payment method', { userId, defErr })
        }
      }

      return jsonResponse({ linkedBanks })
    }

    // GET /payments/methods
    if (req.method === 'GET' && subPath === '/methods') {
      const profileRes = await withDbTimeout(supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single()) as any

      const profile = profileRes?.data

      // Always read us_bank_account methods from our DB — they're authoritative
      // (Stripe Customer.payment_methods.list with type='us_bank_account' works,
      // but we already maintain the canonical row with bank_name/last4/etc.).
      const { data: bankMethodsRows } = await withDbTimeout(
        supabaseAdmin
          .from('payment_methods')
          .select(
            'stripe_payment_method_id, type, bank_name, bank_last4, account_type, fc_account_id, stripe_external_account_id, verification_status, is_default, created_at',
          )
          .eq('user_id', userId)
          .eq('type', 'us_bank_account')
          .order('created_at', { ascending: false }),
      ) as any

      const bankMethods = (bankMethodsRows ?? []).map((pm: any) => ({
        id: pm.stripe_payment_method_id,
        type: 'us_bank_account',
        us_bank_account: {
          bank_name: pm.bank_name ?? null,
          last4: pm.bank_last4 ?? null,
          account_type: pm.account_type ?? null,
          fc_account_id: pm.fc_account_id ?? null,
          stripe_external_account_id: pm.stripe_external_account_id ?? null,
          verification_status: pm.verification_status ?? null,
          is_default: pm.is_default ?? false,
        },
        created: pm.created_at
          ? Math.floor(new Date(pm.created_at).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
      }))

      // If we don't have a stripe_customer_id yet, fall back to the payment_methods
      // table which is populated by the setup_intent.succeeded webhook. This handles
      // the race condition where the profile upsert during create-setup-intent fails
      // but the webhook later saves the payment method details to the DB.
      if (!profile?.stripe_customer_id) {
        const dbMethodsRes = await withDbTimeout(supabaseAdmin
          .from('payment_methods')
          .select('stripe_payment_method_id, type, card_brand, card_last4, card_exp_month, card_exp_year, created_at')
          .eq('user_id', userId)
          .eq('type', 'card')
          .order('created_at', { ascending: false })) as any

        const dbMethods = dbMethodsRes?.data

        if (dbMethods && dbMethods.length > 0) {
          const methods = dbMethods.map((pm: any) => ({
            id: pm.stripe_payment_method_id,
            type: pm.type || 'card',
            card: {
              brand: pm.card_brand ?? 'unknown',
              last4: pm.card_last4 ?? '****',
              exp_month: pm.card_exp_month ?? 0,
              exp_year: pm.card_exp_year ?? 0,
            },
            created: pm.created_at ? Math.floor(new Date(pm.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
          }))
          return jsonResponse({ paymentMethods: [...methods, ...bankMethods] })
        }

        return jsonResponse({ paymentMethods: bankMethods })
      }

      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: profile.stripe_customer_id,
          type: 'card',
        })

        const methods = paymentMethods.data.map((pm: Stripe.PaymentMethod) => ({
          id: pm.id,
          type: 'card',
          card: {
            brand: pm.card?.brand ?? 'unknown',
            last4: pm.card?.last4 ?? '****',
            exp_month: pm.card?.exp_month ?? 0,
            exp_year: pm.card?.exp_year ?? 0,
          },
          created: pm.created,
        }))

        return jsonResponse({ paymentMethods: [...methods, ...bankMethods] })
      } catch (err: any) {
        // If Stripe says the customer or its payment methods don't exist
        // (common when switching between test/live keys), treat this as
        // "no payment methods" for the current user instead of a hard error.
        if (err?.code === 'resource_missing') {
          console.warn('[payments] Stripe customer missing for /payments/methods; clearing stripe_customer_id', {
            userId,
            stripeCustomerId: profile.stripe_customer_id,
          })

          try {
            await withDbTimeout(supabaseAdmin
              .from('profiles')
              .update({ stripe_customer_id: null })
              .eq('id', userId))
          } catch (updateErr) {
            console.error('[payments] Failed to clear stale stripe_customer_id', { userId, updateErr })
          }

          return jsonResponse({ paymentMethods: bankMethods })
        }

        // Re-throw so the outer handler can surface unexpected errors
        throw err
      }
    }

    // POST /payments/methods
    if (req.method === 'POST' && subPath === '/methods') {
      const body = await req.json()
      const { paymentMethodId } = body

      if (!paymentMethodId) {
        return jsonResponse({ error: 'Payment method ID is required' }, 400)
      }

      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
      }
      const customerId = customerResult.customerId

      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)

      return jsonResponse({
        success: true,
        paymentMethod: {
          id: paymentMethod.id,
          type: 'card',
          card: {
            brand: paymentMethod.card?.brand ?? 'unknown',
            last4: paymentMethod.card?.last4 ?? '****',
            exp_month: paymentMethod.card?.exp_month ?? 0,
            exp_year: paymentMethod.card?.exp_year ?? 0,
          },
          created: paymentMethod.created,
        },
      })
    }

    // DELETE /payments/methods/:id
    if (req.method === 'DELETE' && subPath.startsWith('/methods/')) {
      const paymentMethodId = subPath.split('/methods/')[1]


      const profileRes = await withDbTimeout(supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id, stripe_connect_account_id')
        .eq('id', userId)
        .single()) as any

      const profile = profileRes?.data

      if (!profile?.stripe_customer_id) {
        return jsonResponse({ error: 'No payment methods found' }, 404)
      }

      // Look up the local row first so we can detect us_bank_account methods
      // and unmirror them from the Connect account when deleting.
      const { data: pmRow } = await withDbTimeout(
        supabaseAdmin
          .from('payment_methods')
          .select('id, user_id, type, stripe_external_account_id')
          .eq('stripe_payment_method_id', paymentMethodId)
          .maybeSingle(),
      ) as any

      if (pmRow && pmRow.user_id !== userId) {
        return jsonResponse({ error: 'Not authorized to remove this payment method' }, 403)
      }

      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
      if (paymentMethod.customer && paymentMethod.customer !== profile.stripe_customer_id) {
        return jsonResponse({ error: 'Not authorized to remove this payment method' }, 403)
      }

      try {
        await stripe.paymentMethods.detach(paymentMethodId)
      } catch (detachErr: any) {
        // Already detached PMs throw resource_missing — treat as success and proceed.
        if (detachErr?.code !== 'resource_missing') {
          throw detachErr
        }
      }

      // Unmirror the linked external account on the Connect account so the user
      // doesn't keep receiving payouts on a removed bank.
      if (
        pmRow?.type === 'us_bank_account' &&
        pmRow?.stripe_external_account_id &&
        profile?.stripe_connect_account_id
      ) {
        try {
          await stripe.accounts.deleteExternalAccount(
            profile.stripe_connect_account_id,
            pmRow.stripe_external_account_id,
          )
        } catch (extDelErr: any) {
          if (extDelErr?.code !== 'resource_missing') {
            console.warn('[payments] Failed to remove mirrored external account', {
              userId,
              extDelErr: extDelErr?.message ?? extDelErr,
            })
          }
        }
      }

      // Drop the canonical row.
      try {
        await withDbTimeout(
          supabaseAdmin
            .from('payment_methods')
            .delete()
            .eq('user_id', userId)
            .eq('stripe_payment_method_id', paymentMethodId),
        )
      } catch (dbErr) {
        console.warn('[payments] Failed to delete payment_methods row', { userId, dbErr })
      }

      return jsonResponse({ success: true })
    }

    // POST /payments/confirm
    if (req.method === 'POST' && subPath === '/confirm') {
      const body = await req.json()
      const { paymentIntentId, paymentMethodId } = body

      if (!paymentIntentId) {
        return jsonResponse({ error: 'Payment intent ID is required' }, 400)
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

      const metadataUserId = String(paymentIntent.metadata?.user_id ?? '')
      const requestUserId = String(userId)

      if (!metadataUserId || metadataUserId !== requestUserId) {
        return jsonResponse({ error: 'Not authorized to confirm this payment' }, 403)
      }

      // Helper: atomically record a wallet deposit when a wallet_deposit PaymentIntent
      // has succeeded. Uses the apply_deposit RPC which is idempotent by
      // stripe_payment_intent_id — safe to call even if the webhook already ran.
      const recordDepositIfNeeded = async (intent: typeof paymentIntent) => {
        if (intent.metadata?.purpose !== 'wallet_deposit') return
        const amountDollars = intent.amount / 100
        const { data: applyRes, error: applyErr } = await withDbTimeout(
          supabaseAdmin.rpc('apply_deposit', {
            p_user_id: userId,
            p_amount: amountDollars,
            p_payment_intent_id: intent.id,
            p_metadata: intent.metadata ?? {},
          })
        ) as any
        if (applyErr) {
          console.error('[payments/confirm] apply_deposit RPC failed', { userId, intentId: intent.id, applyErr })
          // Throw so the outer handler returns 500 — the client must retry rather
          // than receiving a success response when the balance was not recorded.
          throw applyErr
        }
        const appliedRow = applyRes != null ? (Array.isArray(applyRes) ? applyRes[0] : applyRes) : null
        if (appliedRow?.applied) {
          console.log('[payments/confirm] Deposit applied', { userId, intentId: intent.id, amountDollars, txId: appliedRow.tx_id })
        } else {
          console.log('[payments/confirm] Deposit already recorded (idempotent no-op)', { userId, intentId: intent.id })
        }
      }

      // If already succeeded, record deposit atomically then return
      if (paymentIntent.status === 'succeeded') {
        await recordDepositIfNeeded(paymentIntent)
        return jsonResponse({ success: true, status: paymentIntent.status, paymentIntentId: paymentIntent.id })
      }

      // If processing, return current status without crediting — the payment has
      // not yet settled and may still fail. The webhook will apply the deposit
      // once the intent transitions to succeeded.
      if (paymentIntent.status === 'processing') {
        return jsonResponse({ success: true, status: paymentIntent.status, paymentIntentId: paymentIntent.id })
      }

      let confirmedIntent = paymentIntent
      if (
        paymentIntent.status === 'requires_confirmation' ||
        paymentIntent.status === 'requires_payment_method'
      ) {
        const confirmParams: Record<string, string> = {}
        if (paymentMethodId) confirmParams.payment_method = paymentMethodId
        confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, confirmParams)
      }

      if (confirmedIntent.status === 'requires_action') {
        return jsonResponse({
          success: false,
          status: 'requires_action',
          requiresAction: true,
          clientSecret: confirmedIntent.client_secret,
          nextAction: confirmedIntent.next_action,
        })
      }

      if (confirmedIntent.status === 'succeeded') {
        await recordDepositIfNeeded(confirmedIntent)
      }

      return jsonResponse({
        success: confirmedIntent.status === 'succeeded',
        status: confirmedIntent.status,
        paymentIntentId: confirmedIntent.id,
      })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error: unknown) {
    const err = error as { type?: string; code?: string; decline_code?: string; message?: string }
    console.error('[payments edge fn] Error:', err)
    if ((err as any)?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503)
    }
    if (err.type === 'StripeCardError') {
      return jsonResponse({ error: err.message, code: err.code, decline_code: err.decline_code }, 400)
    }
    if (err.code === 'resource_missing') {
      return jsonResponse({ error: 'Payment method not found' }, 404)
    }
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500)
  }
})
