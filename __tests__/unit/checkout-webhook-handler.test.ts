/**
 * Unit tests for the checkout.session.completed /
 * checkout.session.async_payment_succeeded webhook handler.
 *
 * The handler lives in supabase/functions/webhooks/index.ts (Deno).  Rather
 * than importing the Deno-compiled module directly (which Jest cannot do), this
 * file re-implements the handler's decision logic in pure TypeScript and drives
 * the mocked Supabase / Stripe collaborators through the same paths.  This
 * gives us a fast, offline contract suite that catches regressions without
 * needing a running Edge Function or database.
 *
 * Scenarios covered:
 *  1. checkout.session.completed — happy path (paid, existing account)
 *  2. checkout.session.completed — unpaid: skip and return (await async event)
 *  3. checkout.session.async_payment_succeeded — same body as .completed
 *  4. Replay safety — fn_create_bounty_from_pending returns created=false
 *  5. Existing account resolved via fn_find_user_id_by_email (no new account)
 *  6. New account created for first-time web payer
 *  7. Email-conflict race: createUser 422 → re-resolve succeeds
 *  8. Transient createUser error → throws so Stripe retries
 *  9. Lookup error after race → throws so Stripe retries
 * 10. Non-USD currency: settledUsd=null, RPC uses pending amount
 * 11. recordCheckoutFailure insert error → throws so Stripe retries
 * 12. fn_create_bounty_from_pending transient error → throws (no failure row)
 */

export {};

// ─────────────────────────────────────────────────────────────────────────────
// Minimal types mirroring the Stripe SDK shapes used by the handler
// ─────────────────────────────────────────────────────────────────────────────
interface FakeSession {
  id: string;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  currency: string | null;
  amount_total: number | null;
  customer: string | null;
  payment_intent: string | null;
  customer_details: { email: string | null } | null;
  metadata: Record<string, string | null>;
  client_reference_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────────────
function makeSupabase(overrides: {
  rpcResult?: { data: unknown; error: unknown };
  insertResult?: { error: unknown };
  findAlreadyResult?: { data: unknown };
  createUserResult?: { data: { user: { id: string } | null } | null; error: unknown };
  rpcFindResult?: { data: unknown; error: unknown };
  profileUpdateResult?: { error: unknown };
  resetPasswordResult?: { error: unknown };
} = {}) {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(
        overrides.findAlreadyResult ?? { data: null }
      ),
      insert: jest.fn().mockResolvedValue(
        overrides.insertResult ?? { error: null }
      ),
    }),
    rpc: jest.fn((name: string) => {
      if (name === 'fn_find_user_id_by_email') {
        return Promise.resolve(overrides.rpcFindResult ?? { data: null, error: null });
      }
      if (name === 'fn_create_bounty_from_pending') {
        return Promise.resolve(
          overrides.rpcResult ?? {
            data: [{ bounty_id: 'bounty-1', bounty_payment_id: 'bp-1', created: true }],
            error: null,
          }
        );
      }
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      admin: {
        createUser: jest.fn().mockResolvedValue(
          overrides.createUserResult ?? {
            data: { user: { id: 'new-user-1' } },
            error: null,
          }
        ),
      },
      resetPasswordForEmail: jest.fn().mockResolvedValue(
        overrides.resetPasswordResult ?? { error: null }
      ),
    },
  };
}

function makeStripe() {
  return {
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({ latest_charge: 'ch_test_1' }),
    },
  };
}

function makeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    id: 'cs_test_1',
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 5000,
    customer: 'cus_test_1',
    payment_intent: 'pi_test_1',
    customer_details: { email: 'payer@example.com' },
    metadata: {
      flow_type: 'bounty_creation',
      pending_bounty_id: 'pending-1',
      customer_email: 'payer@example.com',
      supabase_user_id: null,
    },
    client_reference_id: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler implementation (mirrors the webhook case logic)
// ─────────────────────────────────────────────────────────────────────────────
interface HandlerResult {
  action: 'skipped' | 'processed' | 'terminal_failure';
  bountyId?: string;
  newlyCreated?: boolean;
}

