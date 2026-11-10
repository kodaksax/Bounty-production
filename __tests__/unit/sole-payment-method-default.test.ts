/**
 * The single-card-default rule: supabase/functions/_shared/sole-payment-method-default.ts,
 * run directly (pure plan + the read/apply steps against fakes).
 */
import {
  applySoleDefaultPlan,
  ensureSolePaymentMethodDefault,
  planSoleDefault,
  readSoleDefaultPlan,
} from '../../supabase/functions/_shared/sole-payment-method-default';

const USER = '22222222-2222-4222-8222-222222222222';
const row = (over: Record<string, unknown> = {}) => ({
  id: 'row_1',
  stripe_payment_method_id: 'pm_visa',
  type: 'card',
  is_default: false,
  ...over,
});

describe('planSoleDefault', () => {
  it('makes a sole card on the profile customer the default in both places', () => {
    expect(
      planSoleDefault({
        rows: [row()],
        profileCustomerId: 'cus_app',
        pmCustomerId: 'cus_app',
        stripeDefaultPaymentMethodId: null,
      })
    ).toEqual({
      eligible: true,
      reason: null,
      paymentMethodId: 'pm_visa',
      rowId: 'row_1',
      profileCustomerId: 'cus_app',
      setDb: true,
      setStripe: true,
      previous: { dbIsDefault: false, stripeDefault: null },
    });
  });

  it('changes nothing when both already agree', () => {
    const p = planSoleDefault({
      rows: [row({ is_default: true })],
      profileCustomerId: 'cus_app',
      pmCustomerId: 'cus_app',
      stripeDefaultPaymentMethodId: 'pm_visa',
    });
    expect(p.eligible).toBe(true);
    expect(p.setDb).toBe(false);
    expect(p.setStripe).toBe(false);
  });

  it('fixes only the side that is wrong', () => {
    const dbOnly = planSoleDefault({
      rows: [row()],
      profileCustomerId: 'cus_app',
      pmCustomerId: 'cus_app',
      stripeDefaultPaymentMethodId: 'pm_visa',
    });
    expect([dbOnly.setDb, dbOnly.setStripe]).toEqual([true, false]);

    const stripeOnly = planSoleDefault({
      rows: [row({ is_default: true })],
      profileCustomerId: 'cus_app',
      pmCustomerId: 'cus_app',
      stripeDefaultPaymentMethodId: 'pm_old_gone',
    });
    expect([stripeOnly.setDb, stripeOnly.setStripe]).toEqual([false, true]);
    expect(stripeOnly.previous.stripeDefault).toBe('pm_old_gone');
  });

  it.each([
    ['no methods', [], 'not_exactly_one'],
    ['two methods: the user picks', [row(), row({ id: 'row_2', stripe_payment_method_id: 'pm_mc' })], 'not_exactly_one'],
  ])('leaves %s alone', (_label, rows, reason) => {
    const p = planSoleDefault({ rows: rows as any, profileCustomerId: 'cus_app', pmCustomerId: 'cus_app' });
    expect(p).toMatchObject({ eligible: false, reason, setDb: false, setStripe: false });
  });

  it('skips a card hiring could not charge: one on another customer', () => {
    const p = planSoleDefault({ rows: [row()], profileCustomerId: 'cus_app', pmCustomerId: 'cus_web' });
    expect(p).toMatchObject({ eligible: false, reason: 'not_on_profile_customer', setDb: false });
  });

  it('skips a detached card, a missing card, no profile customer and a deleted customer', () => {
    expect(planSoleDefault({ rows: [row()], profileCustomerId: 'cus_app', pmCustomerId: null }).reason).toBe(
      'not_on_profile_customer'
    );
    expect(planSoleDefault({ rows: [row()], profileCustomerId: 'cus_app' }).reason).toBe('missing_in_stripe');
    expect(planSoleDefault({ rows: [row()], profileCustomerId: null, pmCustomerId: 'cus_app' }).reason).toBe(
      'no_profile_customer'
    );
    expect(
      planSoleDefault({ rows: [row()], profileCustomerId: 'cus_app', pmCustomerId: 'cus_app', customerDeleted: true })
        .reason
    ).toBe('customer_deleted');
  });
});

