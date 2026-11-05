import {
  buildCheckoutSessionParams,
  checkoutModeForSwitch,
} from '../../supabase/functions/bounty-checkout/logic';

const base = {
  amount: 25,
  title: 'Walk my cat',
  description: 'A long enough description',
  email: 'a@example.com',
  existingCustomerId: null,
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
      success_url: 'https://x.test/done?session_id={CHECKOUT_SESSION_ID}&pending_bounty_id=p1',
      cancel_url: 'https://x.test/back',
      client_reference_id: 'p1',
      metadata: base.metadata,
      payment_intent_data: { metadata: { ...base.metadata, purpose: 'bounty_escrow_checkout' } },
      expires_at: 2800,
    });
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
    const p = setup({ existingCustomerId: 'cus_1' });
    expect(p.customer).toBe('cus_1');
    expect(p.customer_email).toBeUndefined();
  });
});
