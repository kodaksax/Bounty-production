/**
 * Setup-mode Checkout webhook: runs the real
 * supabase/functions/webhooks/deferred-bounty-setup.ts against fakes.
 */
import {
  handleDeferredBountySetup,
  isTerminalBountyCreationError,
} from '../../supabase/functions/webhooks/deferred-bounty-setup';

const PENDING = '11111111-1111-4111-8111-111111111111';
const POSTER = '22222222-2222-4222-8222-222222222222';

const card = {
  id: 'pm_1',
  type: 'card',
  customer: 'cus_new',
  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
};

function harness(
  o: {
    profileCustomer?: string | null;
    rpc?: any;
    findUser?: string | null;
    intent?: any;
    held?: any;
    authed?: boolean;
    userMetadata?: Record<string, unknown>;
  } = {}
) {
  const writes: Array<{ table: string; op: string; payload?: any; filters: any[] }> = [];
  const table = (name: string) => {
    const rec: any = { table: name, op: 'select', filters: [] };
    const builder: any = {
      select: () => builder,
      update: (payload: any) => {
        Object.assign(rec, { op: 'update', payload });
        writes.push(rec);
        return builder;
      },
      upsert: (payload: any, options: any) => {
        Object.assign(rec, { op: 'upsert', payload, options });
        writes.push(rec);
        return builder;
      },
      eq: (...a: any[]) => (rec.filters.push(['eq', ...a]), builder),
      neq: (...a: any[]) => (rec.filters.push(['neq', ...a]), builder),
      is: (...a: any[]) => (rec.filters.push(['is', ...a]), builder),
      in: (...a: any[]) => (rec.filters.push(['in', ...a]), builder),
      maybeSingle: () =>
        Promise.resolve(
          name === 'pending_bounties'
            ? {
                data:
                  o.held === undefined
                    ? { status: 'awaiting_sign_in', claim_email_sent_at: null }
                    : o.held,
                error: null,
              }
            : {
                data: {
                  stripe_customer_id: o.profileCustomer === undefined ? null : o.profileCustomer,
                },
                error: null,
              }
        ),
      then: (ok: any) => ok({ data: null, error: null }),
    };
    return builder;
  };
  const rpc = jest.fn(async (name: string) => {
    if (name === 'fn_find_user_id_by_email') {
      return { data: o.findUser === undefined ? POSTER : o.findUser, error: null };
    }
    return o.rpc ?? { data: [{ bounty_id: 'b1', created: true }], error: null };
  });
  const supabase: any = {
    from: jest.fn(table),
    rpc,
    auth: {
      admin: {
        createUser: jest.fn(async () => ({ data: { user: { id: POSTER } }, error: null })),
        getUserById: jest.fn(async () => ({
          data: { user: { user_metadata: o.userMetadata ?? {} } },
          error: null,
        })),
      },
      resetPasswordForEmail: jest.fn(async () => ({ error: null })),
      signInWithOtp: jest.fn(async () => ({ error: null })),
    },
  };
  const stripe: any = {
    setupIntents: {
      retrieve: jest.fn(
        async () => o.intent ?? { status: 'succeeded', customer: 'cus_new', payment_method: card }
      ),
    },
    customers: { create: jest.fn(async () => ({ id: 'cus_created' })) },
    paymentMethods: { attach: jest.fn(async () => ({})) },
  };
  const run = () =>
    handleDeferredBountySetup({
      supabase,
      stripe,
      eventId: 'evt_1',
      authRedirectUrl: 'https://example.test/manage',
      session: {
        id: 'cs_1',
        setup_intent: 'seti_1',
        customer: 'cus_new',
        metadata: {
          flow_type: 'bounty_creation',
          pending_bounty_id: PENDING,
          customer_email: 'A@Example.com',
          ...(o.authed === false ? {} : { supabase_user_id: POSTER }),
        },
      },
    });
  const find = (t: string, op: string) => writes.filter(w => w.table === t && w.op === op);
  return { supabase, stripe, run, writes, find, rpc };
}

const quiet = () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
};
beforeEach(quiet);
afterEach(() => jest.restoreAllMocks());

