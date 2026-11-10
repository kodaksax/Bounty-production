/**
 * checkout.session.completed with mode = 'setup' and flow_type = 'bounty_creation':
 * the poster saved a card and nothing was charged. Saves the card and creates a
 * v1 at_accept bounty; accept-bounty-request charges the card at hire.
 *
 * Failure handling follows the payment-mode branch in index.ts. A transient
 * problem throws, so the 500 makes Stripe retry and the pending row stays open
 * for it. A terminal problem marks the pending row 'failed', writes a
 * checkout_processing_failures row and returns normally so Stripe stops.
 *
 * Every step is safe to repeat: lookups re-resolve, the card upsert is keyed on
 * stripe_payment_method_id, the RPC recognises a replay, and the failures table
 * is unique per session.
 *
 * Who the poster is decides what happens:
 *   - signed in when the session was opened (metadata.supabase_user_id, set by
 *     bounty-checkout from a verified token), or a brand-new account: save the
 *     card and create the bounty now.
 *   - signed out, and the email matches an existing account: typing an address
 *     proves nothing, so that account is not touched. The card is held on the
 *     pending row and a sign-in link goes to the address. Signing in only shows
 *     the post on the dashboard; it goes live when the owner confirms it there.
 */

import { ensureSolePaymentMethodDefault } from '../_shared/sole-payment-method-default.ts';

// deno-lint-ignore no-explicit-any
type AnyClient = any;

const DB_TIMEOUT_MS = 8000;
function withDbTimeout<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(Object.assign(new Error('DB_TIMEOUT'), { code: 'DB_TIMEOUT' })),
        DB_TIMEOUT_MS
      )
    ),
  ]);
}

function sanitizeText(input: unknown): string {
  if (!input) return '';
  return String(input).replace(/[<>]/g, '').trim().slice(0, 1000);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Retrying cannot change these: the row or the request itself is unacceptable. */
export function isTerminalBountyCreationError(error: { code?: string; message?: string }): boolean {
  return (
    // Posting rules (minimum amount, contact info, new-account cap).
    error.code === '23514' ||
    // A pending_bounty_id that is not a uuid.
    error.code === '22P02' ||
    (error.message ?? '').startsWith('fn_create_bounty_from_pending_deferred:')
  );
}

function idOf(value: unknown): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : (value as { id?: string }).id ?? null;
}

export interface DeferredSetupParams {
  supabase: AnyClient;
  stripe: AnyClient;
  session: {
    id: string;
    customer?: unknown;
    setup_intent?: unknown;
    metadata?: Record<string, string> | null;
    client_reference_id?: string | null;
    customer_details?: { email?: string | null } | null;
  };
  eventId: string;
  /** Sign-in link destination for a newly created account. */
  authRedirectUrl: string;
}

