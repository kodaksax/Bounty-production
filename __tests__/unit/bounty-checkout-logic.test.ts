import {
  buildCheckoutSessionParams,
  buildShortfallSessionParams,
  checkoutModeForSwitch,
  checkoutReturnUrls,
  customerSafeForUnverifiedCaller,
  isAllowedReturnOrigin,
  planCheckoutCustomer,
  shortfallChargeCents,
  shortfallIdempotencyKey,
} from '../../supabase/functions/bounty-checkout/logic';

const base = {
  amount: 25,
  title: 'Walk my cat',
  description: 'A long enough description',
  email: 'a@example.com',
  // A new poster: Checkout creates the customer and offers to save the card.
  customerPlan: { customerId: null, ownCustomer: false, createCustomer: true, offerSave: true },
  successUrl: 'https://x.test/done',
  cancelUrl: 'https://x.test/back',
  pendingBountyId: 'p1',
  metadata: {
    flow_type: 'bounty_creation',
    pending_bounty_id: 'p1',
    customer_email: 'a@example.com',
  },
  nowSeconds: 1000,
};

describe('checkoutModeForSwitch', () => {
  it.each([
    [true, 'setup'],
    [false, 'payment'],
    [null, 'payment'],
    [undefined, 'payment'],
    ['true', 'payment'],
    // The app's switch has no say here.
    ['all_posters', 'payment'],
  ])('%s -> %s', (enabled, mode) => {
    expect(checkoutModeForSwitch(enabled)).toBe(mode);
  });
});

describe('payment mode', () => {
  it('is exactly the session the deployed function creates today', () => {
    expect(buildCheckoutSessionParams({ ...base, mode: 'payment' })).toEqual({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 2500,
            product_data: { name: 'Bounty: Walk my cat', description: 'A long enough description' },
          },
        },
      ],
      customer_email: 'a@example.com',
      customer_creation: 'always',
      saved_payment_method_options: { payment_method_save: 'enabled' },
      success_url: 'https://x.test/done?session_id={CHECKOUT_SESSION_ID}&pending_bounty_id=p1',
      cancel_url: 'https://x.test/back',
      client_reference_id: 'p1',
      metadata: base.metadata,
      payment_intent_data: { metadata: { ...base.metadata, purpose: 'bounty_escrow_checkout' } },
      expires_at: 2800,
    });
  });
});

describe('planCheckoutCustomer: one Stripe customer per person', () => {
  const plan = (o: Partial<Parameters<typeof planCheckoutCustomer>[0]>) =>
    planCheckoutCustomer({
      signedIn: false,
      profileCustomerId: null,
      emailMatchesAccount: false,
      customerSafeForStranger: false,
      ...o,
    });

  it('a signed-in poster pays on their own customer and may save the card', () => {
    expect(plan({ signedIn: true, profileCustomerId: 'cus_app' })).toEqual({
      customerId: 'cus_app',
      ownCustomer: true,
      createCustomer: false,
      offerSave: true,
    });
  });

  it('a signed-in poster with no customer gets one made by Checkout (stored by the webhook)', () => {
    expect(plan({ signedIn: true })).toEqual({
      customerId: null,
      ownCustomer: false,
      createCustomer: true,
      offerSave: true,
    });
  });

  it('a new email gets a customer and the save option', () => {
    expect(plan({})).toMatchObject({ customerId: null, createCustomer: true, offerSave: true });
  });

  it("an existing app user posting signed out is charged on that user's existing customer", () => {
    expect(
      plan({ emailMatchesAccount: true, profileCustomerId: 'cus_app', customerSafeForStranger: true })
    ).toEqual({ customerId: 'cus_app', ownCustomer: false, createCustomer: false, offerSave: false });
  });

  it('a typed email that matches an account is never offered save', () => {
    for (const o of [
      { emailMatchesAccount: true },
      { emailMatchesAccount: true, profileCustomerId: 'cus_app', customerSafeForStranger: true },
      { emailMatchesAccount: true, profileCustomerId: 'cus_app', customerSafeForStranger: false },
    ]) {
      expect(plan(o).offerSave).toBe(false);
      expect(plan(o).ownCustomer).toBe(false);
    }
  });

  it('a matched customer that would show a stranger anything becomes a guest payment, not a second customer', () => {
    expect(
      plan({ emailMatchesAccount: true, profileCustomerId: 'cus_app', customerSafeForStranger: false })
    ).toEqual({ customerId: null, ownCustomer: false, createCustomer: false, offerSave: false });
  });

  it('a matched account without a customer gets one, with no save offered', () => {
    expect(plan({ emailMatchesAccount: true })).toEqual({
      customerId: null,
      ownCustomer: false,
      createCustomer: true,
      offerSave: false,
    });
  });
});

