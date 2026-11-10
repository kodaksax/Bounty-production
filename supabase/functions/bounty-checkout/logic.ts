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

export interface CheckoutSessionInput {
  mode: CheckoutMode
  amount: number
  title: string
  description: string
  email: string
  existingCustomerId: string | null
  successUrl: string
  cancelUrl: string
  pendingBountyId: string
  metadata: Record<string, string>
  nowSeconds: number
}

export function buildCheckoutSessionParams(input: CheckoutSessionInput): Record<string, unknown> {
  const { mode, amount, title, description, email, existingCustomerId } = input
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
      // A signed-out poster gets no customer here. The webhook creates one and
      // attaches the card once it knows which account the card belongs to.
      ...(existingCustomerId ? { customer: existingCustomerId } : { customer_email: email }),
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
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : { customer_email: email, customer_creation: 'always' as const }),
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
    payment_intent_data: {
      metadata: {
        purpose: 'wallet_deposit',
        user_id: posterId,
        bounty_id: bountyId,
        request_id: requestId,
      },
    },
    expires_at: nowSeconds + 30 * 60,
  }
}

/**
 * A short window so a double-click reuses one session, while someone coming back
 * later gets a fresh one rather than a replay of an expired session. Includes the
 * amount, which changes if the balance moves.
 */
export function shortfallIdempotencyKey(requestId: string, cents: number, nowSeconds: number): string {
  return `shortfall_${requestId}_${cents}_${Math.floor(nowSeconds / 600)}`
}