export async function handleDeferredBountySetup(params: DeferredSetupParams): Promise<void> {
  const { supabase, stripe, session, eventId, authRedirectUrl } = params;

  const pendingBountyId =
    sanitizeText(session.metadata?.pending_bounty_id ?? session.client_reference_id) || null;
  const checkoutEmail = sanitizeText(
    session.metadata?.customer_email ?? session.customer_details?.email ?? ''
  ).toLowerCase();

  const recordFailure = async (reason: string, opts: { pendingExists?: boolean } = {}) => {
    const linkable =
      opts.pendingExists !== false && pendingBountyId && UUID_PATTERN.test(pendingBountyId);

    // uq_checkout_failures_session allows one row per session, resolved or not.
    const { error: failErr } = (await withDbTimeout(
      supabase.from('checkout_processing_failures').upsert(
        {
          stripe_event_id: eventId,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: null,
          pending_bounty_id: linkable ? pendingBountyId : null,
          customer_email: checkoutEmail || null,
          amount: null,
          reason: sanitizeText(reason),
          session_metadata: session.metadata ?? {},
        },
        { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true }
      )
    )) as { error: unknown };
    if (failErr) {
      console.error('[webhooks] Could not record setup failure — rethrowing so Stripe retries', {
        sessionId: session.id,
        error: failErr,
      });
      throw failErr;
    }

    if (linkable) {
      // Never downgrades a row a concurrent delivery already converted.
      const { error: markErr } = (await withDbTimeout(
        supabase
          .from('pending_bounties')
          .update({ status: 'failed' })
          .eq('id', pendingBountyId)
          .neq('status', 'created')
      )) as { error: unknown };
      if (markErr) {
        console.error(
          '[webhooks] Could not mark pending bounty failed — rethrowing so Stripe retries',
          {
            sessionId: session.id,
            error: markErr,
          }
        );
        throw markErr;
      }
    }
  };

  if (!pendingBountyId) {
    console.error(
      `[webhooks] setup checkout.session ${session.id} is flow_type=bounty_creation but carries no pending_bounty_id`
    );
    await recordFailure('missing_pending_bounty_id');
    return;
  }

  // ── The card ──────────────────────────────────────────────────────────────
  const setupIntentId = idOf(session.setup_intent);
  if (!setupIntentId) {
    await recordFailure('missing_setup_intent');
    return;
  }

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
    expand: ['payment_method'],
  });
  if (setupIntent.status !== 'succeeded') {
    await recordFailure(`setup_intent_status_${setupIntent.status}`);
    return;
  }
  const paymentMethod = setupIntent.payment_method;
  if (!paymentMethod || typeof paymentMethod === 'string') {
    await recordFailure('setup_intent_has_no_payment_method');
    return;
  }
  if (paymentMethod.type !== 'card') {
    await recordFailure(`unsupported_payment_method_type_${paymentMethod.type}`);
    return;
  }

  // ── The poster (same resolution as the payment-mode branch) ──────────────
  const resolved = await resolvePoster({
    supabase,
    session,
    pendingBountyId,
    checkoutEmail,
    authRedirectUrl,
    recordFailure,
  });
  if (!resolved) return;

  // A card with no customer cannot be charged off-session. Checkout normally
  // attaches it; if the session was opened without a customer, attach it here.
  // Returns null after recording a terminal failure.
  const ensureCardCustomer = async (fallbackCustomerId: string | null): Promise<string | null> => {
    const existing = idOf(paymentMethod.customer);
    if (existing) return existing;
    let target = idOf(setupIntent.customer) ?? idOf(session.customer) ?? fallbackCustomerId;
    if (!target) {
      const customer = await stripe.customers.create(
        { email: checkoutEmail || undefined },
        { idempotencyKey: `setup_customer_${session.id}` }
      );
      target = customer.id as string;
    }
    try {
      await stripe.paymentMethods.attach(paymentMethod.id, { customer: target });
    } catch (attachErr) {
      const type = (attachErr as { type?: string }).type;
      if (type !== 'StripeCardError' && type !== 'StripeInvalidRequestError') throw attachErr;
      await recordFailure(`card_attach_failed: ${(attachErr as { code?: string }).code ?? type}`);
      return null;
    }
    return target;
  };

  // ── Existing account, signed-out caller: hold for sign-in ────────────────
  if (resolved.via === 'existing') {
    const heldCustomerId = await ensureCardCustomer(null);
    if (!heldCustomerId) return;

    const { error: holdErr } = (await withDbTimeout(
      supabase
        .from('pending_bounties')
        .update({
          status: 'awaiting_sign_in',
          claim_user_id: resolved.posterId,
          claim_requested_at: new Date().toISOString(),
          stripe_checkout_session_id: session.id,
          claim_card: {
            payment_method_id: paymentMethod.id,
            customer_id: heldCustomerId,
            brand: paymentMethod.card?.brand ?? null,
            last4: paymentMethod.card?.last4 ?? null,
            exp_month: paymentMethod.card?.exp_month ?? null,
            exp_year: paymentMethod.card?.exp_year ?? null,
          },
        })
        .eq('id', pendingBountyId)
        .in('status', ['pending_payment', 'paid'])
    )) as { error: { code?: string } | null };
    if (holdErr) {
      if (holdErr.code === '22P02') {
        await recordFailure('invalid_pending_bounty_id', { pendingExists: false });
        return;
      }
      throw holdErr;
    }

    // Re-read rather than trust the update: on a replay it matched nothing.
    const { data: held, error: heldErr } = (await withDbTimeout(
      supabase
        .from('pending_bounties')
        .select('status, claim_email_sent_at')
        .eq('id', pendingBountyId)
        .maybeSingle()
    )) as {
      data: { status: string; claim_email_sent_at: string | null } | null;
      error: unknown;
    };
    if (heldErr) throw heldErr;
    if (!held) {
      await recordFailure('pending_bounty_not_found', { pendingExists: false });
      return;
    }
    if (held.status !== 'awaiting_sign_in' || held.claim_email_sent_at) {
      console.log('[webhooks] setup checkout replay, hold already handled', {
        sessionId: session.id,
        pendingBountyId,
        status: held.status,
      });
      return;
    }

    // Supabase Auth's own delivery, as for new accounts. A failure throws: the
    // hold is safe and the retry sends it, because no sent-at was recorded.
    const { error: linkErr } = await supabase.auth.signInWithOtp({
      email: checkoutEmail,
      options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl },
    });
    if (linkErr) {
      console.error('[webhooks] Could not send the sign-in link — letting Stripe retry', {
        sessionId: session.id,
        pendingBountyId,
        error: linkErr,
      });
      throw linkErr;
    }

    const { error: sentErr } = (await withDbTimeout(
      supabase
        .from('pending_bounties')
        .update({ claim_email_sent_at: new Date().toISOString() })
        .eq('id', pendingBountyId)
    )) as { error: unknown };
    if (sentErr) throw sentErr;

    console.log('[webhooks] Setup checkout held until the account signs in', {
      sessionId: session.id,
      pendingBountyId,
    });
    return;
  }

  const posterId = resolved.posterId;

  // ── The customer ─────────────────────────────────────────────────────────
  const { data: profile, error: profileErr } = (await withDbTimeout(
    supabase.from('profiles').select('stripe_customer_id').eq('id', posterId).maybeSingle()
  )) as { data: { stripe_customer_id?: string | null } | null; error: unknown };
  if (profileErr) throw profileErr;
  const profileCustomerId = profile?.stripe_customer_id ?? null;

  const cardCustomerId = await ensureCardCustomer(profileCustomerId);
  if (!cardCustomerId) return;

  // Never replace an existing customer: that strands every card already on it.
  // accept-bounty-request only charges a card on the profile's own customer, so
  // a card on some other customer is recorded but must not become the default.
  const cardIsOnProfileCustomer = !profileCustomerId || profileCustomerId === cardCustomerId;
  if (!profileCustomerId) {
    const { error: customerErr } = (await withDbTimeout(
      supabase
        .from('profiles')
        .update({ stripe_customer_id: cardCustomerId })
        .eq('id', posterId)
        .is('stripe_customer_id', null)
    )) as { error: unknown };
    if (customerErr) throw customerErr;
  } else if (!cardIsOnProfileCustomer) {
    console.warn(
      '[webhooks] Setup session used a different Stripe customer than the profile — card saved, not made default',
      { sessionId: session.id, posterId, cardCustomerId, profileCustomerId }
    );
  }

  // ── Save it ──────────────────────────────────────────────────────────────
  if (cardIsOnProfileCustomer) {
    const { error: unsetErr } = (await withDbTimeout(
      supabase
        .from('payment_methods')
        .update({ is_default: false })
        .eq('user_id', posterId)
        .eq('is_default', true)
        .neq('stripe_payment_method_id', paymentMethod.id)
    )) as { error: unknown };
    if (unsetErr) throw unsetErr;
  }

  const { error: upsertErr } = (await withDbTimeout(
    supabase.from('payment_methods').upsert(
      {
        user_id: posterId,
        stripe_payment_method_id: paymentMethod.id,
        type: 'card',
        card_brand: paymentMethod.card?.brand ?? null,
        card_last4: paymentMethod.card?.last4 ?? null,
        card_exp_month: paymentMethod.card?.exp_month ?? null,
        card_exp_year: paymentMethod.card?.exp_year ?? null,
        is_default: cardIsOnProfileCustomer,
      },
      { onConflict: 'stripe_payment_method_id' }
    )
  )) as { error: unknown };
  if (upsertErr) throw upsertErr;

  // The row above is already the default when it is on the profile's customer;
  // this also sets Stripe's default when it is the only method. Non-fatal.
  await ensureSolePaymentMethodDefault({ supabase, stripe, userId: posterId, logTag: 'webhooks' });

  // ── The bounty ───────────────────────────────────────────────────────────
  const { data: rpcRows, error: rpcErr } = (await withDbTimeout(
    supabase.rpc('fn_create_bounty_from_pending_deferred', {
      p_pending_id: pendingBountyId,
      p_poster_id: posterId,
      p_setup_session_id: session.id,
      p_payment_method_id: paymentMethod.id,
    })
  )) as {
    data: unknown;
    error: { code?: string; message?: string } | null;
  };

  if (rpcErr) {
    if (isTerminalBountyCreationError(rpcErr)) {
      console.error('[webhooks] Deferred bounty refused — not retrying', {
        sessionId: session.id,
        pendingBountyId,
        error: rpcErr,
      });
      await recordFailure(`bounty_creation_refused: ${rpcErr.message ?? rpcErr.code}`, {
        pendingExists: !/ not found$/.test(rpcErr.message ?? ''),
      });
      return;
    }
    console.error(
      '[webhooks] fn_create_bounty_from_pending_deferred failed — letting Stripe retry',
      {
        sessionId: session.id,
        pendingBountyId,
        error: rpcErr,
      }
    );
    throw rpcErr;
  }

  const created = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  console.log('[webhooks] bounty_creation setup checkout processed', {
    sessionId: session.id,
    pendingBountyId,
    posterId,
    bountyId: (created as { bounty_id?: string } | null)?.bounty_id,
    newlyCreated: (created as { created?: boolean } | null)?.created,
  });
}