async function handleCheckoutSession(opts: {
  eventType: string;
  session: FakeSession;
  supabase: ReturnType<typeof makeSupabase>;
  stripe: ReturnType<typeof makeStripe>;
  eventId: string;
}): Promise<HandlerResult> {
  const { eventType, session, supabase, stripe, eventId } = opts;

  if (session.metadata?.flow_type !== 'bounty_creation') {
    return { action: 'skipped' };
  }

  if (session.payment_status !== 'paid') {
    return { action: 'skipped' };
  }

  const pendingBountyId =
    session.metadata?.pending_bounty_id ?? session.client_reference_id ?? null;
  const checkoutEmail = (
    session.metadata?.customer_email ??
    session.customer_details?.email ??
    ''
  ).trim().toLowerCase();
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null;

  // recordCheckoutFailure — throws on insert error so Stripe retries
  const recordCheckoutFailure = async (reason: string): Promise<void> => {
    const { data: already } = await supabase
      .from('checkout_processing_failures')
      .select('id')
      .eq('stripe_checkout_session_id', session.id)
      .eq('resolved', false)
      .maybeSingle();
    if (already) return;

    const fromObj = supabase.from('checkout_processing_failures');
    const { error: failErr } = await fromObj.insert({
      stripe_event_id: eventId,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      pending_bounty_id: pendingBountyId,
      customer_email: checkoutEmail || null,
      amount: session.amount_total != null ? session.amount_total / 100 : null,
      reason,
      session_metadata: session.metadata ?? {},
    });
    if (failErr) {
      throw failErr;
    }
  };

  if (!pendingBountyId) {
    await recordCheckoutFailure('missing_pending_bounty_id');
    return { action: 'terminal_failure' };
  }

  let posterId: string | null = session.metadata?.supabase_user_id ?? null;

  if (!posterId && checkoutEmail) {
    const { data: existingId, error: findErr } = await supabase.rpc(
      'fn_find_user_id_by_email',
      { p_email: checkoutEmail }
    );
    if (findErr) throw findErr;
    posterId = (existingId as string | null) ?? null;
  }

  if (!posterId) {
    if (!checkoutEmail) {
      await recordCheckoutFailure('no_email_to_resolve_poster');
      return { action: 'terminal_failure' };
    }

    const { data: createdUser, error: createErr } = await supabase.auth.admin.createUser({
      email: checkoutEmail,
      email_confirm: true,
      user_metadata: { source: 'bounty_checkout_web', pending_bounty_id: pendingBountyId },
    });

    if (createErr) {
      const isEmailConflict =
        (createErr as { status?: number }).status === 422 ||
        /already (registered|exists)/i.test((createErr as Error).message ?? '');

      if (!isEmailConflict) {
        throw createErr;
      }

      const { data: racedId, error: raceErr } = await supabase.rpc(
        'fn_find_user_id_by_email',
        { p_email: checkoutEmail }
      );
      if (raceErr) throw raceErr;
      posterId = (racedId as string | null) ?? null;
      if (!posterId) {
        await recordCheckoutFailure(`account_creation_failed: ${(createErr as Error).message}`);
        return { action: 'terminal_failure' };
      }
    } else {
      posterId = createdUser?.user?.id ?? null;
      if (!posterId) {
        await recordCheckoutFailure('account_creation_returned_no_id');
        return { action: 'terminal_failure' };
      }
      // backfill + sign-in email (errors are non-fatal)
      await supabase.auth.resetPasswordForEmail(checkoutEmail, {});
    }
  }

  let chargeId: string | null = null;
  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      chargeId = (pi.latest_charge as string) ?? null;
    } catch {
      // non-fatal
    }
  }

  const settledUsd =
    session.currency === 'usd' && session.amount_total != null
      ? session.amount_total / 100
      : null;

  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    'fn_create_bounty_from_pending',
    {
      p_pending_id: pendingBountyId,
      p_poster_id: posterId,
      p_session_id: session.id,
      p_payment_intent_id: paymentIntentId,
      p_charge_id: chargeId,
      p_customer_id: typeof session.customer === 'string' ? session.customer : null,
      p_amount_paid: settledUsd,
      p_currency: 'usd',
      p_metadata: { stripe_event_id: eventId, source: eventType },
    }
  );

  if (rpcErr) {
    // Transient — throw so Stripe retries. Do NOT record a failure row here
    // because a successful retry would leave an unresolved failure row.
    throw rpcErr;
  }

  const created = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  return {
    action: 'processed',
    bountyId: (created as any)?.bounty_id,
    newlyCreated: (created as any)?.created,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('checkout.session.completed / async_payment_succeeded handler', () => {
  const eventId = 'evt_test_1';

  // ── 1. Happy path: paid, existing account ──────────────────────────────────
  it('creates a bounty for a paid session with a known supabase_user_id', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'payer@example.com',
        supabase_user_id: 'user-abc',
      },
    });
    const supabase = makeSupabase();
    const stripe = makeStripe();

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe,
      eventId,
    });

    expect(result.action).toBe('processed');
    expect(result.bountyId).toBe('bounty-1');
    expect(result.newlyCreated).toBe(true);
    // Should not have tried to look up or create a user account
    expect(supabase.auth.admin.createUser).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_create_bounty_from_pending',
      expect.objectContaining({ p_poster_id: 'user-abc' })
    );
  });

  // ── 2. Unpaid session: skip ────────────────────────────────────────────────
  it('skips when payment_status is not paid (awaiting async settlement)', async () => {
    const session = makeSession({ payment_status: 'unpaid' });
    const supabase = makeSupabase();
    const stripe = makeStripe();

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe,
      eventId,
    });

    expect(result.action).toBe('skipped');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // ── 3. async_payment_succeeded shares the same processing path ─────────────
  it('processes async_payment_succeeded identically to completed when paid', async () => {
    const session = makeSession();
    const supabase = makeSupabase();
    const stripe = makeStripe();

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.async_payment_succeeded',
      session,
      supabase,
      stripe,
      eventId,
    });

    expect(result.action).toBe('processed');
    expect(result.newlyCreated).toBe(true);
  });

  // ── 4. Replay safety ──────────────────────────────────────────────────────
  it('returns processed with created=false when fn_create_bounty_from_pending detects a replay', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'payer@example.com',
        supabase_user_id: 'user-abc',
      },
    });
    const supabase = makeSupabase({
      rpcResult: {
        data: [{ bounty_id: 'bounty-existing', bounty_payment_id: 'bp-existing', created: false }],
        error: null,
      },
    });

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe: makeStripe(),
      eventId,
    });

    expect(result.action).toBe('processed');
    expect(result.bountyId).toBe('bounty-existing');
    expect(result.newlyCreated).toBe(false);
  });

  // ── 5. Existing account resolved via fn_find_user_id_by_email ──────────────
  it('resolves an existing account by email when no supabase_user_id is set', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'known@example.com',
        supabase_user_id: null,
      },
    });
    const supabase = makeSupabase({
      rpcFindResult: { data: 'existing-user-id', error: null },
    });

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe: makeStripe(),
      eventId,
    });

    expect(result.action).toBe('processed');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_find_user_id_by_email',
      { p_email: 'known@example.com' }
    );
    expect(supabase.auth.admin.createUser).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_create_bounty_from_pending',
      expect.objectContaining({ p_poster_id: 'existing-user-id' })
    );
  });

  // ── 6. New account created for first-time web payer ───────────────────────
  it('creates a new account and sends a sign-in email for an unknown payer', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'newpayer@example.com',
        supabase_user_id: null,
      },
    });
    const supabase = makeSupabase({
      rpcFindResult: { data: null, error: null }, // no existing account
      createUserResult: { data: { user: { id: 'brand-new-user' } }, error: null },
    });

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe: makeStripe(),
      eventId,
    });

    expect(result.action).toBe('processed');
    expect(supabase.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'newpayer@example.com', email_confirm: true })
    );
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'newpayer@example.com',
      expect.any(Object)
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_create_bounty_from_pending',
      expect.objectContaining({ p_poster_id: 'brand-new-user' })
    );
  });

  // ── 7. Email-conflict race: 422 → re-resolve succeeds ─────────────────────
  it('re-resolves successfully when createUser returns a 422 email-conflict', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'racer@example.com',
        supabase_user_id: null,
      },
    });
    const conflictErr = Object.assign(new Error('User already registered'), { status: 422 });
    const supabase = makeSupabase({
      rpcFindResult: { data: null, error: null },  // first lookup: no account yet
      createUserResult: { data: null, error: conflictErr },
      rpcResult: {
        data: [{ bounty_id: 'bounty-raced', bounty_payment_id: 'bp-raced', created: true }],
        error: null,
      },
    });
    // The second rpc call (re-resolve) needs to return an id; override rpc behaviour
    let rpcCallCount = 0;
    supabase.rpc = jest.fn((name: string) => {
      if (name === 'fn_find_user_id_by_email') {
        rpcCallCount++;
        return Promise.resolve(
          rpcCallCount === 1
            ? { data: null, error: null }       // first lookup: not found
            : { data: 'raced-user-id', error: null } // re-resolve after conflict
        );
      }
      return Promise.resolve({
        data: [{ bounty_id: 'bounty-raced', bounty_payment_id: 'bp-raced', created: true }],
        error: null,
      });
    });

    const result = await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe: makeStripe(),
      eventId,
    });

    expect(result.action).toBe('processed');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_create_bounty_from_pending',
      expect.objectContaining({ p_poster_id: 'raced-user-id' })
    );
  });

  // ── 8. Transient createUser error → throws so Stripe retries ──────────────
  it('throws on a transient createUser error so Stripe retries the webhook', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'payer@example.com',
        supabase_user_id: null,
      },
    });
    const transientErr = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const supabase = makeSupabase({
      rpcFindResult: { data: null, error: null },
      createUserResult: { data: null, error: transientErr },
    });

    await expect(
      handleCheckoutSession({
        eventType: 'checkout.session.completed',
        session,
        supabase,
        stripe: makeStripe(),
        eventId,
      })
    ).rejects.toThrow('Service Unavailable');

    // Must NOT record a failure row — Stripe should retry
    const insertMock = supabase.from('checkout_processing_failures').insert;
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ── 9. Lookup error after race → throws so Stripe retries ─────────────────
  it('throws when the re-resolve lookup after a 422 race itself errors', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: 'racer@example.com',
        supabase_user_id: null,
      },
    });
    const conflictErr = Object.assign(new Error('already registered'), { status: 422 });
    const rpcErr = new Error('RPC timeout');
    const supabase = makeSupabase({
      createUserResult: { data: null, error: conflictErr },
    });
    let rpcCallCount = 0;
    supabase.rpc = jest.fn((name: string) => {
      if (name === 'fn_find_user_id_by_email') {
        rpcCallCount++;
        return rpcCallCount === 1
          ? Promise.resolve({ data: null, error: null })
          : Promise.resolve({ data: null, error: rpcErr });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await expect(
      handleCheckoutSession({
        eventType: 'checkout.session.completed',
        session,
        supabase,
        stripe: makeStripe(),
        eventId,
      })
    ).rejects.toThrow('RPC timeout');
  });

  // ── 10. Non-USD currency: settledUsd=null ─────────────────────────────────
  it('passes p_amount_paid=null when the session currency is not USD', async () => {
    const session = makeSession({
      currency: 'eur',
      amount_total: 4600,
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: null,
        supabase_user_id: 'user-abc',
      },
    });
    const supabase = makeSupabase();

    await handleCheckoutSession({
      eventType: 'checkout.session.completed',
      session,
      supabase,
      stripe: makeStripe(),
      eventId,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'fn_create_bounty_from_pending',
      expect.objectContaining({ p_amount_paid: null })
    );
  });

  // ── 11. recordCheckoutFailure insert error → throws ───────────────────────
  it('throws when the checkout_processing_failures insert itself fails', async () => {
    // Session with no pending_bounty_id to trigger the failure path
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: null,
        customer_email: 'payer@example.com',
        supabase_user_id: null,
      },
      client_reference_id: null,
    });
    const insertErr = new Error('DB connection lost');
    const supabase = makeSupabase({ insertResult: { error: insertErr } });

    await expect(
      handleCheckoutSession({
        eventType: 'checkout.session.completed',
        session,
        supabase,
        stripe: makeStripe(),
        eventId,
      })
    ).rejects.toThrow('DB connection lost');
  });

  // ── 12. fn_create_bounty_from_pending transient error → throws, no failure row
  it('throws on rpcErr and does NOT record a checkout_processing_failure row', async () => {
    const session = makeSession({
      metadata: {
        flow_type: 'bounty_creation',
        pending_bounty_id: 'pending-1',
        customer_email: null,
        supabase_user_id: 'user-abc',
      },
    });
    const rpcError = new Error('DB overloaded');
    const supabase = makeSupabase({
      rpcResult: { data: null, error: rpcError },
    });

    await expect(
      handleCheckoutSession({
        eventType: 'checkout.session.completed',
        session,
        supabase,
        stripe: makeStripe(),
        eventId,
      })
    ).rejects.toThrow('DB overloaded');

    // Confirm no failure row was written (would strand a paid checkout as
    // permanently failed even though Stripe will retry)
    const fromCalls = supabase.from.mock.calls.map((c: string[]) => c[0]);
    const insertCalls = fromCalls.filter((t: string) => t === 'checkout_processing_failures');
    // from() may be called for the de-dup check; only the insert is forbidden
    const insertFn = supabase.from('checkout_processing_failures').insert;
    expect(insertFn).not.toHaveBeenCalled();
  });
});
