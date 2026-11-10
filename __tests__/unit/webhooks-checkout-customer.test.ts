/**
 * Payment-mode website Checkout, after the bounty exists: runs the real
 * supabase/functions/webhooks/checkout-customer.ts against fakes.
 */
import { linkCheckoutCustomerAndCard } from '../../supabase/functions/webhooks/checkout-customer';

const POSTER = '22222222-2222-4222-8222-222222222222';

const savedCard = (over: Record<string, unknown> = {}) => ({
  id: 'pm_saved',
  type: 'card',
  customer: 'cus_web',
  allow_redisplay: 'always',
  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
  ...over,
});

function harness(o: {
  /** profiles.stripe_customer_id before, and after a concurrent write. */
  profileCustomer?: string | null;
  profileCustomerAfter?: string | null;
  pmRows?: any[];
  profileError?: unknown;
}) {
  const writes: Array<{ table: string; op: string; payload?: any; filters: any[]; options?: any }> = [];
  let profileReads = 0;
  const from = (table: string) => {
    const rec: any = { table, op: 'select', filters: [] as any[] };
    const b: any = {
      select: () => b,
      update: (payload: any) => (Object.assign(rec, { op: 'update', payload }), writes.push(rec), b),
      upsert: (payload: any, options: any) => (
        Object.assign(rec, { op: 'upsert', payload, options }), writes.push(rec), b
      ),
      eq: (...a: any[]) => (rec.filters.push(['eq', ...a]), b),
      is: (...a: any[]) => (rec.filters.push(['is', ...a]), b),
      maybeSingle: () => {
        if (o.profileError) return Promise.resolve({ data: null, error: o.profileError });
        profileReads += 1;
        const before = o.profileCustomer ?? null;
        const linked = writes.some(w => w.table === 'profiles' && w.op === 'update');
        const value =
          profileReads > 1 && o.profileCustomerAfter !== undefined
            ? o.profileCustomerAfter
            : linked && !before
              ? 'cus_web'
              : before;
        return Promise.resolve({ data: { stripe_customer_id: value }, error: null });
      },
      then: (ok: any) =>
        ok(rec.op === 'select' ? { data: o.pmRows ?? [], error: null } : { data: null, error: null }),
    };
    return b;
  };
  const supabase: any = { from: jest.fn(from) };
  const stripe: any = {
    paymentMethods: { retrieve: jest.fn(async (id: string) => ({ id, customer: 'cus_web' })) },
    customers: {
      retrieve: jest.fn(async (id: string) => ({ id, invoice_settings: { default_payment_method: null } })),
      update: jest.fn(async () => ({})),
    },
  };
  const find = (t: string, op: string) => writes.filter(w => w.table === t && w.op === op);
  return { supabase, stripe, writes, find };
}

const run = (h: ReturnType<typeof harness>, session: any, paymentIntent: any) =>
  linkCheckoutCustomerAndCard({ supabase: h.supabase, stripe: h.stripe, posterId: POSTER, session, paymentIntent });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the customer', () => {
  it("stores Checkout's customer on a profile that has none (new web account)", async () => {
    const h = harness({ profileCustomer: null });
    const r = await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: 'pm_x' });
    expect(r).toMatchObject({ linked: true, split: false, profileCustomerId: 'cus_web' });
    const [update] = h.find('profiles', 'update');
    expect(update.payload).toEqual({ stripe_customer_id: 'cus_web' });
    // Conditional: never replaces a customer someone set first.
    expect(update.filters).toContainEqual(['is', 'stripe_customer_id', null]);
  });

  it("never replaces a profile's existing customer", async () => {
    const h = harness({ profileCustomer: 'cus_app' });
    const r = await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: savedCard() });
    expect(r).toMatchObject({ linked: false, split: true, savedCardId: null });
    expect(h.find('profiles', 'update')).toEqual([]);
    // A card on the other customer is not mirrored: the app lists and hiring
    // charges the profile's customer.
    expect(h.find('payment_methods', 'upsert')).toEqual([]);
  });

  it('reports a split when a concurrent save won the race', async () => {
    const h = harness({ profileCustomer: null, profileCustomerAfter: 'cus_app' });
    const r = await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: savedCard() });
    expect(r).toMatchObject({ linked: false, split: true, profileCustomerId: 'cus_app' });
    expect(h.find('payment_methods', 'upsert')).toEqual([]);
  });

  it('a session already on the profile customer changes nothing on the profile', async () => {
    const h = harness({ profileCustomer: 'cus_web' });
    const r = await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: 'pm_x' });
    expect(r).toMatchObject({ linked: false, split: false });
    expect(h.find('profiles', 'update')).toEqual([]);
  });

  it('a guest payment has nothing to link', async () => {
    const h = harness({ profileCustomer: null });
    const r = await run(h, { id: 'cs_1', customer: null }, { payment_method: savedCard() });
    expect(r.customerId).toBeNull();
    expect(h.writes).toEqual([]);
  });
});

