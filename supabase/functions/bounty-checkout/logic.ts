// Which Stripe Checkout Session a submission gets. Pure so both modes can be
// tested without Stripe.

export type CheckoutMode = 'payment' | 'setup'

/**
 * The server decides, from payment_experiment_config.web_card_at_post_enabled: a
 * client can't ask to post without paying. Anything but an explicit true,
 * including a failed read, keeps today's pay-up-front session.
 */
export function checkoutModeForSwitch(enabled: unknown): CheckoutMode {
  return enabled === true ? 'setup' : 'payment'
}

// ── Which Stripe customer a website post uses ────────────────────────────
//
// One person, one Stripe customer. Before this, every website post made a new
// customer (customer_creation 'always') and nothing stored it on the profile, so
// a poster who later saved a card in the app ended up with two.
//
// The public form is signed out, so its email is only typed, and typing an
// address proves nothing. Handing a signed-out visitor someone's customer would
// let Checkout show that person's saved cards (and their name), and a card saved
// there would land on a stranger's account. So:
//
//   signed in (verified token)   their customer; offer to save; show their cards
//   no account for the email     Checkout creates the customer; offer to save;
//                                the webhook stores it on the new profile
//   signed out, account matches:
//     no customer yet            Checkout creates one, no save offered; the
//                                webhook stores it on the profile
//     customer a stranger can't  charge it, no save offered, no cards shown
//     learn anything from
//     anything else              a guest payment: no customer is created, so
//                                there is still only one
//
// "A stranger can't learn anything from it" is customerSafeForUnverifiedCaller.

export interface CheckoutCustomerPlan {
  /** Passed as `customer`. Null: Checkout uses customer_email. */
  customerId: string | null
  /** The caller proved they own customerId (a signed-in session). */
  ownCustomer: boolean
  /** With no customerId: make a Stripe customer (else a guest payment). */
  createCustomer: boolean
  /** Show Stripe's "save for next time" checkbox. Never for a typed email that matches an account. */
  offerSave: boolean
}

export function planCheckoutCustomer(input: {
  signedIn: boolean
  /** profiles.stripe_customer_id of the signed-in caller, or of the account the email matches. */
  profileCustomerId: string | null
  /** Signed out: the typed email belongs to an existing account. */
  emailMatchesAccount: boolean
  /** Signed out and matched: the result of customerSafeForUnverifiedCaller. */
  customerSafeForStranger: boolean
}): CheckoutCustomerPlan {
  const { signedIn, profileCustomerId, emailMatchesAccount, customerSafeForStranger } = input

  if (signedIn) {
    return profileCustomerId
      ? { customerId: profileCustomerId, ownCustomer: true, createCustomer: false, offerSave: true }
      : { customerId: null, ownCustomer: false, createCustomer: true, offerSave: true }
  }
  if (!emailMatchesAccount) {
    return { customerId: null, ownCustomer: false, createCustomer: true, offerSave: true }
  }
  if (!profileCustomerId) {
    return { customerId: null, ownCustomer: false, createCustomer: true, offerSave: false }
  }
  if (customerSafeForStranger) {
    return { customerId: profileCustomerId, ownCustomer: false, createCustomer: false, offerSave: false }
  }
  return { customerId: null, ownCustomer: false, createCustomer: false, offerSave: false }
}

/**
 * Whether Checkout, opened on this customer by someone who only typed its email,
 * would show them nothing they didn't type. Checkout shows saved cards whose
 * allow_redisplay is 'always' (its default filter), and can prefill the
 * customer's name and address. Pass the customer object and how many 'always'
 * cards it has; anything unknown counts as unsafe.
 */
export function customerSafeForUnverifiedCaller(
  customer: Record<string, any> | null | undefined,
  redisplayableCount: number | null
): boolean {
  if (!customer || customer.deleted) return false
  if (redisplayableCount === null || redisplayableCount > 0) return false
  if (customer.name || customer.phone || customer.address || customer.shipping) return false
  return true
}

export interface CheckoutSessionInput {
  mode: CheckoutMode
  amount: number
  title: string
  description: string
  email: string
  customerPlan: CheckoutCustomerPlan
  successUrl: string
  cancelUrl: string
  pendingBountyId: string
  metadata: Record<string, string>
  nowSeconds: number
}