type ResolvedPoster = { posterId: string; via: 'authed' | 'new' | 'existing' };

/**
 * Copy of the payment-mode branch's account resolution, which is inline in
 * index.ts and left untouched: the id captured for a signed-in caller, else an
 * existing user with this address, else a new account plus its sign-in email.
 * This copy also reports which of those it was. Returns null after recording a
 * terminal failure.
 */
async function resolvePoster(args: {
  supabase: AnyClient;
  session: DeferredSetupParams['session'];
  pendingBountyId: string;
  checkoutEmail: string;
  authRedirectUrl: string;
  recordFailure: (reason: string) => Promise<void>;
}): Promise<ResolvedPoster | null> {
  const { supabase, session, pendingBountyId, checkoutEmail, authRedirectUrl, recordFailure } =
    args;

  const authedId = sanitizeText(session.metadata?.supabase_user_id) || null;
  if (authedId) return { posterId: authedId, via: 'authed' };

  // A retry of this same delivery, or a concurrent one, finds the account it
  // just created. That account is this submission's own, not someone else's.
  const classify = async (userId: string): Promise<ResolvedPoster> => {
    const { data, error } = (await withDbTimeout(supabase.auth.admin.getUserById(userId))) as {
      data: { user?: { user_metadata?: Record<string, unknown> } } | null;
      error: unknown;
    };
    if (error) throw error;
    const ours = data?.user?.user_metadata?.pending_bounty_id === pendingBountyId;
    return { posterId: userId, via: ours ? 'new' : 'existing' };
  };

  if (checkoutEmail) {
    const { data: existingId, error: findErr } = (await withDbTimeout(
      supabase.rpc('fn_find_user_id_by_email', { p_email: checkoutEmail })
    )) as { data: string | null; error: unknown };
    if (findErr) {
      console.error('[webhooks] Poster lookup failed — letting Stripe retry', {
        sessionId: session.id,
        error: findErr,
      });
      throw findErr;
    }
    if (existingId) return classify(existingId);
  }

  if (!checkoutEmail) {
    await recordFailure('no_email_to_resolve_poster');
    return null;
  }

  const { data: createdUser, error: createErr } = await supabase.auth.admin.createUser({
    email: checkoutEmail,
    email_confirm: true,
    user_metadata: { source: 'bounty_checkout_web', pending_bounty_id: pendingBountyId },
  });

  if (createErr) {
    const isEmailConflict =
      (createErr as { status?: number }).status === 422 ||
      /already (registered|exists)/i.test(createErr.message ?? '');
    if (!isEmailConflict) throw createErr;

    const { data: racedId, error: raceErr } = (await withDbTimeout(
      supabase.rpc('fn_find_user_id_by_email', { p_email: checkoutEmail })
    )) as { data: string | null; error: unknown };
    if (raceErr) throw raceErr;
    if (!racedId) {
      await recordFailure(
        'account_creation_failed: re-resolve returned no user after 422 conflict'
      );
      return null;
    }
    return classify(racedId);
  }

  const posterId: string | null = createdUser?.user?.id ?? null;
  if (!posterId) {
    await recordFailure('account_creation_returned_no_id');
    return null;
  }

  const { error: emailErr } = (await withDbTimeout(
    supabase.from('profiles').update({ email: checkoutEmail }).eq('id', posterId)
  )) as { error: unknown };
  if (emailErr) {
    console.error('[webhooks] Could not backfill profile email (non-fatal)', {
      posterId,
      error: emailErr,
    });
  }

  // This account has no password and only the poster can accept a hunter, so the
  // way in goes out now. Non-fatal for the same reason as the payment branch:
  // "forgot password" on this address also works.
  const { error: signInEmailErr } = await supabase.auth.resetPasswordForEmail(checkoutEmail, {
    redirectTo: authRedirectUrl,
  });
  if (signInEmailErr) {
    console.error(
      '[webhooks] CRITICAL: created a web poster account but could not send its sign-in email',
      { posterId, sessionId: session.id, error: signInEmailErr }
    );
  }

  return { posterId, via: 'new' };
}
