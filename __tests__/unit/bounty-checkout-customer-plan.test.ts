/**
 * The reads behind a website post's customer: runs the real
 * supabase/functions/bounty-checkout/customer-plan.ts against fakes.
 */
import { resolveCustomerPlan } from '../../supabase/functions/bounty-checkout/customer-plan';

const USER = '22222222-2222-4222-8222-222222222222';

function fakes(o: {
  matched?: string | null;
  profileCustomer?: string | null;
  lookupError?: unknown;
  profileError?: unknown;
  customer?: Record<string, unknown>;
  shownCount?: number;
  stripeError?: unknown;
}) {
  const admin: any = {
    rpc: jest.fn(async () =>
      o.lookupError ? { data: null, error: o.lookupError } : { data: o.matched ?? null, error: null }
    ),
    from: jest.fn(() => {
      const b: any = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () =>
          o.profileError
            ? { data: null, error: o.profileError }
            : { data: { stripe_customer_id: o.profileCustomer ?? null }, error: null },
      };
      return b;
    }),
  };
  const stripe: any = {
    customers: {
      retrieve: jest.fn(async (id: string) => {
        if (o.stripeError) throw o.stripeError;
        return { id, name: null, phone: null, address: null, shipping: null, ...(o.customer ?? {}) };
      }),
      listPaymentMethods: jest.fn(async () => ({ data: Array.from({ length: o.shownCount ?? 0 }, () => ({})) })),
    },
  };
  return { admin, stripe };
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it("signed in: the caller's own customer, save offered, no lookup by email", async () => {
  const f = fakes({ profileCustomer: 'cus_app' });
  const plan = await resolveCustomerPlan({ ...f, authedUserId: USER, email: 'a@example.com' });
  expect(plan).toEqual({ customerId: 'cus_app', ownCustomer: true, createCustomer: false, offerSave: true });
  expect(f.admin.rpc).not.toHaveBeenCalled();
  expect(f.stripe.customers.retrieve).not.toHaveBeenCalled();
});

it('signed in: a failed profile read throws rather than make a second customer', async () => {
  const f = fakes({ profileError: new Error('db down') });
  await expect(resolveCustomerPlan({ ...f, authedUserId: USER, email: 'a@example.com' })).rejects.toThrow('db down');
});

it("signed out, an existing app user: charged on that user's customer when a stranger would see nothing", async () => {
  const f = fakes({ matched: USER, profileCustomer: 'cus_app' });
  const plan = await resolveCustomerPlan({ ...f, authedUserId: null, email: 'a@example.com' });
  expect(plan).toEqual({ customerId: 'cus_app', ownCustomer: false, createCustomer: false, offerSave: false });
  expect(f.stripe.customers.listPaymentMethods).toHaveBeenCalledWith('cus_app', {
    allow_redisplay: 'always',
    limit: 1,
  });
});

it.each([
  ['a card Checkout would show', { shownCount: 1 }],
  ['a name on the customer', { customer: { name: 'Ada' } }],
  ['an unreadable customer', { stripeError: new Error('stripe down') }],
])('signed out, matched, with %s: a guest payment', async (_label, over) => {
  const f = fakes({ matched: USER, profileCustomer: 'cus_app', ...over });
  const plan = await resolveCustomerPlan({ ...f, authedUserId: null, email: 'a@example.com' });
  expect(plan).toEqual({ customerId: null, ownCustomer: false, createCustomer: false, offerSave: false });
});

it('signed out, no account: Checkout creates the customer and offers save', async () => {
  const f = fakes({ matched: null });
  const plan = await resolveCustomerPlan({ ...f, authedUserId: null, email: 'new@example.com' });
  expect(plan).toEqual({ customerId: null, ownCustomer: false, createCustomer: true, offerSave: true });
});

it('signed out, a failed account lookup: no save, no customer', async () => {
  const f = fakes({ lookupError: new Error('rpc down') });
  const plan = await resolveCustomerPlan({ ...f, authedUserId: null, email: 'a@example.com' });
  expect(plan).toEqual({ customerId: null, ownCustomer: false, createCustomer: false, offerSave: false });
});
