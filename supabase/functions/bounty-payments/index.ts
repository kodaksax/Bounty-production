// Supabase Edge Function: bounty-payments
//
// Phase 2 Stripe-native per-bounty escrow (payment_architecture_version = 2).
// Isolated from the legacy wallet/payments/connect functions so the existing
// custodial-wallet flow (version 1) keeps working unchanged.
//
// Money flow:
//   Poster --PaymentIntent(transfer_group=bounty_<id>, capture=automatic)--> platform balance (Charge)
//   platform balance --Transfer(source_transaction=charge, destination=hunter)--> Hunter's Connect acct
//
// Routes:
//   POST /bounty-payments/create   — poster funds a bounty (creates PaymentIntent)
//   POST /bounty-payments/release  — release captured funds to the hunter (Transfer)
//   POST /bounty-payments/cancel   — cancel (pre-capture) or refund (post-capture)
//
// Lifecycle is tracked in public.bounty_payments; the webhooks function
// advances status on payment_intent.succeeded / .canceled / charge.refunded /
// transfer.failed. This function performs the synchronous state transitions.

// Local type shims so `tsc --noEmit` (Node tooling) doesn't error on Deno
// runtime imports/globals. Intentionally loose so the repo can typecheck
// without pulling runtime deps into the monorepo build.
// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-ignore: Allow runtime npm import for Deno/edge function.
import Stripe from 'npm:stripe@14';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function generateRequestId(prefix = 'bounty_payments'): string {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function jsonResponse(data: unknown, status = 200, requestId?: string) {
  const body =
    requestId && data && typeof data === 'object' && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>), requestId }
      : data;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
  });
}

// Wrap DB queries in a timeout so a paused/cold-starting DB returns a fast 503
// instead of hanging (mirrors payments/wallet functions).
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

function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Resolve (or lazily create) the poster's Stripe Customer. Mirrors the exact
// approach used by the payments function: reuse profiles.stripe_customer_id,
// recreate on stale (resource_missing), persist via .update() (never .upsert(),
// which would try an INSERT and trip NOT NULL columns like username).
async function resolveStripeCustomerForUser(params: {
  supabaseAdmin: any;
  stripe: any;
  userId: string;
  userEmail?: string;
}): Promise<{ customerId?: string; error?: string; status?: number }> {
  const { supabaseAdmin, stripe, userId, userEmail } = params;

  const profileRes = (await withDbTimeout(
    supabaseAdmin
      .from('profiles')
      .select('id, stripe_customer_id, email')
      .eq('id', userId)
      .maybeSingle()
  )) as any;
  const profile = profileRes?.data;
  const profileError = profileRes?.error;

  if (!profile && !profileError) {
    return {
      error: 'User profile not found. Please complete your profile setup and try again.',
      status: 404,
    };
  }

  let customerId: string | null = profile?.stripe_customer_id ?? null;
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
      return { customerId };
    } catch (err: any) {
      if (err?.code === 'resource_missing') {
        customerId = null;
        try {
          await withDbTimeout(
            supabaseAdmin.from('profiles').update({ stripe_customer_id: null }).eq('id', userId)
          );
        } catch (_clearErr) {
          /* best-effort */
        }
      } else {
        throw err;
      }
    }
  }

  const resolvedEmail = sanitizeText(profile?.email ?? userEmail ?? '');
  if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
    return {
      error:
        'No valid email found for this account. Please update your profile email and try again.',
      status: 400,
    };
  }

  const customer = await stripe.customers.create({
    email: resolvedEmail,
    metadata: { user_id: userId },
  });
  customerId = customer.id;

  const updatePatch: Record<string, unknown> = { stripe_customer_id: customerId };
  if (!profile?.email && resolvedEmail) updatePatch.email = resolvedEmail;
  const saveRes = (await withDbTimeout(
    supabaseAdmin.from('profiles').update(updatePatch).eq('id', userId)
  )) as any;
  if (saveRes?.error) {
    // Fallback: targeted update of just the customer id.
    try {
      await withDbTimeout(
        supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)
      );
    } catch (_fallbackErr) {
      /* best-effort — customer still returned; a later call will re-persist */
    }
  }

  // customerId is guaranteed non-null here (just set from a created customer);
  // the declared type is `string | null` only because of the stale-id reset path.
  return { customerId: customerId as string };
}

