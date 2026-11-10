/**
 * A sole payment method is the default one.
 *
 * WHY
 * ---
 * accept-bounty-request charges only the card with payment_methods.is_default =
 * true. Cards saved in the app (setup_intent.succeeded) were mirrored with
 * is_default false, so a poster whose only card was saved there could not hire
 * in one tap: the server found no default card. Stripe's own default
 * (customer.invoice_settings.default_payment_method) was never set either.
 *
 * THE RULE
 * --------
 * When a user has exactly one payment_methods row, it becomes the default in
 * both places: is_default = true, and invoice_settings.default_payment_method
 * on the profile's Stripe customer. Two or more rows are left alone: which of
 * them is the default is the user's choice, not ours.
 *
 * Only a method attached to the profile's own customer qualifies. A card on
 * some other customer (a website checkout before the accounts were linked, a
 * held card-at-post) can't be charged by accept-bounty-request, which charges
 * the profile customer, so making it the default would only move the failure
 * to hire time. Those are left for scripts/report-split-stripe-customers.mjs.
 *
 * Imported by the edge functions (Deno), by Jest, and by
 * scripts/backfill-sole-payment-method-default.mjs (Node type stripping), so
 * it has no imports and only erasable TypeScript.
 */

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export interface PaymentMethodRow {
  id: string;
  stripe_payment_method_id: string;
  type: string | null;
  is_default: boolean | null;
}

export type SoleDefaultSkipReason =
  | 'not_exactly_one'
  | 'no_profile_customer'
  | 'missing_in_stripe'
  | 'not_on_profile_customer'
  | 'customer_deleted';

export interface SoleDefaultPlan {
  /** False when the rule doesn't apply; reason says why. */
  eligible: boolean;
  reason: SoleDefaultSkipReason | null;
  paymentMethodId: string | null;
  rowId: string | null;
  profileCustomerId: string | null;
  /** payment_methods.is_default has to become true. */
  setDb: boolean;
  /** invoice_settings.default_payment_method has to become paymentMethodId. */
  setStripe: boolean;
  /** What is there now, so a change can be reversed. */
  previous: { dbIsDefault: boolean | null; stripeDefault: string | null };
}

export function idOf(value: unknown): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : ((value as { id?: string }).id ?? null);
}

/**
 * Pure: what has to change, given what the database and Stripe say now. Pass
 * pmCustomerId undefined for a method Stripe doesn't have, and
 * customerDeleted true for a deleted customer.
 */
export function planSoleDefault(input: {
  rows: PaymentMethodRow[];
  profileCustomerId: string | null;
  pmCustomerId?: string | null;
  customerDeleted?: boolean;
  stripeDefaultPaymentMethodId?: string | null;
}): SoleDefaultPlan {
  const { rows, profileCustomerId } = input;
  const row = rows.length === 1 ? rows[0] : null;
  const skip = (reason: SoleDefaultSkipReason): SoleDefaultPlan => ({
    eligible: false,
    reason,
    paymentMethodId: row?.stripe_payment_method_id ?? null,
    rowId: row?.id ?? null,
    profileCustomerId: profileCustomerId ?? null,
    setDb: false,
    setStripe: false,
    previous: {
      dbIsDefault: row ? row.is_default === true : null,
      stripeDefault: input.stripeDefaultPaymentMethodId ?? null,
    },
  });

  if (!row) return skip('not_exactly_one');
  if (!profileCustomerId) return skip('no_profile_customer');
  if (input.pmCustomerId === undefined) return skip('missing_in_stripe');
  if (input.pmCustomerId !== profileCustomerId) return skip('not_on_profile_customer');
  if (input.customerDeleted) return skip('customer_deleted');

  const stripeDefault = input.stripeDefaultPaymentMethodId ?? null;
  return {
    eligible: true,
    reason: null,
    paymentMethodId: row.stripe_payment_method_id,
    rowId: row.id,
    profileCustomerId,
    setDb: row.is_default !== true,
    setStripe: stripeDefault !== row.stripe_payment_method_id,
    previous: { dbIsDefault: row.is_default === true, stripeDefault },
  };
}