describe('customerSafeForUnverifiedCaller', () => {
  const blank = { id: 'cus_1', name: null, phone: null, address: null, shipping: null };
  it('is safe only for a live customer with nothing Checkout would show', () => {
    expect(customerSafeForUnverifiedCaller(blank, 0)).toBe(true);
  });
  it.each([
    ['a card Checkout redisplays', blank, 1],
    ['an unknown card count', blank, null],
    ['a name', { ...blank, name: 'Ada' }, 0],
    ['a phone', { ...blank, phone: '+1555' }, 0],
    ['an address', { ...blank, address: { postal_code: '20001' } }, 0],
    ['a shipping address', { ...blank, shipping: { name: 'Ada' } }, 0],
    ['a deleted customer', { id: 'cus_1', deleted: true }, 0],
    ['no customer', null, 0],
  ])('is unsafe with %s', (_label, customer, count) => {
    expect(customerSafeForUnverifiedCaller(customer as any, count as any)).toBe(false);
  });
});

describe('payment mode, by customer plan', () => {
  const pay = (customerPlan: any) =>
    buildCheckoutSessionParams({ ...base, customerPlan, mode: 'payment' }) as Record<string, any>;

  it("charges a signed-in poster's own customer, shows their cards (app cards too), and offers save", () => {
    const p = pay({ customerId: 'cus_app', ownCustomer: true, createCustomer: false, offerSave: true });
    expect(p.customer).toBe('cus_app');
    expect(p.customer_email).toBeUndefined();
    expect(p.customer_creation).toBeUndefined();
    expect(p.saved_payment_method_options).toEqual({
      payment_method_save: 'enabled',
      allow_redisplay_filters: ['always', 'unspecified'],
    });
  });

  it("charges a matched account's customer without save or redisplay options", () => {
    const p = pay({ customerId: 'cus_app', ownCustomer: false, createCustomer: false, offerSave: false });
    expect(p.customer).toBe('cus_app');
    expect(p.saved_payment_method_options).toBeUndefined();
    // Never sets up the card for later on its own: only Stripe's checkbox does.
    expect(p.payment_intent_data.setup_future_usage).toBeUndefined();
  });

  it('a guest payment creates no customer', () => {
    const p = pay({ customerId: null, ownCustomer: false, createCustomer: false, offerSave: false });
    expect(p.customer).toBeUndefined();
    expect(p.customer_email).toBe('a@example.com');
    expect(p.customer_creation).toBe('if_required');
    expect(p.saved_payment_method_options).toBeUndefined();
  });

  it('a matched account without a customer gets one with save disabled', () => {
    const p = pay({ customerId: null, ownCustomer: false, createCustomer: true, offerSave: false });
    expect(p.customer_creation).toBe('always');
    expect(p.saved_payment_method_options).toBeUndefined();
  });

  it('never saves a card without the consent checkbox', () => {
    for (const offerSave of [true, false]) {
      const p = pay({ customerId: null, ownCustomer: false, createCustomer: true, offerSave });
      expect(p.payment_intent_data.setup_future_usage).toBeUndefined();
      expect(p.setup_future_usage).toBeUndefined();
    }
  });
});

describe('setup mode', () => {
  const setup = (over = {}) =>
    buildCheckoutSessionParams({ ...base, ...over, mode: 'setup' }) as Record<string, any>;

  it('collects a card and moves no money', () => {
    const p = setup();
    expect(p.mode).toBe('setup');
    expect(p.payment_method_types).toEqual(['card']);
    expect(p.line_items).toBeUndefined();
    expect(p.payment_intent_data).toBeUndefined();
    expect(p.customer_creation).toBeUndefined();
  });

  it('carries what the webhook routes on', () => {
    const p = setup();
    expect(p.metadata).toEqual(base.metadata);
    expect(p.client_reference_id).toBe('p1');
  });

  it('tells the poster about the later charge', () => {
    expect(setup({ amount: 19.5 }).custom_text.submit.message).toContain('up to $19.50');
    expect(setup().custom_text.submit.message).toContain("won't be charged today");
  });

  it('keeps a signed-in caller on their own customer', () => {
    const p = setup({
      customerPlan: { customerId: 'cus_1', ownCustomer: true, createCustomer: false, offerSave: true },
    });
    expect(p.customer).toBe('cus_1');
    expect(p.customer_email).toBeUndefined();
  });

  it("never puts a signed-out card on a matched account's customer", () => {
    const p = setup({
      customerPlan: { customerId: 'cus_theirs', ownCustomer: false, createCustomer: false, offerSave: false },
    });
    expect(p.customer).toBeUndefined();
    expect(p.customer_email).toBe('a@example.com');
    expect(p.saved_payment_method_options).toBeUndefined();
  });
});