function fakes(o: {
  rows?: any[];
  profileCustomer?: string | null;
  pmCustomer?: string | null;
  pmMissing?: boolean;
  stripeDefault?: string | null;
  rowsError?: unknown;
  updateError?: unknown;
}) {
  const updates: Array<{ table: string; payload: any; filters: any[] }> = [];
  const from = (table: string) => {
    const rec: any = { table, filters: [] as any[] };
    const b: any = {
      select: () => b,
      update: (payload: any) => ((rec.payload = payload), updates.push(rec), b),
      eq: (...a: any[]) => (rec.filters.push(a), b),
      maybeSingle: () => Promise.resolve({ data: { stripe_customer_id: o.profileCustomer ?? null }, error: null }),
      then: (ok: any) =>
        ok(
          rec.payload
            ? { data: null, error: o.updateError ?? null }
            : { data: o.rows ?? [], error: o.rowsError ?? null }
        ),
    };
    return b;
  };
  const supabase: any = { from: jest.fn(from) };
  const stripe: any = {
    paymentMethods: {
      retrieve: jest.fn(async (id: string) => {
        if (o.pmMissing) throw Object.assign(new Error('No such PaymentMethod'), { code: 'resource_missing' });
        return { id, customer: o.pmCustomer === undefined ? 'cus_app' : o.pmCustomer };
      }),
    },
    customers: {
      retrieve: jest.fn(async (id: string) => ({
        id,
        invoice_settings: { default_payment_method: o.stripeDefault ?? null },
      })),
      update: jest.fn(async () => ({})),
    },
  };
  return { supabase, stripe, updates };
}

describe('readSoleDefaultPlan + applySoleDefaultPlan', () => {
  it("sets the app user's only card as default: is_default true and invoice_settings on Stripe", async () => {
    const f = fakes({ rows: [row()], profileCustomer: 'cus_app' });
    const plan = await readSoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, userId: USER });
    await applySoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, plan });

    expect(f.stripe.customers.update).toHaveBeenCalledWith('cus_app', {
      invoice_settings: { default_payment_method: 'pm_visa' },
    });
    expect(f.updates).toEqual([
      { table: 'payment_methods', payload: { is_default: true }, filters: [['id', 'row_1']] },
    ]);
  });

  it('reads nothing from Stripe for two cards and changes nothing', async () => {
    const f = fakes({ rows: [row(), row({ id: 'row_2', stripe_payment_method_id: 'pm_mc' })] });
    const plan = await readSoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, userId: USER });
    await applySoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, plan });
    expect(plan.reason).toBe('not_exactly_one');
    expect(f.stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
    expect(f.stripe.customers.update).not.toHaveBeenCalled();
    expect(f.updates).toEqual([]);
  });

  it('treats a card Stripe no longer has as a skip, not an error', async () => {
    const f = fakes({ rows: [row()], profileCustomer: 'cus_app', pmMissing: true });
    const plan = await readSoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, userId: USER });
    expect(plan.reason).toBe('missing_in_stripe');
  });

  it('never touches a card on a different customer', async () => {
    const f = fakes({ rows: [row()], profileCustomer: 'cus_app', pmCustomer: 'cus_web' });
    const plan = await readSoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, userId: USER });
    await applySoleDefaultPlan({ supabase: f.supabase, stripe: f.stripe, plan });
    expect(f.stripe.customers.update).not.toHaveBeenCalled();
    expect(f.updates).toEqual([]);
  });
});

describe('ensureSolePaymentMethodDefault (the on-save hook)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('applies the rule', async () => {
    const f = fakes({ rows: [row()], profileCustomer: 'cus_app' });
    const plan = await ensureSolePaymentMethodDefault({ ...f, userId: USER, logTag: 'test' });
    expect(plan?.eligible).toBe(true);
    expect(f.stripe.customers.update).toHaveBeenCalledTimes(1);
  });

  it('never throws, so a failure cannot undo the save that called it', async () => {
    const f = fakes({ rowsError: new Error('db down') });
    await expect(ensureSolePaymentMethodDefault({ ...f, userId: USER, logTag: 'test' })).resolves.toBeNull();

    const g = fakes({ rows: [row()], profileCustomer: 'cus_app' });
    g.stripe.customers.update.mockRejectedValueOnce(new Error('stripe down'));
    await expect(ensureSolePaymentMethodDefault({ ...g, userId: USER, logTag: 'test' })).resolves.toBeNull();
  });
});
