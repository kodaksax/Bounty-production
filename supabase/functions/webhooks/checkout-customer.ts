/**
 * checkout.session.completed (mode 'payment', flow_type 'bounty_creation'), after
 * the bounty exists: one Stripe customer per person, and a card saved in
 * Checkout shows up in the app.
 *
 * 1. The customer. Checkout creates one for a poster who has none
 *    (bounty-checkout's planCheckoutCustomer). Nothing stored it, so the app's
 *    first card save made a second customer. Store it on the profile now, only
 *    where the profile has none: never replace a customer, which would strand
 *    every card already on it. A session on some other customer is left for
 *    scripts/report-split-stripe-customers.mjs; nothing is merged here.
 *
 * 2. The card. Checkout attaches a card to the customer only when the poster
 *    ticks Stripe's "save for next time" box (or picked a card already saved
 *    there). This never attaches anything. It mirrors an attached card into
 *    payment_methods, as setup_intent.succeeded does for the app, and only on
 *    the profile's own customer, which is the one the app lists and hiring
 *    charges. Then a sole card becomes the default.
 *
 * Never throws: the payment and the bounty already succeeded, and both steps
 * are repeatable by the backfill and report scripts. Safe to run twice: the
 * profile update is conditional and the upsert is keyed on the payment method.
 */
import { ensureSolePaymentMethodDefault, idOf } from '../_shared/sole-payment-method-default.ts';

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export interface CheckoutCustomerResult {
  customerId: string | null;
  profileCustomerId: string | null;
  linked: boolean;
  /** The session's customer is not the profile's. */
  split: boolean;
  savedCardId: string | null;
}

export async function linkCheckoutCustomerAndCard(args: {
  supabase: AnyClient;
  stripe: AnyClient;
  posterId: string;
  session: { id: string; customer?: unknown };
  /** The session's PaymentIntent with payment_method expanded, if it could be read. */
  paymentIntent: { payment_method?: unknown } | null;
}): Promise<CheckoutCustomerResult> {
  const { supabase, stripe, posterId, session, paymentIntent } = args;
  const customerId = idOf(session.customer);
  const result: CheckoutCustomerResult = {
    customerId,
    profileCustomerId: null,
    linked: false,
    split: false,
    savedCardId: null,
  };
  // A guest payment: no customer, so nothing to link and nothing saved.
  if (!customerId) return result;

  try {
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', posterId)
      .maybeSingle();
    if (profileErr) throw profileErr;
    let profileCustomerId: string | null = profile?.stripe_customer_id ?? null;

    if (!profileCustomerId) {
      const { error: linkErr } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', posterId)
        .is('stripe_customer_id', null);
      if (linkErr) throw linkErr;
      // Re-read: a concurrent save may have set a different one first.
      const { data: after, error: afterErr } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', posterId)
        .maybeSingle();
      if (afterErr) throw afterErr;
      profileCustomerId = after?.stripe_customer_id ?? null;
      result.linked = profileCustomerId === customerId;
    }
    result.profileCustomerId = profileCustomerId;

    if (profileCustomerId !== customerId) {
      result.split = true;
      console.warn('[webhooks] Checkout used a different Stripe customer than the profile — not merged', {
        sessionId: session.id,
        posterId,
        customerId,
        profileCustomerId,
      });
      return result;
    }

    const pm = paymentIntent?.payment_method as
      | {
          id: string;
          type?: string;
          customer?: unknown;
          card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
        }
      | string
      | null
      | undefined;
    // Not attached means the box wasn't ticked: nothing to save.
    if (!pm || typeof pm === 'string' || pm.type !== 'card' || idOf(pm.customer) !== customerId) {
      return result;
    }

    // is_default is left out: a new row starts false and an existing row keeps
    // its value. The sole-method rule below decides.
    const { error: upsertErr } = await supabase.from('payment_methods').upsert(
      {
        user_id: posterId,
        stripe_payment_method_id: pm.id,
        type: 'card',
        card_brand: pm.card?.brand ?? null,
        card_last4: pm.card?.last4 ?? null,
        card_exp_month: pm.card?.exp_month ?? null,
        card_exp_year: pm.card?.exp_year ?? null,
      },
      { onConflict: 'stripe_payment_method_id' }
    );
    if (upsertErr) throw upsertErr;
    result.savedCardId = pm.id;

    await ensureSolePaymentMethodDefault({ supabase, stripe, userId: posterId, logTag: 'webhooks' });
  } catch (err) {
    console.error('[webhooks] Could not link the checkout customer or card (non-fatal)', {
      sessionId: session.id,
      posterId,
      customerId,
      message: (err as { message?: string })?.message,
    });
  }
  return result;
}