describe('handleDeferredBountySetup', () => {
  it('saves the default card, sets the customer, then creates the bounty', async () => {
    const h = harness();
    await h.run();

    expect(h.find('payment_methods', 'upsert')[0].payload).toEqual({
      user_id: POSTER,
      stripe_payment_method_id: 'pm_1',
      type: 'card',
      card_brand: 'visa',
      card_last4: '4242',
      card_exp_month: 12,
      card_exp_year: 2030,
      is_default: true,
    });
    expect(h.find('payment_methods', 'update')[0].payload).toEqual({ is_default: false });
    expect(h.find('profiles', 'update')[0].payload).toEqual({ stripe_customer_id: 'cus_new' });
    expect(h.rpc).toHaveBeenCalledWith('fn_create_bounty_from_pending_deferred', {
      p_pending_id: PENDING,
      p_poster_id: POSTER,
      p_setup_session_id: 'cs_1',
      p_payment_method_id: 'pm_1',
    });
    expect(h.find('checkout_processing_failures', 'upsert')).toHaveLength(0);
  });

  it('replay: created=false writes no failure and resolves', async () => {
    const h = harness({ rpc: { data: [{ bounty_id: 'b1', created: false }], error: null } });
    await expect(h.run()).resolves.toBeUndefined();
    await expect(h.run()).resolves.toBeUndefined();
    expect(h.find('checkout_processing_failures', 'upsert')).toHaveLength(0);
    expect(h.supabase.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('a transient RPC error throws and leaves the pending row retryable', async () => {
    const err = { code: '08006', message: 'connection failure' };
    const h = harness({ rpc: { data: null, error: err } });
    await expect(h.run()).rejects.toBe(err);
    expect(h.find('pending_bounties', 'update')).toHaveLength(0);
    expect(h.find('checkout_processing_failures', 'upsert')).toHaveLength(0);
  });

  it('a posting-rule refusal marks failed + failure row and does not throw', async () => {
    const h = harness({
      rpc: {
        data: null,
        error: { code: '23514', message: 'New accounts can have 2 open bounties' },
      },
    });
    await expect(h.run()).resolves.toBeUndefined();
    const failure = h.find('checkout_processing_failures', 'upsert')[0];
    expect(failure.payload.pending_bounty_id).toBe(PENDING);
    expect(failure.payload.reason).toContain('New accounts');
    const mark = h.find('pending_bounties', 'update')[0];
    expect(mark.payload).toEqual({ status: 'failed' });
    expect(mark.filters).toContainEqual(['neq', 'status', 'created']);
  });

  it('a missing pending row records the failure without the FK', async () => {
    const h = harness({
      rpc: {
        data: null,
        error: {
          code: 'P0001',
          message: `fn_create_bounty_from_pending_deferred: pending bounty ${PENDING} not found`,
        },
      },
    });
    await h.run();
    expect(
      h.find('checkout_processing_failures', 'upsert')[0].payload.pending_bounty_id
    ).toBeNull();
    expect(h.find('pending_bounties', 'update')).toHaveLength(0);
  });

  it('does not overwrite a different existing customer or take the default', async () => {
    const h = harness({ profileCustomer: 'cus_existing' });
    await h.run();
    expect(h.find('profiles', 'update')).toHaveLength(0);
    expect(h.find('payment_methods', 'update')).toHaveLength(0);
    expect(h.find('payment_methods', 'upsert')[0].payload.is_default).toBe(false);
  });

  it('attaches a card Checkout left without a customer, to the profile customer', async () => {
    const h = harness({
      profileCustomer: 'cus_existing',
      intent: { status: 'succeeded', customer: null, payment_method: { ...card, customer: null } },
    });
    await handleDeferredBountySetup({
      supabase: h.supabase,
      stripe: h.stripe,
      eventId: 'evt_1',
      authRedirectUrl: 'https://example.test',
      session: {
        id: 'cs_1',
        setup_intent: 'seti_1',
        metadata: { pending_bounty_id: PENDING, supabase_user_id: POSTER },
      },
    });
    expect(h.stripe.paymentMethods.attach).toHaveBeenCalledWith('pm_1', {
      customer: 'cus_existing',
    });
    expect(h.find('payment_methods', 'upsert')[0].payload.is_default).toBe(true);
  });

  it('creates and links a new user with the sign-in email', async () => {
    const h = harness({ findUser: null, authed: false });
    await h.run();
    expect(h.supabase.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@example.com', email_confirm: true })
    );
    expect(h.supabase.auth.resetPasswordForEmail).toHaveBeenCalled();
  });

  it('a Stripe outage on the SetupIntent throws so Stripe retries', async () => {
    const h = harness();
    h.stripe.setupIntents.retrieve.mockRejectedValueOnce(new Error('stripe 500'));
    await expect(h.run()).rejects.toThrow('stripe 500');
    expect(h.find('checkout_processing_failures', 'upsert')).toHaveLength(0);
  });

  it('a non-card method is terminal', async () => {
    const h = harness({
      intent: { status: 'succeeded', payment_method: { id: 'pm_b', type: 'us_bank_account' } },
    });
    await h.run();
    expect(h.find('checkout_processing_failures', 'upsert')[0].payload.reason).toContain(
      'unsupported_payment_method_type'
    );
    expect(h.rpc).not.toHaveBeenCalledWith(
      'fn_create_bounty_from_pending_deferred',
      expect.anything()
    );
  });
});

describe('signed-out submission matching an existing account', () => {
  const existing = () => harness({ authed: false, profileCustomer: 'cus_existing' });

  it('holds the card and writes nothing to the account', async () => {
    const h = existing();
    await h.run();
    expect(h.find('payment_methods', 'upsert')).toHaveLength(0);
    expect(h.find('payment_methods', 'update')).toHaveLength(0);
    expect(h.find('profiles', 'update')).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalledWith(
      'fn_create_bounty_from_pending_deferred',
      expect.anything()
    );
    const [hold] = h.find('pending_bounties', 'update');
    expect(hold.payload).toMatchObject({
      status: 'awaiting_sign_in',
      claim_user_id: POSTER,
      stripe_checkout_session_id: 'cs_1',
      claim_card: { payment_method_id: 'pm_1', customer_id: 'cus_new', last4: '4242' },
    });
    expect(hold.filters).toContainEqual(['in', 'status', ['pending_payment', 'paid']]);
  });

  it('emails a sign-in link that cannot create an account', async () => {
    const h = existing();
    await h.run();
    expect(h.supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@example.com',
      options: { shouldCreateUser: false, emailRedirectTo: 'https://example.test/manage' },
    });
    expect(h.supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('replay: the link goes out once', async () => {
    const h = harness({
      authed: false,
      held: { status: 'awaiting_sign_in', claim_email_sent_at: '2026-11-04T00:00:00Z' },
    });
    await h.run();
    expect(h.supabase.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('replay after the claim changes nothing', async () => {
    const h = harness({ authed: false, held: { status: 'created', claim_email_sent_at: 'x' } });
    await h.run();
    expect(h.supabase.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(h.find('checkout_processing_failures', 'upsert')).toHaveLength(0);
  });

  it('a failed send throws, and records no sent-at, so the retry sends it', async () => {
    const h = existing();
    const err = new Error('rate limited');
    h.supabase.auth.signInWithOtp.mockResolvedValueOnce({ error: err });
    await expect(h.run()).rejects.toBe(err);
    expect(
      h.find('pending_bounties', 'update').filter(w => w.payload.claim_email_sent_at)
    ).toHaveLength(0);
  });

  it("a retry that finds this submission's own new account does not hold it", async () => {
    const h = harness({ authed: false, userMetadata: { pending_bounty_id: PENDING } });
    await h.run();
    expect(h.supabase.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('fn_create_bounty_from_pending_deferred', expect.anything());
  });

  it('a new-account conflict that resolves to someone else is held', async () => {
    const h = harness({ authed: false, findUser: null });
    h.supabase.auth.admin.createUser.mockResolvedValueOnce({
      data: null,
      error: { status: 422, message: 'User already registered' },
    });
    h.rpc.mockImplementation(async (name: string) =>
      name === 'fn_find_user_id_by_email'
        ? {
            data: h.rpc.mock.calls.length > 1 ? POSTER : null,
            error: null,
          }
        : { data: [], error: null }
    );
    await h.run();
    expect(h.supabase.auth.signInWithOtp).toHaveBeenCalled();
    expect(h.find('payment_methods', 'upsert')).toHaveLength(0);
  });

  it('an unattached card goes on a fresh customer, never the unverified profile customer', async () => {
    const h = harness({
      authed: false,
      profileCustomer: 'cus_existing',
      intent: { status: 'succeeded', customer: null, payment_method: { ...card, customer: null } },
    });
    await handleDeferredBountySetup({
      supabase: h.supabase,
      stripe: h.stripe,
      eventId: 'evt_1',
      authRedirectUrl: 'https://example.test',
      session: {
        id: 'cs_1',
        setup_intent: 'seti_1',
        metadata: { pending_bounty_id: PENDING, customer_email: 'a@example.com' },
      },
    });
    expect(h.stripe.paymentMethods.attach).toHaveBeenCalledWith('pm_1', {
      customer: 'cus_created',
    });
  });
});

describe('isTerminalBountyCreationError', () => {
  it('splits terminal from transient', () => {
    expect(isTerminalBountyCreationError({ code: '23514' })).toBe(true);
    expect(isTerminalBountyCreationError({ code: '22P02' })).toBe(true);
    expect(
      isTerminalBountyCreationError({ message: 'fn_create_bounty_from_pending_deferred: x' })
    ).toBe(true);
    expect(isTerminalBountyCreationError({ code: '08006', message: 'gone' })).toBe(false);
    expect(isTerminalBountyCreationError({ code: 'DB_TIMEOUT' })).toBe(false);
  });
});