// Statuses that count as an "active" (non-terminal, non-cancelable) escrow.
// A row in one of these states means the bounty is already funded/held, so a
// second /create is idempotent (return the existing PI) rather than a new PI.
const ACTIVE_BP_STATUSES = [
  'pending_payment',
  'authorized',
  'captured',
  'release_pending',
  'released',
  'refund_pending',
  'refunded',
  'disputed',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = req.headers.get('x-request-id')?.slice(0, 120) || generateRequestId();
  const reply = (data: Record<string, unknown>, status = 200) =>
    jsonResponse(data, status, requestId);
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/bounty-payments');
  const subPath = pathParts.length > 1 ? pathParts[1] : '/';

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return reply(
      { error: 'Payment service is not configured.', code: 'stripe_not_configured' },
      500
    );
  }
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authenticate the caller from the Authorization header.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return reply(
      {
        error: 'Authentication required. Please sign in to continue.',
        code: 'authentication_required',
      },
      401
    );
  }
  const token = authHeader.substring(7);
  let authResult: any;
  try {
    authResult = await withDbTimeout(supabaseAdmin.auth.getUser(token));
  } catch (e: any) {
    if (e?.code === 'DB_TIMEOUT') {
      return reply(
        {
          error: 'Service temporarily unavailable. Please try again shortly.',
          code: 'db_timeout',
          retryable: true,
        },
        503
      );
    }
    throw e;
  }
  const { data: { user } = { user: null }, error: authError } = authResult as any;
  if (authError || !user) {
    console.warn('[bounty-payments] invalid or expired token', {
      requestId,
      hasUser: !!user,
      errorName: authError?.name,
      errorMessage: authError?.message,
      errorStatus: authError?.status,
      errorCode: authError?.code,
    });
    return reply(
      {
        error: 'Authentication required. Please sign in to continue.',
        code: 'authentication_required',
      },
      401
    );
  }
  const userId = user.id;
  const userEmail = sanitizeText(user.email ?? '');

  const PLATFORM_FEE_PERCENT = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '5');

  try {
    // ───────────────────────────────────────────────────────────────────────
    // POST /bounty-payments/create — poster funds a specific bounty
    // ───────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/create') {
      const body = await req.json().catch(() => ({}));
      const bountyId = sanitizeText(body?.bountyId ?? body?.bounty_id);
      if (!bountyId) {
        return reply({ error: 'bountyId is required.', code: 'bounty_id_required' }, 400);
      }

      // Look up the bounty. NOTE: we auth against poster_id (100% populated,
      // canonical) rather than the legacy user_id column (NULL on some rows).
      const { data: bounty, error: bountyErr } = (await withDbTimeout(
        supabaseAdmin
          .from('bounties')
          .select('id, poster_id, user_id, amount, is_for_honor, status')
          .eq('id', bountyId)
          .maybeSingle()
      )) as any;

      if (bountyErr) {
        return reply(
          { error: 'Failed to load bounty.', code: 'bounty_load_failed', retryable: true },
          500
        );
      }
      if (!bounty) {
        return reply({ error: 'Bounty not found.', code: 'bounty_not_found' }, 404);
      }

      const posterId = bounty.poster_id ?? bounty.user_id;
      if (posterId !== userId) {
        return reply({ error: 'Only the poster can fund this bounty.', code: 'not_poster' }, 403);
      }
      if (bounty.is_for_honor) {
        return reply({ error: 'Honor bounties are not funded.', code: 'is_for_honor' }, 400);
      }

      const amount = Number(bounty.amount);
      if (!isFinite(amount) || amount <= 0) {
        return reply(
          { error: 'Bounty amount must be greater than zero.', code: 'invalid_amount' },
          400
        );
      }
      const amountCents = Math.round(amount * 100);
      if (amountCents < 50) {
        return reply(
          { error: 'Bounty amount must be at least $0.50.', code: 'amount_too_small' },
          400
        );
      }

      // ───────────────────────────────────────────────────────────────────
      // v3 (payment_architecture_version = 3) — per-bounty manual-capture
      // PaymentIntent. Routing is decided server-side by fn_should_use_v3,
      // which defaults to off and, when on, is cohort/percentage gated.
      //
      // Everything below this block is the untouched v1/v2 path: a poster who
      // is not in the v3 cohort takes exactly the code that ran before.
      //
      // NOTE ON capture_method: the v2 path deliberately uses 'automatic'
      // because a manual-capture authorization is auto-canceled by Stripe
      // after ~7 days. v3 accepts that window by design: no completed bounty
      // has ever taken longer than 2 days (n=18, p90 0.47d), and an expired
      // authorization is handled as a first-class state (bounty_v3_funding
      // 'expired' + needs_reauthorization) rather than as a lost payment.
      // ───────────────────────────────────────────────────────────────────
      let useV3 = false;
      try {
        const { data: v3Flag, error: v3FlagErr } = (await withDbTimeout(
          supabaseAdmin.rpc('fn_should_use_v3', { p_user_id: userId })
        )) as any;
        if (v3FlagErr) {
          // Fail closed: an unreadable flag must never silently reroute money.
          console.error('[bounty-payments] fn_should_use_v3 failed; defaulting to v1/v2', {
            bountyId,
            userId,
            requestId,
            v3FlagErr,
          });
        } else {
          useV3 = v3Flag === true;
        }
      } catch (flagErr) {
        console.error('[bounty-payments] fn_should_use_v3 threw; defaulting to v1/v2', {
          bountyId,
          requestId,
          flagErr,
        });
      }

      if (useV3) {
        const v3TransferGroup = `bounty_${bountyId}`;

        // Idempotency: reuse a live authorization rather than creating a
        // second hold on the poster's card.
        const { data: existingV3 } = (await withDbTimeout(
          supabaseAdmin
            .from('bounty_v3_funding')
            .select('bounty_id, state, stripe_payment_intent_id, amount_cents')
            .eq('bounty_id', bountyId)
            .maybeSingle()
        )) as any;

        if (
          existingV3 &&
          ['authorizing', 'authorized'].includes(existingV3.state) &&
          existingV3.stripe_payment_intent_id
        ) {
          try {
            const existingPi = await stripe.paymentIntents.retrieve(
              existingV3.stripe_payment_intent_id
            );
            if (!['canceled', 'succeeded'].includes(existingPi.status)) {
              return reply({
                bountyPaymentId: bountyId,
                paymentIntentId: existingPi.id,
                clientSecret: existingPi.client_secret,
                status: existingV3.state,
                amount,
                architectureVersion: 3,
                reused: true,
              });
            }
          } catch (piErr: any) {
            if (piErr?.code !== 'resource_missing') throw piErr;
          }
        }

        const v3Customer = await resolveStripeCustomerForUser({
          supabaseAdmin,
          stripe,
          userId,
          userEmail,
        });
        if (v3Customer.error || !v3Customer.customerId) {
          return reply(
            {
              error: v3Customer.error ?? 'Unable to create customer profile',
              code: 'customer_resolution_failed',
            },
            v3Customer.status ?? 400
          );
        }

        const v3PaymentIntent = await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: 'usd',
            customer: v3Customer.customerId,
            capture_method: 'manual',
            automatic_payment_methods: { enabled: true },
            transfer_group: v3TransferGroup,
            metadata: {
              user_id: userId,
              bounty_id: bountyId,
              purpose: 'bounty_escrow_v3',
              payment_architecture_version: '3',
              request_id: requestId,
            },
          },
          // Stripe-level idempotency: a retried publish cannot create a
          // second authorization for the same bounty.
          { idempotencyKey: `v3_bounty_authorize_${bountyId}` }
        );

        // Roll the authorization back if we cannot record it. An unrecorded
        // hold on a real card is the one outcome worth failing loudly for.
        const rollbackV3 = async (reason: string, detail: unknown) => {
          console.error(`[bounty-payments] v3 ${reason}`, { bountyId, requestId, detail });
          await stripe.paymentIntents.cancel(v3PaymentIntent.id).catch(() => {});
        };

        const { error: fundErr } = (await withDbTimeout(
          supabaseAdmin.from('bounty_v3_funding').upsert(
            {
              bounty_id: bountyId,
              state: 'authorizing',
              stripe_payment_intent_id: v3PaymentIntent.id,
              transfer_group: v3TransferGroup,
              amount_cents: amountCents,
              last_error_code: null,
              last_error_message: null,
              needs_reauthorization: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'bounty_id' }
          )
        )) as any;
        if (fundErr) {
          await rollbackV3('funding row write failed', fundErr);
          return reply(
            {
              error: 'Failed to record bounty payment. No charge was made.',
              code: 'payment_record_failed',
              retryable: true,
            },
            500
          );
        }

        // The v3 ledger row. v3 writes neither bounty_payments (retired) nor
        // wallet_transactions (v1-only).
        const { error: ledgerErr } = (await withDbTimeout(
          supabaseAdmin.from('ledger_entries').insert({
            bounty_id: bountyId,
            transfer_group: v3TransferGroup,
            leg: 'payment',
            app_state: 'requested',
            stripe_state: 'none',
            amount_cents: amountCents,
            currency: 'usd',
            stripe_payment_intent_id: v3PaymentIntent.id,
            user_id: userId,
            metadata: {
              source: 'bounty_payments_v3_create',
              payment_architecture_version: 3,
              request_id: requestId,
            },
          })
        )) as any;
        if (ledgerErr) {
          await rollbackV3('ledger write failed', ledgerErr);
          return reply(
            {
              error: 'Failed to record bounty payment. No charge was made.',
              code: 'payment_record_failed',
              retryable: true,
            },
            500
          );
        }

        const { error: v3VerErr } = (await withDbTimeout(
          supabaseAdmin
            .from('bounties')
            .update({ payment_architecture_version: 3 })
            .eq('id', bountyId)
        )) as any;
        if (v3VerErr) {
          console.error('[bounty-payments] Failed to set payment_architecture_version=3', {
            bountyId,
            requestId,
            v3VerErr,
          });
        }

        return reply({
          bountyPaymentId: bountyId,
          paymentIntentId: v3PaymentIntent.id,
          clientSecret: v3PaymentIntent.client_secret,
          status: 'authorizing',
          amount,
          architectureVersion: 3,
        });
      }

      // Idempotency: if an active (non-canceled/failed) payment row already
      // exists for this bounty, return its existing PaymentIntent's
      // client_secret instead of creating a duplicate PI.
      // Defensive: order+limit so a stray duplicate row (no unique constraint
      // on bounty_id yet — see the recommended follow-up index) resolves to the
      // most recent rather than erroring out of maybeSingle().
      const { data: existing } = (await withDbTimeout(
        supabaseAdmin
          .from('bounty_payments')
          .select('id, stripe_payment_intent_id, status, amount')
          .eq('bounty_id', bountyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )) as any;

      if (
        existing &&
        ACTIVE_BP_STATUSES.includes(existing.status) &&
        existing.stripe_payment_intent_id
      ) {
        try {
          const existingPi = await stripe.paymentIntents.retrieve(
            existing.stripe_payment_intent_id
          );
          return reply({
            bountyPaymentId: existing.id,
            paymentIntentId: existingPi.id,
            clientSecret: existingPi.client_secret,
            status: existing.status,
            amount: Number(existing.amount),
            reused: true,
          });
        } catch (piErr: any) {
          // The stored PI is gone on Stripe's side (e.g. manually deleted in
          // test mode). Fall through and create a fresh one, overwriting the row.
          if (piErr?.code !== 'resource_missing') throw piErr;
        }
      }

      // Resolve/create the poster's Stripe customer.
      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      });
      if (customerResult.error || !customerResult.customerId) {
        return reply(
          {
            error: customerResult.error ?? 'Unable to create customer profile',
            code: 'customer_resolution_failed',
          },
          customerResult.status ?? 400
        );
      }
      const customerId = customerResult.customerId;

      const transferGroup = `bounty_${bountyId}`;

      // capture_method: 'automatic' — the poster's card is charged and funds
      // settle to the platform balance immediately at funding time, then held
      // (tracked via bounty_payments.status) until release. Automatic capture
      // is used because real bounties routinely stay open far longer than the
      // 7-day manual-capture auto-cancel window.
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: customerId,
          capture_method: 'automatic',
          automatic_payment_methods: { enabled: true },
          transfer_group: transferGroup,
          metadata: {
            user_id: userId,
            bounty_id: bountyId,
            purpose: 'bounty_escrow',
            request_id: requestId,
          },
        },
        { idempotencyKey: `bounty_payment_create_${bountyId}_${amountCents}` }
      );

      // Persist the bounty_payments row. Existing terminal rows are updated by
      // id; fresh rows are inserted. The database also enforces one active row
      // per bounty, so insert conflicts are treated as in-flight replays below.
      const rowPatch = {
        bounty_id: bountyId,
        poster_id: userId,
        stripe_payment_intent_id: paymentIntent.id,
        transfer_group: transferGroup,
        amount,
        capture_method: 'automatic',
        status: 'pending_payment',
        stripe_charge_id: null,
        stripe_transfer_id: null,
        stripe_refund_id: null,
        hunter_id: null,
        platform_fee_amount: null,
        updated_at: new Date().toISOString(),
      };

      let bountyPaymentId: string;
      if (existing?.id) {
        const { data: updated, error: updErr } = (await withDbTimeout(
          supabaseAdmin
            .from('bounty_payments')
            .update(rowPatch)
            .eq('id', existing.id)
            .select('id')
            .maybeSingle()
        )) as any;
        if (updErr || !updated) {
          // The PI was created but the row write failed — cancel the PI so we
          // don't leave an orphaned, chargeable intent behind.
          await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
          return reply(
            {
              error: 'Failed to record bounty payment. No charge was made.',
              code: 'payment_record_failed',
              retryable: true,
            },
            500
          );
        }
        bountyPaymentId = updated.id;
      } else {
        const { data: inserted, error: insErr } = (await withDbTimeout(
          supabaseAdmin.from('bounty_payments').insert(rowPatch).select('id').maybeSingle()
        )) as any;
        if (insErr || !inserted) {
          if ((insErr as { code?: string } | null)?.code === '23505') {
            let winner: any = null;
            for (const waitMs of [0, 50, 150]) {
              if (waitMs > 0) await delay(waitMs);

              const { data: byPaymentIntent } = (await withDbTimeout(
                supabaseAdmin
                  .from('bounty_payments')
                  .select('id, stripe_payment_intent_id, status, amount')
                  .eq('stripe_payment_intent_id', paymentIntent.id)
                  .maybeSingle()
              )) as any;

              if (byPaymentIntent?.id) {
                winner = byPaymentIntent;
                break;
              }

              const { data: byBounty } = (await withDbTimeout(
                supabaseAdmin
                  .from('bounty_payments')
                  .select('id, stripe_payment_intent_id, status, amount')
                  .eq('bounty_id', bountyId)
                  .in('status', ACTIVE_BP_STATUSES)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
              )) as any;

              if (byBounty?.id) {
                winner = byBounty;
                break;
              }
            }

            if (winner?.id) {
              return reply({
                bountyPaymentId: winner.id,
                paymentIntentId: winner.stripe_payment_intent_id ?? paymentIntent.id,
                clientSecret: paymentIntent.client_secret,
                status: winner.status,
                amount: Number(winner.amount),
                reused: true,
              });
            }

            return reply(
              {
                error:
                  'Payment recording is already in progress for this bounty. Please retry shortly.',
                code: 'payment_record_conflict_in_flight',
                status: 'pending_payment',
                reused: true,
              },
              409
            );
          }

          await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
          return reply(
            {
              error: 'Failed to record bounty payment. No charge was made.',
              code: 'payment_record_failed',
              retryable: true,
            },
            500
          );
        }
        bountyPaymentId = inserted.id;
      }

      // Mark the bounty as using the Phase 2 payment architecture. Best-effort:
      // the payment row is the source of truth; a failure here just means the
      // version flag lags (the row still drives all Phase 2 logic).
      const { error: verErr } = (await withDbTimeout(
        supabaseAdmin
          .from('bounties')
          .update({ payment_architecture_version: 2 })
          .eq('id', bountyId)
      )) as any;
      if (verErr) {
        console.error('[bounty-payments] Failed to set payment_architecture_version=2', {
          bountyId,
          requestId,
          verErr,
        });
      }

      return reply({
        bountyPaymentId,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: 'pending_payment',
        amount,
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // POST /bounty-payments/release — release funds to the hunter
    // ───────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/release') {
      const body = await req.json().catch(() => ({}));
      const bountyId = sanitizeText(body?.bountyId ?? body?.bounty_id);
      const hunterIdInput = sanitizeText(body?.hunterId ?? body?.hunter_id);
      if (!bountyId) {
        return reply({ error: 'bountyId is required.', code: 'bounty_id_required' }, 400);
      }

      // ───────────────────────────────────────────────────────────────────
      // v3 release — capture the authorization, then Transfer to the hunter.
      //
      // Must run before the bounty_payments lookup below: a v3 bounty has no
      // bounty_payments row (that table is retired for v3), so the v2 path
      // would return 404 for every v3 release.
      // ───────────────────────────────────────────────────────────────────
      const { data: v3Funding } = (await withDbTimeout(
        supabaseAdmin.from('bounty_v3_funding').select('*').eq('bounty_id', bountyId).maybeSingle()
      )) as any;

      if (v3Funding) {
        const notifyV3 = async (
          recipientId: string,
          type: string,
          title: string,
          bodyText: string
        ) => {
          try {
            await supabaseAdmin.from('notifications').insert({
              user_id: recipientId,
              type,
              title,
              body: bodyText,
              category: 'payments',
              data: { bountyId, type },
            });
            await supabaseAdmin.from('notifications_outbox').insert({
              recipients: [recipientId],
              title,
              body: bodyText,
              data: { bountyId, type, skipInApp: true },
              status: 'pending',
            });
          } catch (notifyErr) {
            console.error('[bounty-payments] v3 notify failed (non-fatal)', {
              bountyId,
              requestId,
              type,
              notifyErr,
            });
          }
        };

        // Idempotency. Only transfer.created (reversed=false) makes a v3
        // bounty released; 'capturing' is a request awaiting confirmation.
        if (v3Funding.state === 'released' && v3Funding.stripe_transfer_id) {
          return reply({
            released: true,
            transferId: v3Funding.stripe_transfer_id,
            status: 'released',
            architectureVersion: 3,
            reused: true,
          });
        }
        if (v3Funding.state === 'capturing' && v3Funding.stripe_transfer_id) {
          return reply({
            released: false,
            transferId: v3Funding.stripe_transfer_id,
            status: 'release_pending',
            architectureVersion: 3,
            reused: true,
          });
        }

        const { data: v3Bounty } = (await withDbTimeout(
          supabaseAdmin
            .from('bounties')
            .select('id, user_id, poster_id, accepted_by, amount')
            .eq('id', bountyId)
            .maybeSingle()
        )) as any;
        if (!v3Bounty) {
          return reply({ error: 'Bounty not found.', code: 'bounty_not_found' }, 404);
        }
        const v3PosterId = v3Bounty.user_id ?? v3Bounty.poster_id;
        if (v3PosterId !== userId) {
          return reply({ error: 'Only the poster can release funds.', code: 'not_poster' }, 403);
        }

        if (
          !['authorized', 'awaiting_hunter_onboarding', 'capture_failed'].includes(v3Funding.state)
        ) {
          return reply(
            {
              error: `Cannot release a bounty in funding state "${v3Funding.state}".`,
              code: 'invalid_funding_state',
            },
            409
          );
        }

        // Scope: capture only once the work has actually been approved.
        const { data: v3Submission } = (await withDbTimeout(
          supabaseAdmin
            .from('completion_submissions')
            .select('id, status')
            .eq('bounty_id', bountyId)
            .eq('status', 'approved')
            .limit(1)
            .maybeSingle()
        )) as any;
        if (!v3Submission) {
          return reply(
            { error: 'This bounty has no approved completion yet.', code: 'not_approved' },
            409
          );
        }

        const v3HunterId = v3Bounty.accepted_by;
        if (!v3HunterId) {
          return reply({ error: 'This bounty has no assigned hunter.', code: 'no_hunter' }, 409);
        }

        const { data: v3Hunter } = (await withDbTimeout(
          supabaseAdmin
            .from('profiles')
            .select('id, stripe_connect_account_id')
            .eq('id', v3HunterId)
            .maybeSingle()
        )) as any;

        // Hold, never capture, when the hunter cannot receive a payout.
        const holdForOnboarding = async (reasonCode: string, reasonMessage: string) => {
          await withDbTimeout(
            supabaseAdmin
              .from('bounty_v3_funding')
              .update({
                state: 'awaiting_hunter_onboarding',
                hunter_id: v3HunterId,
                last_error_code: reasonCode,
                last_error_message: reasonMessage,
                updated_at: new Date().toISOString(),
              })
              .eq('bounty_id', bountyId)
          );
          await notifyV3(
            v3HunterId,
            'payout_setup_required',
            'Finish your payout setup to get paid',
            'Your work was approved. Finish your payout setup and the payment will be released to you — nothing is lost.'
          );
          await notifyV3(
            v3PosterId,
            'release_waiting_on_hunter',
            'Payment is waiting on the hunter',
            'You approved the work. The payment releases once the hunter finishes their payout setup. Your card has not been charged yet.'
          );
        };

        if (!v3Hunter?.stripe_connect_account_id) {
          await holdForOnboarding(
            'hunter_not_onboarded',
            'The hunter has not started Stripe Connect onboarding.'
          );
          return reply(
            {
              released: false,
              status: 'awaiting_hunter_onboarding',
              architectureVersion: 3,
              error: 'The hunter has not set up payouts yet. They have been notified.',
              code: 'hunter_not_onboarded',
            },
            409
          );
        }

        // The exact gate /connect/transfer uses before moving money: a LIVE
        // Stripe read, not profiles.stripe_connect_payouts_enabled. The cached
        // columns are demonstrably stale — Stripe reports 5 of 9 accounts
        // payouts-enabled where the profile columns report 2.
        let v3Account: any;
        try {
          v3Account = await stripe.accounts.retrieve(v3Hunter.stripe_connect_account_id);
        } catch (acctErr) {
          console.error('[bounty-payments] v3 could not retrieve connected account', {
            bountyId,
            requestId,
            acctErr,
          });
          return reply(
            {
              error:
                'We could not reach Stripe to check the hunter payout status. No funds have moved — please try again.',
              code: 'stripe_unavailable',
            },
            503
          );
        }
        if (!v3Account?.payouts_enabled) {
          await holdForOnboarding(
            'payouts_disabled',
            `Payouts are not enabled on the hunter account (${
              v3Account?.requirements?.disabled_reason ?? 'unknown reason'
            }).`
          );
          return reply(
            {
              released: false,
              status: 'awaiting_hunter_onboarding',
              architectureVersion: 3,
              error: 'The hunter cannot receive payouts yet. They have been notified.',
              code: 'payouts_disabled',
            },
            409
          );
        }

        const v3AmountCents = Number(v3Funding.amount_cents);
        // Integer cents throughout — v3 removes the float rounding surface
        // that v2's dollar arithmetic carries.
        const v3FeeCents = Math.round((v3AmountCents * PLATFORM_FEE_PERCENT) / 100);
        const v3HunterCents = v3AmountCents - v3FeeCents;
        if (v3HunterCents <= 0) {
          return reply(
            { error: 'Computed hunter payout is not positive.', code: 'invalid_payout' },
            400
          );
        }

        const failCapture = async (code: string, message: string, httpStatus: number) => {
          await withDbTimeout(
            supabaseAdmin
              .from('bounty_v3_funding')
              .update({
                state: 'capture_failed',
                hunter_id: v3HunterId,
                last_error_code: code,
                last_error_message: message,
                needs_reauthorization: code === 'capture_failed_expired',
                updated_at: new Date().toISOString(),
              })
              .eq('bounty_id', bountyId)
          );
          await supabaseAdmin
            .from('ledger_entries')
            .update({
              app_state: 'failed',
              stripe_state: 'failed',
              updated_at: new Date().toISOString(),
            })
            .eq('bounty_id', bountyId)
            .eq('leg', 'capture_release');
          // The poster gets a retry path; the hunter is told it is delayed,
          // not lost. Neither party is left with a silently stuck bounty.
          await notifyV3(
            v3PosterId,
            'release_failed',
            'Payment could not be completed',
            'We could not charge your card to pay this bounty. Open the bounty to try again — the hunter has been told the payment is delayed, not cancelled.'
          );
          await notifyV3(
            v3HunterId,
            'release_delayed',
            'Your payment is delayed',
            'There was a problem taking payment from the poster. Your payment is delayed, not lost — we have asked them to retry.'
          );
          return reply(
            { error: message, code, architectureVersion: 3, retryable: true },
            httpStatus
          );
        };

        // 1. Capture the full authorized amount.
        let v3Captured: any;
        try {
          v3Captured = await stripe.paymentIntents.capture(
            v3Funding.stripe_payment_intent_id,
            {},
            { idempotencyKey: `v3_capture_${bountyId}` }
          );
        } catch (capErr: any) {
          const expired =
            capErr?.code === 'payment_intent_unexpected_state' ||
            capErr?.raw?.code === 'payment_intent_unexpected_state';
          return await failCapture(
            expired ? 'capture_failed_expired' : 'capture_failed',
            expired
              ? 'The card authorization for this bounty expired and could not be charged.'
              : (capErr?.message ?? 'The payment could not be captured.'),
            409
          );
        }

        const v3ChargeId =
          typeof v3Captured?.latest_charge === 'string'
            ? v3Captured.latest_charge
            : (v3Captured?.latest_charge?.id ?? null);
        if (v3Captured?.status !== 'succeeded' || !v3ChargeId) {
          return await failCapture(
            'capture_not_settled',
            'The payment was not captured successfully.',
            409
          );
        }

        await withDbTimeout(
          supabaseAdmin
            .from('bounty_v3_funding')
            .update({
              stripe_charge_id: v3ChargeId,
              captured_at: new Date().toISOString(),
              hunter_id: v3HunterId,
              platform_fee_cents: v3FeeCents,
              hunter_amount_cents: v3HunterCents,
              updated_at: new Date().toISOString(),
            })
            .eq('bounty_id', bountyId)
        );

        // 2. Transfer the after-fee amount, drawn from this exact charge and
        //    carrying the bounty's transfer_group.
        let v3Transfer: any;
        try {
          v3Transfer = await stripe.transfers.create(
            {
              amount: v3HunterCents,
              currency: 'usd',
              destination: v3Hunter.stripe_connect_account_id,
              source_transaction: v3ChargeId,
              transfer_group: v3Funding.transfer_group ?? `bounty_${bountyId}`,
              metadata: {
                bounty_id: bountyId,
                hunter_id: v3HunterId,
                purpose: 'bounty_release_v3',
                payment_architecture_version: '3',
                request_id: requestId,
              },
            },
            { idempotencyKey: `v3_release_${bountyId}` }
          );
        } catch (trErr: any) {
          // Captured but not transferred: the money is sitting on the platform
          // balance, so this must be loud rather than silent.
          console.error('[bounty-payments] v3 transfer failed AFTER capture', {
            bountyId,
            requestId,
            chargeId: v3ChargeId,
            trErr,
          });
          return await failCapture(
            'transfer_failed_after_capture',
            trErr?.message ?? 'The payment was captured but could not be sent to the hunter.',
            502
          );
        }

        // 3. Ledger. app_state='succeeded' because Stripe accepted both
        //    requests. stripe_state stays 'pending' — only transfer.created
        //    with reversed=false promotes it to 'confirmed'. A 200 from the
        //    API is never proof; this is the rule v1 withdrawals enforce.
        const { error: v3RelLedgerErr } = (await withDbTimeout(
          supabaseAdmin.from('ledger_entries').insert({
            bounty_id: bountyId,
            transfer_group: v3Funding.transfer_group ?? `bounty_${bountyId}`,
            leg: 'capture_release',
            app_state: 'succeeded',
            stripe_state: 'pending',
            amount_cents: v3HunterCents,
            currency: 'usd',
            stripe_payment_intent_id: v3Funding.stripe_payment_intent_id,
            stripe_charge_id: v3ChargeId,
            stripe_transfer_id: v3Transfer.id,
            user_id: v3HunterId,
            metadata: {
              source: 'bounty_payments_v3_release',
              payment_architecture_version: 3,
              request_id: requestId,
              platform_fee_cents: v3FeeCents,
              gross_amount_cents: v3AmountCents,
            },
          })
        )) as any;
        if (v3RelLedgerErr) {
          console.error('[bounty-payments] v3 release ledger insert failed', {
            bountyId,
            requestId,
            transferId: v3Transfer.id,
            v3RelLedgerErr,
          });
        }

        await withDbTimeout(
          supabaseAdmin
            .from('bounty_v3_funding')
            .update({
              state: 'capturing',
              stripe_transfer_id: v3Transfer.id,
              last_error_code: null,
              last_error_message: null,
              updated_at: new Date().toISOString(),
            })
            .eq('bounty_id', bountyId)
        );

        return reply({
          released: false,
          transferId: v3Transfer.id,
          hunterId: v3HunterId,
          amount: v3AmountCents / 100,
          platformFee: v3FeeCents / 100,
          hunterAmount: v3HunterCents / 100,
          status: 'release_pending',
          architectureVersion: 3,
        });
      }

      const { data: bp, error: bpErr } = (await withDbTimeout(
        supabaseAdmin.from('bounty_payments').select('*').eq('bounty_id', bountyId).maybeSingle()
      )) as any;
      if (bpErr) {
        return reply(
          { error: 'Failed to load bounty payment.', code: 'payment_load_failed', retryable: true },
          500
        );
      }
      if (!bp) {
        return reply({ error: 'No payment record for this bounty.', code: 'no_payment' }, 404);
      }
      if (bp.poster_id !== userId) {
        return reply({ error: 'Only the poster can release funds.', code: 'not_poster' }, 403);
      }

      // Idempotent: only the Stripe transfer.created webhook makes a Phase 2
      // payment released. A transfer request is intentionally represented
      // separately until webhook reconciliation confirms it.
      if (bp.status === 'released' && bp.stripe_transfer_id) {
        return reply({
          released: true,
          transferId: bp.stripe_transfer_id,
          status: 'released',
          reused: true,
        });
      }

      if (bp.status === 'release_pending' && bp.stripe_transfer_id) {
        return reply(
          {
            error: 'Transfer requested. Waiting for Stripe confirmation.',
            released: false,
            transferId: bp.stripe_transfer_id,
            status: 'release_pending',
            reused: true,
            message: 'Transfer requested. Waiting for Stripe confirmation.',
          },
          409
        );
      }

      // Only a captured payment, or a transfer Stripe has terminally failed,
      // can start a release attempt. A `failed` retry intentionally uses a
      // new deterministic key below; retrying with the old key would replay
      // Stripe's prior failed response forever. Other terminal states remain
      // non-releasable.
      if (!['authorized', 'captured', 'failed'].includes(bp.status)) {
        return reply(
          {
            error: `Cannot release a bounty payment in status "${bp.status}".`,
            code: 'invalid_status',
            status: bp.status,
          },
          409
        );
      }

      // Resolve the hunter. Prefer the explicit input, else the accepted hunter
      // recorded on the bounty.
      let hunterId = hunterIdInput || bp.hunter_id || null;
      if (!hunterId) {
        const { data: bountyRow } = (await withDbTimeout(
          supabaseAdmin.from('bounties').select('accepted_by').eq('id', bountyId).maybeSingle()
        )) as any;
        hunterId = bountyRow?.accepted_by ?? null;
      }
      if (!hunterId) {
        return reply({ error: 'No hunter is assigned to this bounty.', code: 'no_hunter' }, 400);
      }

      // Verify the hunter is payout-ready on Stripe Connect.
      const { data: hunterProfile, error: hunterErr } = (await withDbTimeout(
        supabaseAdmin
          .from('profiles')
          .select('stripe_connect_account_id, stripe_connect_payouts_enabled')
          .eq('id', hunterId)
          .maybeSingle()
      )) as any;
      if (hunterErr) {
        return reply(
          {
            error: 'Failed to load hunter payout profile.',
            code: 'hunter_profile_load_failed',
            retryable: true,
          },
          500
        );
      }
      if (!hunterProfile?.stripe_connect_account_id) {
        return reply(
          {
            error: 'The hunter has not completed payout onboarding yet.',
            code: 'hunter_not_onboarded',
          },
          400
        );
      }
      if (hunterProfile.stripe_connect_payouts_enabled !== true) {
        return reply(
          { error: 'The hunter cannot receive payouts yet.', code: 'hunter_payouts_disabled' },
          400
        );
      }

      // The charge id should already be set by the payment_intent.succeeded
      // webhook. If it's missing (webhook lag), resolve it live from the PI.
      let chargeId: string | null = bp.stripe_charge_id ?? null;
      if (!chargeId && bp.stripe_payment_intent_id) {
        try {
          const pi = await stripe.paymentIntents.retrieve(bp.stripe_payment_intent_id);
          chargeId = (pi.latest_charge as string) ?? null;
          if (pi.status !== 'succeeded') {
            return reply(
              {
                error: 'The bounty payment has not been captured yet. Try again shortly.',
                code: 'not_captured',
              },
              409
            );
          }
        } catch (_piErr) {
          /* fall through to the missing-charge guard below */
        }
      }
      if (!chargeId) {
        return reply(
          {
            error: 'Could not resolve the settled charge for this bounty. Try again shortly.',
            code: 'no_charge',
          },
          409
        );
      }

      const amount = Number(bp.amount);
      const platformFee = Math.round(((amount * PLATFORM_FEE_PERCENT) / 100) * 100) / 100;
      const hunterAmount = Math.round((amount - platformFee) * 100) / 100;
      const hunterAmountCents = Math.round(hunterAmount * 100);
      if (hunterAmountCents <= 0) {
        return reply(
          { error: 'Computed hunter payout is not positive.', code: 'invalid_payout' },
          400
        );
      }

      // Create the Transfer, drawing from the specific settled charge
      // (source_transaction) so Connect balance accounting is exact. Stripe
      // idempotency key makes duplicate requests for one attempt a no-op.
      // Once Stripe has confirmed a terminal failure, the prior transfer id
      // becomes the deterministic retry suffix for exactly one new attempt.
      const transferIdempotencyKey =
        bp.status === 'failed' && bp.stripe_transfer_id
          ? `bounty_release_retry_${bp.id}_${bp.stripe_transfer_id}`
          : `bounty_release_${bp.id}`;
      let transfer: any;
      try {
        transfer = await stripe.transfers.create(
          {
            amount: hunterAmountCents,
            currency: 'usd',
            destination: hunterProfile.stripe_connect_account_id,
            source_transaction: chargeId,
            transfer_group: bp.transfer_group ?? `bounty_${bountyId}`,
            metadata: {
              bounty_id: bountyId,
              hunter_id: hunterId,
              poster_id: bp.poster_id,
              request_id: requestId,
            },
          },
          { idempotencyKey: transferIdempotencyKey }
        );
      } catch (transferErr: any) {
        // The charge was captured successfully; only the transfer failed. Leave
        // status at 'captured' so a retry goes straight back to this step. No
        // funds are lost — they remain on the platform balance.
        console.error('[bounty-payments] Transfer failed after capture', {
          bountyId,
          requestId,
          bpId: bp.id,
          transferErr,
        });
        return reply(
          {
            error:
              'Payment is held safely but the transfer to the hunter failed. No funds were lost — please retry.',
            code: 'transfer_failed',
            retryable: true,
          },
          502
        );
      }

      const { error: updErr } = (await withDbTimeout(
        supabaseAdmin
          .from('bounty_payments')
          .update({
            hunter_id: hunterId,
            stripe_transfer_id: transfer.id,
            platform_fee_amount: platformFee,
            status: 'release_pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bp.id)
          // Do not overwrite a webhook that reconciled transfer.created while
          // this request was awaiting its database write.
          .in('status', ['authorized', 'captured', 'failed'])
      )) as any;
      if (updErr) {
        // Transfer succeeded but the row write failed. The Stripe idempotency
        // key on the transfer means a retry won't double-pay; surface for
        // reconciliation rather than silently succeeding.
        console.error('[bounty-payments] CRITICAL: transfer created but row update failed', {
          bountyId,
          requestId,
          bpId: bp.id,
          transferId: transfer.id,
          updErr,
        });
        return reply(
          {
            error:
              'Stripe accepted the transfer but its record could not be updated. Retrying is safe and reconciliation will repair it.',
            code: 'record_update_failed',
            transferId: transfer.id,
            retryable: true,
          },
          500
        );
      }

      return reply({
        released: false,
        transferId: transfer.id,
        hunterId,
        amount,
        platformFee,
        hunterAmount,
        status: 'release_pending',
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // POST /bounty-payments/cancel — cancel (pre-capture) or refund (post-capture)
    // ───────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/cancel') {
      const body = await req.json().catch(() => ({}));
      const bountyId = sanitizeText(body?.bountyId ?? body?.bounty_id);
      if (!bountyId) {
        return reply({ error: 'bountyId is required.', code: 'bounty_id_required' }, 400);
      }

      const { data: bp, error: bpErr } = (await withDbTimeout(
        supabaseAdmin.from('bounty_payments').select('*').eq('bounty_id', bountyId).maybeSingle()
      )) as any;
      if (bpErr) {
        return reply(
          { error: 'Failed to load bounty payment.', code: 'payment_load_failed', retryable: true },
          500
        );
      }
      if (!bp) {
        return reply({ error: 'No payment record for this bounty.', code: 'no_payment' }, 404);
      }
      if (bp.poster_id !== userId) {
        return reply(
          { error: 'Only the poster can cancel this bounty payment.', code: 'not_poster' },
          403
        );
      }

      // Idempotent terminal states.
      if (bp.status === 'canceled') {
        return reply({ canceled: true, status: 'canceled', reused: true });
      }
      if (bp.status === 'refunded' || bp.status === 'refund_pending') {
        return reply({
          refunded: true,
          status: bp.status,
          refundId: bp.stripe_refund_id ?? null,
          reused: true,
        });
      }
      if (bp.status === 'released') {
        return reply(
          {
            error: 'Funds have already been released to the hunter and cannot be canceled here.',
            code: 'already_released',
          },
          409
        );
      }

      // Pre-capture: cancel the PaymentIntent (no charge ever settles).
      if (bp.status === 'pending_payment' || bp.status === 'authorized') {
        if (bp.stripe_payment_intent_id) {
          try {
            await stripe.paymentIntents.cancel(bp.stripe_payment_intent_id);
          } catch (cancelErr: any) {
            // If it already captured between our read and now, fall through to
            // the refund path below by re-reading status.
            if (cancelErr?.code !== 'payment_intent_unexpected_state') {
              throw cancelErr;
            }
          }
        }
        const { error: updErr } = (await withDbTimeout(
          supabaseAdmin
            .from('bounty_payments')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('id', bp.id)
        )) as any;
        if (updErr) {
          return reply(
            {
              error: 'Payment intent canceled but the record could not be updated.',
              code: 'record_update_failed',
              retryable: true,
            },
            500
          );
        }
        return reply({ canceled: true, status: 'canceled' });
      }

      // Post-capture: issue a real refund.
      if (bp.status === 'captured') {
        if (!bp.stripe_payment_intent_id) {
          return reply(
            { error: 'Missing payment intent; cannot refund.', code: 'no_payment_intent' },
            500
          );
        }
        let refund: any;
        try {
          refund = await stripe.refunds.create(
            {
              payment_intent: bp.stripe_payment_intent_id,
              reason: 'requested_by_customer',
              metadata: { bounty_id: bountyId, request_id: requestId },
            },
            { idempotencyKey: `bounty_refund_${bp.id}` }
          );
        } catch (refundErr: any) {
          console.error('[bounty-payments] Refund failed', {
            bountyId,
            requestId,
            bpId: bp.id,
            refundErr,
          });
          return reply(
            {
              error: 'Refund could not be processed. Please try again.',
              code: 'refund_failed',
              retryable: true,
            },
            502
          );
        }

        const newStatus = refund.status === 'succeeded' ? 'refunded' : 'refund_pending';
        const { error: updErr } = (await withDbTimeout(
          supabaseAdmin
            .from('bounty_payments')
            .update({
              status: newStatus,
              stripe_refund_id: refund.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', bp.id)
        )) as any;
        if (updErr) {
          console.error('[bounty-payments] Refund created but row update failed', {
            bountyId,
            requestId,
            bpId: bp.id,
            refundId: refund.id,
            updErr,
          });
          return reply({
            refunded: true,
            status: newStatus,
            refundId: refund.id,
            warning: 'record_update_failed',
          });
        }
        return reply({ refunded: true, status: newStatus, refundId: refund.id });
      }

      return reply(
        {
          error: `Cannot cancel a bounty payment in status "${bp.status}".`,
          code: 'invalid_status',
          status: bp.status,
        },
        409
      );
    }

    return reply({ error: 'Not found', code: 'not_found' }, 404);
  } catch (err: any) {
    if (err?.code === 'DB_TIMEOUT') {
      return reply(
        {
          error: 'Service temporarily unavailable. Please try again shortly.',
          code: 'db_timeout',
          retryable: true,
        },
        503
      );
    }
    console.error('[bounty-payments] Unhandled error', {
      requestId,
      subPath,
      message: err?.message,
      type: err?.type,
      code: err?.code,
    });
    return reply(
      {
        error: 'Payment service temporarily unavailable. Please try again.',
        code: err?.code ?? 'bounty_payment_service_error',
        retryable: true,
      },
      500
    );
  }
});
