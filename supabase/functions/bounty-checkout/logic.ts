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