export function buildCheckoutSessionParams(input: CheckoutSessionInput): Record<string, unknown> {
  const { mode, amount, title, description, email, customerPlan } = input
  const { successUrl, cancelUrl, pendingBountyId, metadata, nowSeconds } = input

  const shared = {
    success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}&pending_bounty_id=${pendingBountyId}`,
    cancel_url: cancelUrl,
    client_reference_id: pendingBountyId,
    metadata,
    expires_at: nowSeconds + 30 * 60,
  }

  if (mode === 'setup') {
    return {
      mode: 'setup',
      payment_method_types: ['card'],
      // A signed-out poster gets no customer here, even one whose email matches:
      // this mode saves the card, and a typed address must not put a card on
      // someone's customer. The webhook creates one and attaches the card once
      // it knows which account the card belongs to.
      ...(customerPlan.ownCustomer && customerPlan.customerId
        ? { customer: customerPlan.customerId }
        : { customer_email: email }),
      // Agreement to the later off-session charge, shown beside the button.
      custom_text: {
        submit: {
          message:
            `You won't be charged today. We'll charge this card up to $${amount.toFixed(2)} ` +
            `for "${title.slice(0, 100)}" only when you accept a hunter.`,
        },
      },
      setup_intent_data: { metadata: { ...metadata, purpose: 'bounty_card_at_post' } },
      ...shared,
    }
  }

  return {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: `Bounty: ${title}`,
            ...(description ? { description: description.slice(0, 300) } : {}),
          },
        },
      },
    ],
    ...(customerPlan.customerId
      ? { customer: customerPlan.customerId }
      : {
          customer_email: email,
          customer_creation: customerPlan.createCustomer ? ('always' as const) : ('if_required' as const),
        }),
    // Stripe's own consent checkbox: the card is saved only if it's ticked
    // (allow_redisplay 'always'). Without it nothing is attached to a customer.
    // The poster's existing cards are shown only on their own customer;
    // 'unspecified' covers cards saved in the app, which never set the field.
    ...(customerPlan.offerSave || customerPlan.ownCustomer
      ? {
          saved_payment_method_options: {
            payment_method_save: customerPlan.offerSave ? 'enabled' : 'disabled',
            ...(customerPlan.ownCustomer ? { allow_redisplay_filters: ['always', 'unspecified'] } : {}),
          },
        }
      : {}),
    ...shared,
    payment_intent_data: {
      metadata: { ...metadata, purpose: 'bounty_escrow_checkout' },
    },
  }
}

// ── Paying a shortfall when hiring ────────────────────────────────────────
//
// A poster's saved card couldn't pay at acceptance, so they pay on Stripe's page.
// This is an ordinary wallet deposit: payment_intent.succeeded credits it through
// apply_deposit, and the page then retries the acceptance. Nothing here hires
// anyone, and the amount always comes from the server.

/**
 * Retries in one window reuse one Checkout. Stripe only replays an idempotent
 * request whose parameters are identical, so everything time-based in the session
 * is derived from the window, not from "now" (2026-11-10: expires_at = now + 30 min
 * made every retry inside the window fail with an idempotency error).
 */
export const SHORTFALL_WINDOW_SECONDS = 600

function shortfallWindow(nowSeconds: number): number {
  return Math.floor(nowSeconds / SHORTFALL_WINDOW_SECONDS)
}

/** Same for every request in a window, and always 30 to 40 minutes ahead (Stripe needs at least 30). */
export function shortfallExpiresAt(nowSeconds: number): number {
  return (shortfallWindow(nowSeconds) + 1) * SHORTFALL_WINDOW_SECONDS + 30 * 60
}

/** Stripe refuses a USD charge under this. The excess stays in the wallet. */
export const STRIPE_MIN_CHARGE_CENTS = 50

export function shortfallChargeCents(shortfallDollars: number): number {
  const cents = Math.ceil(Number((shortfallDollars * 100).toFixed(4)))
  return Math.max(cents, STRIPE_MIN_CHARGE_CENTS)
}

export interface ShortfallSessionInput {
  shortfallDollars: number
  bountyTitle: string
  posterId: string
  bountyId: string
  requestId: string
  email: string | null
  existingCustomerId: string | null
  /** From webManageLink. Never from the caller, so this can't redirect elsewhere. */
  returnUrl: string
  nowSeconds: number
}

export function buildShortfallSessionParams(input: ShortfallSessionInput): Record<string, unknown> {
  const { shortfallDollars, bountyTitle, posterId, bountyId, requestId } = input
  const { email, existingCustomerId, returnUrl, nowSeconds } = input
  const withFunding = (state: string) =>
    `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}funding=${state}`

  return {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: shortfallChargeCents(shortfallDollars),
          product_data: { name: `Payment to hire for: ${bountyTitle.slice(0, 200)}` },
        },
      },
    ],
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : email
        ? { customer_email: email }
        : {}),
    // The wallet is USD and the webhook credits amount / 100 with no currency
    // check, so a charge settled in another currency must never reach it.
    adaptive_pricing: { enabled: false },
    success_url: withFunding('returned'),
    cancel_url: withFunding('cancelled'),
    client_reference_id: requestId,
    // Any flow_type but 'bounty_creation': the checkout handler must ignore this.
    metadata: { flow_type: 'bounty_shortfall', bounty_id: bountyId, request_id: requestId },
    // "Pay with another card": a card settles at once, so the page waiting for the
    // deposit isn't left polling a method that confirms later.
    payment_method_types: ['card'],
    payment_intent_data: {
      metadata: {
        purpose: 'wallet_deposit',
        user_id: posterId,
        bounty_id: bountyId,
        request_id: requestId,
      },
    },
    expires_at: shortfallExpiresAt(nowSeconds),
  }
}

/**
 * A short window so a double-click reuses one session, while someone coming back
 * later gets a fresh one rather than a replay of an expired session. Includes the
 * amount, which changes if the balance moves.
 */
export function shortfallIdempotencyKey(requestId: string, cents: number, nowSeconds: number): string {
  return `shortfall_${requestId}_${cents}_${shortfallWindow(nowSeconds)}`
}

// ── Where Stripe sends the customer back ──────────────────────────────────
//
// Never taken from the request: a caller could otherwise use our Checkout to
// send someone to any site after they paid. The page is chosen here, on an
// origin from an allowlist; the browser's Origin header only picks between
// allowed sites (production, or the local site talking to Staging).

export const PRODUCTION_SITE_ORIGINS = ['https://www.bountyfinder.net', 'https://bountyfinder.net']
export const DEFAULT_SITE_ORIGIN = 'https://www.bountyfinder.net'
const STAGING_PROJECT_REF = 'gwumwpoomwvkjyibdmpj'
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

export function isAllowedReturnOrigin(
  origin: string | null | undefined,
  opts: { extraOrigins?: string[]; supabaseUrl?: string | null } = {}
): origin is string {
  if (!origin) return false
  if (PRODUCTION_SITE_ORIGINS.includes(origin)) return true
  // Extra sites must be https; the configured list is the function's CORS list.
  if ((opts.extraOrigins ?? []).includes(origin) && origin.startsWith('https://')) return true
  // The website talks to Staging only from a local server (assets/app.js).
  return String(opts.supabaseUrl ?? '').includes(STAGING_PROJECT_REF) && LOCAL_ORIGIN.test(origin)
}

export function checkoutReturnUrls(input: {
  origin: string | null | undefined
  source: string | null | undefined
  extraOrigins?: string[]
  supabaseUrl?: string | null
}): { successUrl: string; cancelUrl: string } {
  const base = isAllowedReturnOrigin(input.origin, input) ? input.origin : DEFAULT_SITE_ORIGIN
  // /bounty's own Post a job tab comes back to itself; every other form to the
  // homepage form, which reads ?checkout=cancelled to put the draft back.
  const cancelUrl =
    input.source === 'web_account'
      ? `${base}/bounty?tab=post&checkout=cancelled`
      : `${base}/#post?checkout=cancelled`
  return { successUrl: `${base}/#post-success`, cancelUrl }
}