/**
 * Reads the database and Stripe and returns the plan. Changes nothing.
 * Throws only on a database error; a Stripe "no such object" is a skip.
 */
export async function readSoleDefaultPlan(args: {
  supabase: AnyClient;
  stripe: AnyClient;
  userId: string;
}): Promise<SoleDefaultPlan> {
  const { supabase, stripe, userId } = args;

  const { data: rows, error: rowsErr } = await supabase
    .from('payment_methods')
    .select('id, stripe_payment_method_id, type, is_default')
    .eq('user_id', userId);
  if (rowsErr) throw rowsErr;
  const list: PaymentMethodRow[] = rows ?? [];
  if (list.length !== 1) return planSoleDefault({ rows: list, profileCustomerId: null });

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) throw profileErr;
  const profileCustomerId: string | null = profile?.stripe_customer_id ?? null;
  if (!profileCustomerId) return planSoleDefault({ rows: list, profileCustomerId });

  let pmCustomerId: string | null | undefined;
  try {
    const pm = await stripe.paymentMethods.retrieve(list[0].stripe_payment_method_id);
    pmCustomerId = idOf(pm?.customer);
  } catch (err) {
    if ((err as { code?: string })?.code !== 'resource_missing') throw err;
    pmCustomerId = undefined;
  }
  if (pmCustomerId !== profileCustomerId) {
    return planSoleDefault({ rows: list, profileCustomerId, pmCustomerId });
  }

  const customer = await stripe.customers.retrieve(profileCustomerId);
  return planSoleDefault({
    rows: list,
    profileCustomerId,
    pmCustomerId,
    customerDeleted: customer?.deleted === true,
    stripeDefaultPaymentMethodId: idOf(customer?.invoice_settings?.default_payment_method),
  });
}

/** Makes the changes a plan lists. Stripe first: the database row is what hiring reads. */
export async function applySoleDefaultPlan(args: {
  supabase: AnyClient;
  stripe: AnyClient;
  plan: SoleDefaultPlan;
}): Promise<void> {
  const { supabase, stripe, plan } = args;
  if (!plan.eligible || !plan.paymentMethodId || !plan.profileCustomerId) return;
  if (plan.setStripe) {
    await stripe.customers.update(plan.profileCustomerId, {
      invoice_settings: { default_payment_method: plan.paymentMethodId },
    });
  }
  if (plan.setDb && plan.rowId) {
    const { error } = await supabase
      .from('payment_methods')
      .update({ is_default: true })
      .eq('id', plan.rowId);
    if (error) throw error;
  }
}

/**
 * Read, then apply. Called after every save (and after a removal, which can
 * leave one method behind). Never throws: a failure here must not undo the
 * save that called it, and the backfill script repairs anything missed.
 */
export async function ensureSolePaymentMethodDefault(args: {
  supabase: AnyClient;
  stripe: AnyClient;
  userId: string;
  logTag: string;
}): Promise<SoleDefaultPlan | null> {
  const { supabase, stripe, userId, logTag } = args;
  try {
    const plan = await readSoleDefaultPlan({ supabase, stripe, userId });
    if (plan.eligible && (plan.setDb || plan.setStripe)) {
      await applySoleDefaultPlan({ supabase, stripe, plan });
      console.log(`[${logTag}] Sole payment method made the default`, {
        userId,
        paymentMethodId: plan.paymentMethodId,
        setDb: plan.setDb,
        setStripe: plan.setStripe,
      });
    } else if (!plan.eligible && plan.reason === 'not_on_profile_customer') {
      console.warn(`[${logTag}] Sole payment method is on another Stripe customer, not made default`, {
        userId,
        paymentMethodId: plan.paymentMethodId,
      });
    }
    return plan;
  } catch (err) {
    console.error(`[${logTag}] Could not apply the sole payment method default (non-fatal)`, {
      userId,
      message: (err as { message?: string })?.message,
    });
    return null;
  }
}