describe('the card', () => {
  it('mirrors a card the poster chose to save, so the app shows it, and makes a sole card the default', async () => {
    const h = harness({ profileCustomer: 'cus_web', pmRows: [{ id: 'row_1', stripe_payment_method_id: 'pm_saved', type: 'card', is_default: false }] });
    const r = await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: savedCard() });
    expect(r.savedCardId).toBe('pm_saved');

    const [upsert] = h.find('payment_methods', 'upsert');
    expect(upsert.payload).toEqual({
      user_id: POSTER,
      stripe_payment_method_id: 'pm_saved',
      type: 'card',
      card_brand: 'visa',
      card_last4: '4242',
      card_exp_month: 12,
      card_exp_year: 2030,
    });
    expect(upsert.options).toEqual({ onConflict: 'stripe_payment_method_id' });

    expect(h.stripe.customers.update).toHaveBeenCalledWith('cus_web', {
      invoice_settings: { default_payment_method: 'pm_saved' },
    });
    expect(h.find('payment_methods', 'update').map(w => w.payload)).toEqual([{ is_default: true }]);
  });

  it('saves nothing when the box was not ticked (card not attached)', async () => {
    const h = harness({ profileCustomer: 'cus_web' });
    const r = await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: savedCard({ customer: null }) });
    expect(r.savedCardId).toBeNull();
    expect(h.find('payment_methods', 'upsert')).toEqual([]);
    expect(h.stripe.customers.update).not.toHaveBeenCalled();
  });

  it('saves nothing for Link or an unexpanded intent', async () => {
    for (const pm of [savedCard({ type: 'link' }), 'pm_unexpanded', null]) {
      const h = harness({ profileCustomer: 'cus_web' });
      await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: pm });
      expect(h.find('payment_methods', 'upsert')).toEqual([]);
    }
    const h = harness({ profileCustomer: 'cus_web' });
    await run(h, { id: 'cs_1', customer: 'cus_web' }, null);
    expect(h.find('payment_methods', 'upsert')).toEqual([]);
  });

  it('leaves a second card for the user to choose', async () => {
    const h = harness({
      profileCustomer: 'cus_web',
      pmRows: [
        { id: 'row_1', stripe_payment_method_id: 'pm_app', type: 'card', is_default: true },
        { id: 'row_2', stripe_payment_method_id: 'pm_saved', type: 'card', is_default: false },
      ],
    });
    await run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: savedCard() });
    expect(h.find('payment_methods', 'upsert')).toHaveLength(1);
    expect(h.find('payment_methods', 'update')).toEqual([]);
    expect(h.stripe.customers.update).not.toHaveBeenCalled();
  });
});

it('never throws: the payment and bounty already succeeded', async () => {
  const h = harness({ profileError: new Error('db down') });
  await expect(run(h, { id: 'cs_1', customer: 'cus_web' }, { payment_method: savedCard() })).resolves.toMatchObject({
    customerId: 'cus_web',
    linked: false,
  });
});