describe('shortfall Checkout', () => {
  const input = {
    shortfallDollars: 12.5,
    bountyTitle: 'Walk my cat',
    posterId: 'poster-1',
    bountyId: 'bounty-1',
    requestId: 'request-1',
    email: 'a@example.com',
    existingCustomerId: null,
    returnUrl: 'https://www.bountyfinder.net/manage/?bounty=bounty-1&view=applicant',
    nowSeconds: 1000,
  };
  const build = (over = {}) =>
    buildShortfallSessionParams({ ...input, ...over }) as Record<string, any>;

  it('charges exactly the shortfall in USD', () => {
    const line = build().line_items[0].price_data;
    expect(line.unit_amount).toBe(1250);
    expect(line.currency).toBe('usd');
  });

  it.each([
    [0.3, 50],
    [0.5, 50],
    [0.51, 51],
    [19.99, 1999],
    [4.35, 435],
  ])('shortfallChargeCents(%s) = %s', (dollars, cents) => {
    expect(shortfallChargeCents(dollars)).toBe(cents);
  });

  it('keeps foreign currency out of the wallet', () => {
    expect(build().adaptive_pricing).toEqual({ enabled: false });
  });

  it('credits through the deposit webhook, to this poster', () => {
    expect(build().payment_intent_data.metadata).toEqual({
      purpose: 'wallet_deposit',
      user_id: 'poster-1',
      bounty_id: 'bounty-1',
      request_id: 'request-1',
    });
  });

  it('is ignored by the bounty-creation checkout handler', () => {
    expect(build().metadata.flow_type).not.toBe('bounty_creation');
    expect(build().metadata.pending_bounty_id).toBeUndefined();
  });

  it('returns only to the URL the server built', () => {
    const p = build();
    expect(p.success_url).toBe(`${input.returnUrl}&funding=returned`);
    expect(p.cancel_url).toBe(`${input.returnUrl}&funding=cancelled`);
  });

  it('uses the customer when there is one', () => {
    const p = build({ existingCustomerId: 'cus_1' });
    expect(p.customer).toBe('cus_1');
    expect(p.customer_email).toBeUndefined();
  });

  it('reuses a session for a double-click, not after the window or if the amount moves', () => {
    const key = shortfallIdempotencyKey('r', 1250, 6000);
    expect(shortfallIdempotencyKey('r', 1250, 6599)).toBe(key);
    expect(shortfallIdempotencyKey('r', 1250, 6600)).not.toBe(key);
    expect(shortfallIdempotencyKey('r', 900, 6000)).not.toBe(key);
  });
});

describe('checkoutReturnUrls: built on the server, never from the request', () => {
  const PROD = 'https://xwlwqzzphmmhghiqvkeu.supabase.co'
  const STAGING = 'https://gwumwpoomwvkjyibdmpj.supabase.co'

  it('uses the production site the request came from', () => {
    expect(checkoutReturnUrls({ origin: 'https://bountyfinder.net', source: 'web', supabaseUrl: PROD })).toEqual({
      successUrl: 'https://bountyfinder.net/#post-success',
      cancelUrl: 'https://bountyfinder.net/#post?checkout=cancelled',
    })
  })

  it('sends /bounty posts back to their own tab when cancelled', () => {
    expect(checkoutReturnUrls({ origin: 'https://www.bountyfinder.net', source: 'web_account', supabaseUrl: PROD }).cancelUrl)
      .toBe('https://www.bountyfinder.net/bounty?tab=post&checkout=cancelled')
  })

  it('falls back to www.bountyfinder.net for any other origin', () => {
    for (const origin of ['https://evil.example', 'http://www.bountyfinder.net', 'https://bountyfinder.net.evil.example', null, '']) {
      expect(checkoutReturnUrls({ origin, source: 'web', supabaseUrl: PROD }).successUrl).toBe('https://www.bountyfinder.net/#post-success')
    }
  })

  it('allows a local site only when this function runs on Staging', () => {
    expect(isAllowedReturnOrigin('http://localhost:8788', { supabaseUrl: STAGING })).toBe(true)
    expect(isAllowedReturnOrigin('http://127.0.0.1:5500', { supabaseUrl: STAGING })).toBe(true)
    expect(isAllowedReturnOrigin('http://localhost:8788', { supabaseUrl: PROD })).toBe(false)
    expect(isAllowedReturnOrigin('http://localhost.evil.example', { supabaseUrl: STAGING })).toBe(false)
  })

  it('allows extra https origins from the CORS list, never plain http', () => {
    expect(isAllowedReturnOrigin('https://preview.bountyfinder.net', { extraOrigins: ['https://preview.bountyfinder.net'] })).toBe(true)
    expect(isAllowedReturnOrigin('http://preview.example', { extraOrigins: ['http://preview.example'] })).toBe(false)
  })
})
