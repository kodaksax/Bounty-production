// Supabase Edge Function: wallet
// Handles wallet routes previously served by the Node/Express server.
// Routes:
//   GET  /wallet/balance
//   GET  /wallet/transactions
//   POST /wallet/deposit   (client-initiated deposit after Stripe payment confirmation)
//   POST /wallet/escrow    (hold funds when a bounty is posted)
//   POST /wallet/refund    (return escrowed funds to poster on cancellation)
//   POST /wallet/release   (release escrowed funds to hunter on completion)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import {
    isPaymentIntentId,
    verifyDepositPaymentIntent,
    type DepositPaymentIntent,
} from '../_shared/deposit-verification.ts';
import {
    resolveReleasePayee,
    type ReleaseBountyLookupClient,
} from '../_shared/release-authorization.ts';
import {
    deriveSettlementState,
    describeSettlement,
    type SettlementState,
} from '../_shared/settlement-state.ts';
import type { ApplyDepositResult, Profile, WalletTransaction } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function generateRequestId(prefix = 'wallet'): string {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function jsonResponse(data: unknown, status = 200, requestId = generateRequestId()) {
  const body =
    data && typeof data === 'object' && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>), requestId }
      : data;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Request-Id': requestId },
  });
}

// Structured logging for rejected deposit attempts. Mirrors the logCritical
// convention in supabase/functions/webhooks/index.ts (duplicated rather than
// imported because the deploy bundler doesn't follow local imports).
// Never log tokens, Stripe secrets or client secrets — only ids and amounts.
function logDepositRejected(event: string, context: Record<string, unknown>) {
  console.warn(
    `[wallet/deposit] ${event}`,
    JSON.stringify({ event, ts: new Date().toISOString(), ...context })
  );
}

function isApplyDepositResult(obj: unknown): obj is ApplyDepositResult {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.applied === 'boolean';
}

function errorPayload(error: string, code: string, retryable = false) {
  return { error, code, retryable };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Single outer try/catch ensures ALL errors—including those thrown by the
  // authentication step—are caught and returned as a JSON response instead of
  // propagating to Deno's default handler (which returns text/plain; 500).
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return jsonResponse(errorPayload('Method not allowed', 'method_not_allowed'), 405);
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/wallet');
    const subPath = pathParts.length > 1 ? pathParts[1] : '/';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.warn('[wallet edge fn] missing Authorization header');
      return jsonResponse(
        errorPayload(
          'Authentication required. Please sign in to continue.',
          'authentication_required'
        ),
        401
      );
    }
    const token = authHeader.substring(7);

    let userId: string;
    try {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (authError || !data?.user) {
        console.warn('[wallet edge fn] invalid or expired token', authError || 'no user');
        return jsonResponse(
          errorPayload(
            'Authentication required. Please sign in to continue.',
            'authentication_required'
          ),
          401
        );
      }
      userId = data.user.id;
    } catch (authException: unknown) {
      const msg = authException instanceof Error ? authException.message : String(authException);
      console.error('[wallet edge fn] getUser threw unexpectedly:', msg);
      return jsonResponse(
        errorPayload(
          'Authentication service unavailable. Please try again.',
          'authentication_unavailable',
          true
        ),
        503
      );
    }

    try {
      // POST /wallet/deposit — client-initiated deposit after Stripe payment confirmation.
      // Called immediately after processPaymentSecure() succeeds on the client so that
      // profiles.balance is updated durably without relying solely on the webhook.
      // Uses the apply_deposit RPC which is idempotent on stripe_payment_intent_id,
      // so a concurrent webhook delivery results in a safe no-op.
      //
      // SECURITY: the client is *not* authoritative for anything here. It may
      // only nominate a PaymentIntent id; the amount, the payment status, the
      // currency and the ownership of the payment are all read back from
      // Stripe. This endpoint previously trusted `body.amount` outright, which
      // let any authenticated caller mint arbitrary balance by POSTing a large
      // amount with a made-up id. The `amount` field is still accepted (older
      // shipped builds send it) but is used only to detect and log a mismatch.
      if (req.method === 'POST' && subPath === '/deposit') {
        let body: { amount?: unknown; paymentIntentId?: unknown };
        try {
          body = await req.json();
        } catch {
          return jsonResponse(
            { error: 'Invalid JSON body', code: 'invalid_json', retryable: false },
            400
          );
        }

        const requestedAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
        const paymentIntentId =
          typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';

        if (!paymentIntentId) {
          return jsonResponse(
            {
              error: 'paymentIntentId is required',
              code: 'payment_intent_required',
              retryable: false,
            },
            400
          );
        }
        if (!isPaymentIntentId(paymentIntentId)) {
          logDepositRejected('deposit_verification_failed', {
            reason: 'malformed_payment_intent_id',
            userId,
            paymentIntentId,
          });
          return jsonResponse(
            {
              error: 'Invalid paymentIntentId',
              code: 'invalid_payment_intent_id',
              retryable: false,
            },
            400
          );
        }

        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!stripeKey) {
          console.error('[wallet] STRIPE_SECRET_KEY is not configured');
          return jsonResponse(
            {
              error: 'Payment verification unavailable',
              code: 'payment_verification_unavailable',
              retryable: true,
            },
            503
          );
        }
        const stripe = new Stripe(stripeKey, {
          apiVersion: '2023-10-16',
          httpClient: Stripe.createFetchHttpClient(),
        });

        // A. The PaymentIntent must actually exist in Stripe. A retrieve
        //    failure is never treated as "close enough" — no credit.
        let paymentIntent: Stripe.PaymentIntent;
        try {
          paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        } catch (stripeErr: unknown) {
          const code = (stripeErr as { code?: string })?.code;
          const status = (stripeErr as { statusCode?: number })?.statusCode;
          logDepositRejected('deposit_verification_failed', {
            reason: 'payment_intent_not_retrievable',
            userId,
            paymentIntentId,
            stripeCode: code ?? null,
          });
          // 404-equivalents are the client's problem; anything else (network,
          // Stripe outage) is transient and must be retryable.
          const isMissing = code === 'resource_missing' || status === 404;
          return jsonResponse(
            {
              error: isMissing ? 'Payment not found' : 'Unable to verify payment',
              code: isMissing ? 'payment_intent_not_found' : 'payment_verification_failed',
              retryable: !isMissing,
            },
            isMissing ? 404 : 502
          );
        }

        // B–E. Status, ownership, purpose, currency and amount are all
        //       decided from the Stripe object by a pure, unit-tested rule set.
        const verdict = verifyDepositPaymentIntent({
          callerId: userId,
          intent: paymentIntent as unknown as DepositPaymentIntent,
          requestedAmount,
        });

        if (!verdict.ok) {
          logDepositRejected(verdict.event, {
            reason: verdict.reason,
            userId,
            paymentIntentId,
            status: paymentIntent.status,
          });
          return jsonResponse(
            { error: verdict.error, code: verdict.reason, retryable: false },
            verdict.status
          );
        }

        const amount = verdict.amount;

        if (verdict.amountMismatch) {
          // Not fatal — Stripe wins either way — but a gap is the exact
          // signature of an amount-manipulation attempt, so make it visible.
          logDepositRejected('deposit_amount_mismatch', {
            userId,
            paymentIntentId,
            requestedAmount: verdict.amountMismatch.requested,
            verifiedAmount: verdict.amountMismatch.verified,
          });
        }

        // Call the atomic apply_deposit function which:
        //   1. Inserts the wallet_transaction (ON CONFLICT DO NOTHING for idempotency)
        //   2. Updates profiles.balance atomically
        // Returns { applied: boolean, tx_id: UUID }
        const { data: applyRes, error: applyErr } = await supabase.rpc('apply_deposit', {
          p_user_id: userId,
          p_amount: amount,
          p_payment_intent_id: paymentIntentId,
          p_metadata: {
            ...(paymentIntent.metadata ?? {}),
            payment_intent_id: paymentIntentId,
            created_via: 'client_post_payment',
            verified_via: 'stripe_payment_intent_retrieve',
          },
        });

        if (applyErr) {
          console.error('[wallet] apply_deposit error:', applyErr);
          return jsonResponse(
            { error: 'Failed to record deposit', code: 'deposit_record_failed', retryable: true },
            500
          );
        }

        // Normalize possible shapes: RPC may return an object or an array with a single row.
        let applied = false;
        let tx_id: string | null = null;
        const candidate = Array.isArray(applyRes)
          ? (applyRes[0] as unknown)
          : (applyRes as unknown);
        if (isApplyDepositResult(candidate)) {
          applied = candidate.applied;
          tx_id = (candidate as any).tx_id ?? null;
        } else if (candidate && typeof (candidate as any).applied === 'boolean') {
          applied = Boolean((candidate as any).applied);
          tx_id = (candidate as any).tx_id ?? null;
        } else {
          console.warn('[wallet] apply_deposit returned unexpected shape', applyRes);
        }

        if (!applied) {
          // Not an error: the webhook (or an earlier retry of this same call)
          // already credited this PaymentIntent. Recorded so a burst of
          // duplicates is distinguishable from a genuine double-credit.
          logDepositRejected('deposit_duplicate', { userId, paymentIntentId });
        }

        // Fetch updated balance to return to client
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', userId)
          .single();

        if (profileError) {
          console.error('[wallet] failed to fetch updated balance after deposit:', profileError);
          return jsonResponse(
            {
              success: applied,
              tx_id,
              balance: null,
              warning: 'Deposit recorded, but failed to fetch updated balance',
              code: 'deposit_recorded_balance_refresh_failed',
              retryable: true,
            },
            500
          );
        }

        const newBalance = (profileData as Profile | null)?.balance ?? (applied ? amount : 0);

        return jsonResponse({ success: applied, tx_id, balance: newBalance });
      }

      // GET /wallet/balance
      if (subPath === '/balance') {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('balance, payout_failed_at, payout_failure_code, stripe_connect_account_id')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          console.error('[wallet] Error fetching balance:', error);
          return jsonResponse(
            errorPayload('Failed to fetch balance', 'balance_fetch_failed', true),
            500
          );
        }

        // profiles.balance is the sole source of truth for the current balance.
        // Every operation that touches it (apply_deposit, apply_escrow,
        // apply_refund_tx, apply_release_tx, withdraw_balance) is a single
        // atomic SECURITY DEFINER RPC that updates profiles.balance in the same
        // transaction as its wallet_transactions row (or, for withdrawals,
        // debits balance strictly before the row is inserted) — so balance can
        // never legitimately lag behind SUM(completed wallet_transactions).
        //
        // This function previously "reconciled" a $0 cached balance by trusting
        // a derived ledger sum instead and writing it back to profiles.balance.
        // That was unsafe in two ways this codebase has actually hit in
        // production: (1) a user with a genuinely in-flight debit (e.g. a
        // withdrawal whose wallet_transactions row hadn't reached 'completed'
        // yet) would have their correct $0 "resurrected" to a phantom balance
        // they could then double-spend; (2) a deliberate administrative
        // balance write-off (e.g. the Phase 2 legacy-balance migration, which
        // zeroes profiles.balance without an offsetting 'completed' ledger row
        // by design) would get silently undone the next time the user opened
        // their wallet. Removed 2026-07-18. Real balance/ledger drift should
        // never happen under the atomic-RPC design above; if it ever does,
        // investigate and fix the root cause via scripts/reconcile_and_triage.sql
        // (a manual, human-reviewed process) rather than auto-correcting here.
        const balance = (profile as Profile | null)?.balance ?? 0;

        const typedProfile = profile as
          | (Profile & {
              payout_failed_at?: string | null;
              payout_failure_code?: string | null;
            })
          | null;

        // ─────────────────────────────────────────────────────────────────
        // v3: spendable balance is the hunter's own Stripe Connect balance,
        // not a second internally-maintained figure. Applies ONLY to hunters
        // with no live v1 position; every v1 hunter falls through to the
        // profiles.balance read above, byte-for-byte as before.
        //
        // v1 keeps writing profiles.balance throughout this phase — nothing
        // here changes what any v1 code path does.
        // ─────────────────────────────────────────────────────────────────
        const connectAccountId =
          (profile as { stripe_connect_account_id?: string | null } | null)
            ?.stripe_connect_account_id ?? null;

        type StripeBalanceBlock = {
          availableCents: number;
          pendingCents: number;
          currency: string;
          fetchedAt: string;
          cached: boolean;
        };
        let stripeBalance: StripeBalanceBlock | null = null;
        let balanceSource: 'v1_ledger' | 'stripe_connect' | 'both' = 'v1_ledger';

        if (connectAccountId) {
          // "v3-only" = no live v1 position. Either no v1 ledger history at
          // all, or history that is fully settled and zeroed. An unsettled
          // row (a pending withdrawal, say) means the hunter still has a real
          // v1 position and must keep seeing the v1 number.
          const { count: unsettledCount, error: unsettledErr } = await supabase
            .from('wallet_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'pending');

          const { count: anyHistoryCount, error: historyErr } = await supabase
            .from('wallet_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

          // Fail closed: if we cannot establish the v1 position, keep showing
          // the v1 number rather than risk presenting a Stripe figure to
          // someone who still holds custodial funds.
          const v1PositionKnown = !unsettledErr && !historyErr;
          const hasLiveV1Position =
            !v1PositionKnown || (unsettledCount ?? 0) > 0 || Number(balance) > 0;
          const isV3Only =
            v1PositionKnown &&
            !hasLiveV1Position &&
            ((anyHistoryCount ?? 0) === 0 || Number(balance) === 0);

          // Has this hunter ever been on the receiving end of a v3 bounty?
          // Without this, every v1 hunter who happens to hold a Connect
          // account would pay a Stripe round-trip on every wallet load. Pure
          // v1 hunters must take exactly the path they take today.
          const { count: v3ActivityCount } = await supabase
            .from('bounty_v3_funding')
            .select('bounty_id', { count: 'exact', head: true })
            .eq('hunter_id', userId);
          const hasV3Activity = (v3ActivityCount ?? 0) > 0;

          if (isV3Only || hasV3Activity) {
            const CACHE_TTL_MS = 30_000;
            const nowMs = Date.now();

            const { data: cached } = await supabase
              .from('connect_balance_cache')
              .select(
                'stripe_connect_account_id, available_cents, pending_cents, currency, fetched_at'
              )
              .eq('user_id', userId)
              .maybeSingle();

            const cacheFresh =
              cached &&
              String(cached.stripe_connect_account_id ?? '') === String(connectAccountId) &&
              nowMs - new Date(cached.fetched_at as string).getTime() < CACHE_TTL_MS;

            if (cacheFresh) {
              stripeBalance = {
                availableCents: Number(cached.available_cents),
                pendingCents: Number(cached.pending_cents),
                currency: String(cached.currency ?? 'usd'),
                fetchedAt: String(cached.fetched_at),
                cached: true,
              };
            } else {
              const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
              if (stripeKey) {
                try {
                  const stripe = new Stripe(stripeKey, {
                    apiVersion: '2023-10-16',
                    httpClient: Stripe.createFetchHttpClient(),
                  });
                  const liveBalance = await stripe.balance.retrieve({
                    stripeAccount: connectAccountId,
                  });
                  const usdAvailable =
                    liveBalance.available?.find(b => b.currency === 'usd') ??
                    liveBalance.available?.[0];
                  const usdPending =
                    liveBalance.pending?.find(b => b.currency === 'usd') ??
                    liveBalance.pending?.[0];

                  const fetchedAtIso = new Date().toISOString();
                  stripeBalance = {
                    availableCents: Number(usdAvailable?.amount ?? 0),
                    pendingCents: Number(usdPending?.amount ?? 0),
                    currency: String(usdAvailable?.currency ?? 'usd'),
                    fetchedAt: fetchedAtIso,
                    cached: false,
                  };

                  await supabase.from('connect_balance_cache').upsert(
                    {
                      user_id: userId,
                      stripe_connect_account_id: connectAccountId,
                      available_cents: stripeBalance.availableCents,
                      pending_cents: stripeBalance.pendingCents,
                      currency: stripeBalance.currency,
                      fetched_at: fetchedAtIso,
                    },
                    { onConflict: 'user_id' }
                  );
                } catch (balErr) {
                  // A Stripe outage must not blank the wallet screen. Fall
                  // back to a stale cache entry if we have one; otherwise the
                  // response simply carries no stripeBalance block and the
                  // caller keeps the v1 number.
                  console.error('[wallet] Stripe balance retrieve failed', {
                    userId,
                    connectAccountId,
                    balErr,
                  });
                  if (cached) {
                    stripeBalance = {
                      availableCents: Number(cached.available_cents),
                      pendingCents: Number(cached.pending_cents),
                      currency: String(cached.currency ?? 'usd'),
                      fetchedAt: String(cached.fetched_at),
                      cached: true,
                    };
                  }
                }
              }
            }
          }
        }

        // Never sum a pooled ledger figure with a live Stripe figure. When
        // both are meaningful they are reported separately and the legacy
        // number stays in `balance`, so existing clients are unchanged.
        const legacyBalance = Number(balance) || 0;
        const stripeAvailableDollars = stripeBalance ? stripeBalance.availableCents / 100 : 0;

        let reportedBalance = legacyBalance;
        if (stripeBalance) {
          if (legacyBalance > 0) {
            balanceSource = 'both';
          } else {
            balanceSource = 'stripe_connect';
            reportedBalance = stripeAvailableDollars;
          }
        }

        return jsonResponse({
          balance: reportedBalance,
          currency: 'USD',
          // Which figure `balance` came from. 'both' means the two are
          // reported separately below and were deliberately not combined.
          balanceSource,
          legacyBalance,
          stripeBalance,
          payoutFailedAt: typedProfile?.payout_failed_at ?? null,
          payoutFailureCode: typedProfile?.payout_failure_code ?? null,
        });
      }

      // GET /wallet/transactions
      if (subPath === '/transactions') {
        const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const limit = Math.min(Number.isNaN(limitParam) ? 50 : limitParam, 100);
        const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10);
        const offset = Math.max(Number.isNaN(offsetParam) ? 0 : offsetParam, 0);

        const { data: transactions, error } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          console.error('[wallet] Error fetching transactions:', error);
          return jsonResponse(
            errorPayload('Failed to fetch transactions', 'transactions_fetch_failed', true),
            500
          );
        }

        const formattedTransactions = (transactions ?? []).map((tx: WalletTransaction) => {
          const row = tx as WalletTransaction & {
            settlement_state?: SettlementState | null;
            stripe_payout_id?: string | null;
            stripe_payout_status?: string | null;
            stripe_transfer_id?: string | null;
            stripe_charge_id?: string | null;
            stripe_refund_id?: string | null;
          };

          // Prefer the stored column; fall back to deriving from the same
          // evidence if this row predates the backfill. Both routes use the
          // identical rule, so the fallback cannot disagree with the column.
          const settlementState: SettlementState =
            row.settlement_state ??
            deriveSettlementState({
              type: tx.type,
              stripePayoutId: row.stripe_payout_id,
              stripePayoutStatus: row.stripe_payout_status,
              stripeTransferId: row.stripe_transfer_id,
              stripeChargeId: row.stripe_charge_id,
              stripePaymentIntentId: tx.stripe_payment_intent_id,
              stripeRefundId: row.stripe_refund_id,
            });

          const described = describeSettlement(tx.type, settlementState);

          return {
            id: tx.id,
            type: tx.type,
            amount: tx.amount,
            date: tx.created_at,
            details: {
              title: tx.description,
              method: tx.stripe_payment_intent_id ? 'Stripe' : 'Wallet',
              // A null status is not a settled one. This used to default to
              // 'completed', which rendered an unknown row as a green check —
              // the most reassuring possible reading of no information.
              // Mirrors the deliberate opposite choice at connect/index.ts:3027.
              status: tx.status ?? 'pending',
              settlementState,
              settlementLabel: described.label,
              settlementDetail: described.detail,
              settlementTone: described.tone,
              bounty_id: tx.bounty_id,
            },
          };
        });

        return jsonResponse({ transactions: formattedTransactions });
      }

      // POST /wallet/escrow — hold funds when a bounty is posted.
      // Mirrors the Fastify-only route that was previously unreachable from the
      // mobile client in production once EXPO_PUBLIC_SUPABASE_URL is configured
      // (API_BASE_URL resolves to the Edge Functions URL, not the Fastify server).
      if (req.method === 'POST' && subPath === '/escrow') {
        let body: {
          bountyId?: unknown;
          amount?: unknown;
          title?: unknown;
          idempotencyKey?: unknown;
        };
        try {
          body = await req.json();
        } catch {
          return jsonResponse(errorPayload('Invalid JSON body', 'invalid_json'), 400);
        }

        const bountyId = typeof body.bountyId === 'string' ? body.bountyId.trim() : '';
        const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
        const title = typeof body.title === 'string' ? body.title.trim() : undefined;
        const idempotencyKey =
          typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

        if (!bountyId)
          return jsonResponse(errorPayload('bountyId is required', 'bounty_id_required'), 400);
        if (!Number.isFinite(amount) || amount <= 0)
          return jsonResponse(errorPayload('Invalid amount', 'invalid_amount'), 400);

        const effectiveKey = idempotencyKey || `escrow_${bountyId}_${userId}`;
        const description = title ? `Escrow for bounty: ${title}` : `Escrow for bounty ${bountyId}`;

        // apply_escrow is a SECURITY DEFINER RPC that atomically:
        //   1. Returns applied=false if a completed escrow already exists (idempotent).
        //   2. Deducts the balance via update_balance() — raises on insufficient funds,
        //      rolling back the whole transaction.
        //   3. Inserts the escrow wallet_transactions row.
        // This replaces four separate non-atomic operations that were vulnerable to a
        // race condition where concurrent requests for the same bounty could both pass
        // the existence check and each create an escrow row + deduct the balance.
        const { data: escrowResult, error: escrowErr } = await supabase
          .rpc('apply_escrow', {
            p_user_id: userId,
            p_bounty_id: bountyId,
            p_amount: amount,
            p_description: description,
            p_metadata: {
              bounty_id: bountyId,
              escrowed_at: new Date().toISOString(),
              idempotency_key: effectiveKey,
            },
          })
          .single();

        if (escrowErr) {
          const errMsg: string = (escrowErr as { message?: string }).message ?? '';
          // SQLSTATE 23514 is raised by update_balance() when balance would go negative.
          if (escrowErr.code === '23514' || errMsg.toLowerCase().includes('insufficient')) {
            return jsonResponse(errorPayload('Insufficient balance', 'insufficient_balance'), 400);
          }
          console.error('[wallet] apply_escrow RPC error:', escrowErr);
          return jsonResponse(
            errorPayload('Failed to create escrow transaction', 'escrow_create_failed', true),
            500
          );
        }

        const { applied, transaction_id, new_balance } = escrowResult as {
          applied: boolean;
          transaction_id: string;
          new_balance: number | null;
        };

        if (!applied) {
          // Escrow row already exists for this bounty — typically because the
          // bounty INSERT trigger (fn_reserve_bounty_escrow) already reserved
          // funds in the same DB transaction.  This is the expected, healthy
          // outcome under the atomic reservation model; surface it as a 409
          // with the caller's current balance so the client can refresh local
          // state without treating it as an error.
          return jsonResponse(
            {
              error: 'Escrow already exists for this bounty',
              code: 'duplicate_transaction',
              retryable: false,
              transactionId: transaction_id,
              amount,
              newBalance: new_balance,
            },
            409
          );
        }

        return jsonResponse({
          success: true,
          transactionId: transaction_id,
          amount,
          newBalance: new_balance,
          message: `$${amount.toFixed(2)} held in escrow for bounty.`,
        });
      }

      // POST /wallet/refund — return escrowed funds to a poster on cancellation.
      // Also previously Fastify-only and unreachable in production with Supabase.
      if (req.method === 'POST' && subPath === '/refund') {
        let body: {
          bountyId?: unknown;
          reason?: unknown;
          idempotencyKey?: unknown;
          refundPercentage?: unknown;
        };
        try {
          body = await req.json();
        } catch {
          return jsonResponse(errorPayload('Invalid JSON body', 'invalid_json'), 400);
        }

        const bountyId = typeof body.bountyId === 'string' ? body.bountyId.trim() : '';
        const reason =
          typeof body.reason === 'string' && body.reason.trim()
            ? body.reason.trim()
            : 'Bounty cancelled';
        const idempotencyKey =
          typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
        // Clamp to (0, 100]; default to 100 (full refund) when not provided.
        const rawRefundPct =
          typeof body.refundPercentage === 'number' ? body.refundPercentage : 100;
        let refundPercentage = Math.min(100, Math.max(0, rawRefundPct));

        if (!bountyId)
          return jsonResponse(errorPayload('bountyId is required', 'bounty_id_required'), 400);

        // Authorize the caller. The poster owns the escrow, but they are not
        // always the one who triggers the refund: when the POSTER requests a
        // cancellation, the accepted hunter is the party who accepts it, and
        // bounty_cancellations' RLS requires the responder to be someone other
        // than the requester. Gating on ownership alone made every
        // poster-initiated cancellation unrefundable (403 not_bounty_owner),
        // which stranded the escrow while the bounty went to `cancelled`.
        const { data: bountyRow, error: bountyErr } = await supabase
          .from('bounties')
          .select('user_id, accepted_by')
          .eq('id', bountyId)
          .single();
        if (bountyErr || !bountyRow)
          return jsonResponse(errorPayload('Bounty not found', 'bounty_not_found'), 404);

        const bounty = bountyRow as { user_id: string; accepted_by: string | null };
        const isOwner = bounty.user_id === userId;
        let isRespondingHunter = false;
        if (!isOwner && bounty.accepted_by === userId) {
          // Only while an open cancellation request exists — the hunter has no
          // standing to refund a bounty nobody asked to cancel.
          const { data: pendingCancellation } = await supabase
            .from('bounty_cancellations')
            .select('id, requester_id, refund_percentage')
            .eq('bounty_id', bountyId)
            .eq('status', 'pending')
            .eq('requester_id', bounty.user_id)
            .limit(1)
            .maybeSingle();
          isRespondingHunter = !!pendingCancellation;
          if (pendingCancellation) {
            // The hunter never gets to choose the refund split, and neither
            // does the stored recommendation: granting a cancellation returns
            // the FULL escrow to the poster.
            //
            // This used to clamp to bounty_cancellations.refund_percentage,
            // which calculateRecommendedRefund() sets to 50 for an in-progress
            // bounty. But no flow ever pays the hunter the other half, so a
            // partial refund left the remainder stranded in escrow behind a
            // bounty that was already cancelled. Full refund until a real
            // split-settlement path exists.
            refundPercentage = 100;
          }
        }
        if (!isOwner && !isRespondingHunter) {
          return jsonResponse(
            errorPayload('Unauthorized to refund funds', 'not_bounty_owner'),
            403
          );
        }

        // Prevent double-refund / double-release.
        // Also block on 'pending' records: if a prior attempt credited the user's balance
        // but failed to promote the transaction to 'completed', the pending row must be
        // treated as a completed settlement to prevent a retry from double-crediting —
        // UNLESS it's our own pending 'refund' row, in which case we finalize it below
        // via the same atomic recovery path used by /wallet/release (apply_refund_tx).
        const { data: existingSettlement } = await supabase
          .from('wallet_transactions')
          .select('id, user_id, type, status, amount')
          .eq('bounty_id', bountyId)
          .in('type', ['release', 'refund'])
          .in('status', ['completed', 'pending'])
          .maybeSingle();
        if (existingSettlement) {
          const settlement = existingSettlement as WalletTransaction;
          const isPending = settlement.status === 'pending';
          if (isPending && settlement.type === 'refund' && settlement.user_id === bounty.user_id) {
            // Recovery path: a prior attempt inserted the pending transaction but the
            // process crashed before the balance credit and status promotion could both
            // commit. apply_refund_tx atomically promotes the status AND credits the
            // balance in a single PG transaction, so a pending row reliably means
            // "not yet credited" — no double-credit is possible.
            const recoveryAmount = Math.abs(Number(settlement.amount) || 0);

            const { data: recoveryResult, error: recoveryErr } = await supabase.rpc(
              'apply_refund_tx',
              {
                p_tx_id: settlement.id,
                p_user_id: settlement.user_id,
                p_amount: recoveryAmount,
              }
            );
            if (recoveryErr) {
              console.error('[wallet] recovery: apply_refund_tx RPC error:', recoveryErr);
              return jsonResponse(
                errorPayload(
                  'Failed to finalize pending refund during recovery',
                  'pending_refund_recovery_failed',
                  true
                ),
                500
              );
            }

            const recoveryApplied = Array.isArray(recoveryResult)
              ? (recoveryResult[0] as any)?.applied
              : (recoveryResult as any)?.applied;
            if (recoveryApplied) {
              console.log('[wallet] recovery: apply_refund_tx applied balance credit:', {
                txId: settlement.id,
              });
            } else {
              // applied=false means the UPDATE WHERE status='pending' matched no rows —
              // a concurrent request already completed this transaction (idempotent success).
              console.warn(
                '[wallet] recovery: apply_refund_tx returned applied=false — ' +
                  'transaction was likely already completed by a concurrent request:',
                settlement.id
              );
            }

            return jsonResponse({
              success: true,
              transactionId: settlement.id,
              amount: recoveryAmount,
              message: recoveryApplied
                ? 'Existing pending refund finalized.'
                : 'Refund already completed (concurrent finalization).',
            });
          }

          const verb = settlement.type === 'release' ? 'released' : 'refunded';
          return jsonResponse(
            {
              error: isPending
                ? `A ${verb} transaction for this bounty is already pending`
                : `Escrow already ${verb} for this bounty`,
              code: 'duplicate_transaction',
              retryable: false,
              settlementType: settlement.type,
              settlementStatus: settlement.status,
            },
            409
          );
        }

        // Locate the escrow transaction to determine the amount to return
        const { data: escrowTx, error: escrowErr } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('bounty_id', bountyId)
          .eq('type', 'escrow')
          .eq('status', 'completed')
          .single();
        if (escrowErr || !escrowTx)
          return jsonResponse(
            errorPayload('Escrow transaction not found', 'escrow_not_found'),
            404
          );

        // The refund goes back to whoever funded the escrow — the poster — which
        // is not the caller when a hunter accepts a poster's cancellation.
        const refundRecipientId = (escrowTx as WalletTransaction).user_id ?? bounty.user_id;
        const escrowAmount = Math.abs((escrowTx as WalletTransaction).amount);
        const refundAmount = Math.round(((escrowAmount * refundPercentage) / 100) * 100) / 100;
        const effectiveKey = idempotencyKey || `refund_${bountyId}_${refundRecipientId}`;

        // Insert refund transaction as 'pending' first; promote to 'completed' only after
        // the balance update succeeds. This prevents an orphaned 'completed' record from
        // permanently blocking future refund attempts if the balance update fails.
        const { data: refundTxRow, error: refundTxErr } = await supabase
          .from('wallet_transactions')
          .insert([
            {
              user_id: refundRecipientId,
              bounty_id: bountyId,
              type: 'refund',
              amount: refundAmount,
              description: `Refund for bounty ${bountyId}: ${reason}`,
              status: 'pending',
              metadata: {
                bounty_id: bountyId,
                escrow_transaction_id: (escrowTx as WalletTransaction).id,
                reason,
                refund_percentage: refundPercentage,
                original_escrow_amount: escrowAmount,
                refunded_at: new Date().toISOString(),
                idempotency_key: effectiveKey,
              },
            },
          ])
          .select()
          .single();
        if (refundTxErr) {
          console.error('[wallet] create refund tx error:', refundTxErr);
          return jsonResponse(
            errorPayload('Failed to create refund transaction', 'refund_create_failed', true),
            500
          );
        }

        // Atomically credit the poster's balance and promote the transaction to
        // 'completed' in a single PG transaction via apply_refund_tx. This eliminates
        // the lost-update race of a separate read-balance/write-balance round trip, and
        // the window where a process crash between separate calls would leave a pending
        // transaction with an already-credited balance (which would double-credit on retry).
        const { data: refundResult, error: refundRpcErr } = await supabase.rpc('apply_refund_tx', {
          p_tx_id: (refundTxRow as WalletTransaction).id,
          p_user_id: refundRecipientId,
          p_amount: refundAmount,
        });
        if (refundRpcErr) {
          console.error('[wallet] apply_refund_tx RPC error:', refundRpcErr);
          // Roll back the pending transaction so the caller can retry cleanly.
          await supabase
            .from('wallet_transactions')
            .delete()
            .eq('id', (refundTxRow as WalletTransaction).id);
          return jsonResponse(
            errorPayload('Failed to finalize refund transaction', 'refund_finalize_failed', true),
            500
          );
        }

        const refundApplied = Array.isArray(refundResult)
          ? (refundResult[0] as any)?.applied
          : (refundResult as any)?.applied;
        if (!refundApplied) {
          // Should not happen for a freshly-inserted pending row; log for investigation.
          console.warn(
            '[wallet] apply_refund_tx returned applied=false for new pending tx:',
            (refundTxRow as WalletTransaction).id
          );
        }

        return jsonResponse({
          success: true,
          transactionId: (refundTxRow as WalletTransaction).id,
          amount: refundAmount,
          message: `Refund of $${refundAmount.toFixed(2)} processed.`,
        });
      }

      // POST /wallet/release — release escrowed funds to hunter on bounty completion.
      if (req.method === 'POST' && subPath === '/release') {
        let body: {
          bountyId?: unknown;
          hunterId?: unknown;
          idempotencyKey?: unknown;
        };
        try {
          body = await req.json();
        } catch {
          return jsonResponse(errorPayload('Invalid JSON body', 'invalid_json'), 400);
        }

        const bountyId = typeof body.bountyId === 'string' ? body.bountyId.trim() : '';
        const idempotencyKey =
          typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

        if (!bountyId)
          return jsonResponse(errorPayload('bountyId is required', 'bounty_id_required'), 400);

        // Single authorization gate: confirms the caller owns the bounty and
        // resolves the payee from bounties.accepted_by. Everything below this
        // point writes money, so nothing may write before it returns ok.
        // Cast narrows the fully-generic SupabaseClient to the small read-only
        // surface the gate needs; matching the generic type directly blows TS's
        // instantiation depth limit.
        const auth = await resolveReleasePayee(supabase as unknown as ReleaseBountyLookupClient, {
          bountyId,
          callerId: userId,
          requestedHunterId: body.hunterId,
        });
        if (!auth.ok) {
          if (auth.code === 'hunter_mismatch') {
            // An attempt to redirect escrow to an account that did not claim the
            // bounty. Log loudly — this is not a routine 403.
            console.error('[wallet] release payee mismatch; refusing to credit:', {
              bountyId,
              callerId: userId,
              requestedHunterId: body.hunterId,
            });
          }
          return jsonResponse(
            { error: auth.error, code: auth.code, retryable: false },
            auth.status
          );
        }
        // Both derived server-side. Neither is ever taken from the request body.
        const hunterId = auth.hunterId;
        const posterId = auth.posterId;
        const bountyRow = auth.bounty;

        // Prevent double-release / double-refund
        const { data: settlementRows, error: existingSettlementErr } = await supabase
          .from('wallet_transactions')
          .select('id, user_id, type, status, amount')
          .eq('bounty_id', bountyId)
          .in('type', ['release', 'refund'])
          .in('status', ['completed', 'pending'])
          .order('created_at', { ascending: false })
          .limit(2);
        if (existingSettlementErr) {
          console.error('[wallet] failed checking existing release/refund settlement:', {
            bountyId,
            hunterId,
            error: existingSettlementErr,
          });
          return jsonResponse(
            errorPayload(
              'Failed to validate existing settlement state',
              'settlement_state_validation_failed',
              true
            ),
            500
          );
        }
        // We intentionally cap at 2 rows to avoid fetching unnecessary data while
        // still detecting duplicate settlement history:
        // - 0 rows => no prior settlement
        // - 1 row  => handle that settlement record directly
        // - 2 rows => there are at least 2 matches (possibly more), which indicates
        //            duplicate settlement history and must be blocked for safety.
        if ((settlementRows?.length ?? 0) === 2) {
          console.error('[wallet] multiple settlement rows detected; blocking duplicate release:', {
            bountyId,
            hunterId,
            settlementRows,
          });
          return jsonResponse(
            {
              error: 'A settlement transaction for this bounty is already in progress',
              code: 'duplicate_transaction',
              retryable: false,
            },
            409
          );
        }
        const existingSettlement = settlementRows?.[0] ?? null;
        if (existingSettlement) {
          const settlement = existingSettlement as WalletTransaction;
          const isPending = settlement.status === 'pending';
          if (isPending && settlement.type === 'release' && settlement.user_id === hunterId) {
            // Recovery path: the original attempt created the pending transaction but
            // the process crashed before the balance credit and status promotion could
            // both commit.  apply_release_tx atomically promotes the status AND credits
            // the balance in a single PG transaction, so a pending row reliably means
            // "not yet credited" — no double-credit is possible.
            const recoveryAmount = Math.abs(Number(settlement.amount) || 0);

            const { data: recoveryResult, error: recoveryErr } = await supabase.rpc(
              'apply_release_tx',
              {
                p_tx_id: settlement.id,
                p_hunter_id: hunterId,
                p_amount: recoveryAmount,
              }
            );
            if (recoveryErr) {
              console.error('[wallet] recovery: apply_release_tx RPC error:', recoveryErr);
              return jsonResponse(
                errorPayload(
                  'Failed to finalize pending release during recovery',
                  'pending_release_recovery_failed',
                  true
                ),
                500
              );
            }

            const recoveryApplied = Array.isArray(recoveryResult)
              ? (recoveryResult[0] as any)?.applied
              : (recoveryResult as any)?.applied;
            if (recoveryApplied) {
              console.log('[wallet] recovery: apply_release_tx applied balance credit:', {
                txId: settlement.id,
              });
            } else {
              // applied=false means the UPDATE WHERE status='pending' matched no rows.
              // The only realistic cause here (given we verified status='pending' above)
              // is a concurrent request that already completed this transaction and
              // credited the balance — an idempotent success.  A missing profile would
              // have raised a P0002 exception caught above as recoveryErr, not landed here.
              console.warn(
                '[wallet] recovery: apply_release_tx returned applied=false — ' +
                  'transaction was likely already completed by a concurrent request:',
                settlement.id
              );
            }

            return jsonResponse({
              success: true,
              transactionId: settlement.id,
              releaseAmount: recoveryAmount,
              message: recoveryApplied
                ? 'Existing pending release finalized.'
                : 'Release already completed (concurrent finalization).',
            });
          }

          const verb = settlement.type === 'release' ? 'released' : 'refunded';
          return jsonResponse(
            {
              error: isPending
                ? `A ${verb} transaction for this bounty is already pending`
                : `Escrow already ${verb} for this bounty`,
              code: 'duplicate_transaction',
              retryable: false,
              settlementType: settlement.type,
              settlementStatus: settlement.status,
            },
            409
          );
        }

        // Find the escrow transaction to determine release amount.
        // Fall back to the bounty's own amount for bounties created via the legacy
        // withdraw/bounty_posted path that never created a wallet_transactions escrow row.
        const { data: escrowTx } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('bounty_id', bountyId)
          .eq('type', 'escrow')
          .eq('status', 'completed')
          .maybeSingle();

        let totalAmount: number;
        let escrowTransactionId: string | null = escrowTx
          ? (escrowTx as WalletTransaction).id
          : null;
        if (escrowTx) {
          totalAmount = Math.abs((escrowTx as WalletTransaction).amount);
        } else {
          // Legacy bounty — first check whether an older client already recorded
          // the poster debit with the retired bounty_posted type. If not, create
          // a real escrow row now so the poster balance is debited before release.
          const { data: legacyDebitTx, error: legacyDebitErr } = await supabase
            .from('wallet_transactions')
            .select('*')
            .eq('bounty_id', bountyId)
            .eq('user_id', posterId)
            .eq('type', 'bounty_posted')
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (legacyDebitErr) {
            console.error('[wallet] failed checking legacy poster debit:', {
              bountyId,
              posterId,
              error: legacyDebitErr,
            });
            return jsonResponse(
              errorPayload(
                'Failed to validate poster balance state',
                'poster_balance_validation_failed',
                true
              ),
              500
            );
          }

          if (legacyDebitTx) {
            totalAmount = Math.abs((legacyDebitTx as WalletTransaction).amount);
            escrowTransactionId = (legacyDebitTx as WalletTransaction).id;
          } else {
            // No historical debit exists. Use the bounty's stored amount and
            // atomically create escrow + debit the poster before crediting the hunter.
            const bountyAmount = Number((bountyRow as any).amount);
            if (!bountyAmount || bountyAmount <= 0 || (bountyRow as any).is_for_honor) {
              console.error(
                '[wallet] No escrow record and no valid bounty amount for release:',
                bountyId
              );
              return jsonResponse(
                errorPayload('Escrow transaction not found', 'escrow_not_found'),
                404
              );
            }

            const { data: escrowResult, error: escrowErr } = await supabase
              .rpc('apply_escrow', {
                p_user_id: posterId,
                p_bounty_id: bountyId,
                p_amount: bountyAmount,
                p_description: `Escrow for bounty ${bountyId}`,
                p_metadata: {
                  bounty_id: bountyId,
                  escrowed_at: new Date().toISOString(),
                  created_during_release: true,
                  idempotency_key: `release_backfill_escrow_${bountyId}_${posterId}`,
                },
              })
              .single();

            if (escrowErr) {
              const errMsg = (escrowErr as { message?: string }).message ?? '';
              if (escrowErr.code === '23514' || errMsg.toLowerCase().includes('insufficient')) {
                return jsonResponse(
                  errorPayload('Insufficient balance', 'insufficient_balance'),
                  400
                );
              }
              console.error('[wallet] apply_escrow RPC error during release:', {
                bountyId,
                posterId,
                error: escrowErr,
              });
              return jsonResponse(
                errorPayload(
                  'Failed to update poster balance',
                  'poster_balance_update_failed',
                  true
                ),
                500
              );
            }

            const appliedEscrow = escrowResult as {
              applied: boolean;
              transaction_id: string | null;
            };
            escrowTransactionId = appliedEscrow.transaction_id;
            totalAmount = bountyAmount;
            if (!appliedEscrow.applied) {
              console.warn(
                '[wallet] release found escrow created by a concurrent request:',
                bountyId
              );
            } else {
              console.warn(
                '[wallet] No escrow record found; backfilled poster debit during release:',
                bountyId,
                totalAmount
              );
            }
          }
        }

        const PLATFORM_FEE_PERCENT = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '5');
        const platformFee = Math.round(((totalAmount * PLATFORM_FEE_PERCENT) / 100) * 100) / 100;
        const hunterAmount = Math.round((totalAmount - platformFee) * 100) / 100;
        const effectiveKey = idempotencyKey || `release_${bountyId}_${hunterId}`;

        // Insert release transaction as 'pending' first; promote to 'completed' after
        // the balance update succeeds to prevent orphaned completed records on failure.
        const { data: releaseTxRow, error: releaseTxErr } = await supabase
          .from('wallet_transactions')
          .insert([
            {
              user_id: hunterId,
              bounty_id: bountyId,
              type: 'release',
              amount: hunterAmount, // positive: credit to hunter
              description: `Payment for bounty ${bountyId}`,
              status: 'pending',
              metadata: {
                bounty_id: bountyId,
                escrow_transaction_id: escrowTransactionId,
                platform_fee: platformFee,
                released_at: new Date().toISOString(),
                idempotency_key: effectiveKey,
              },
            },
          ])
          .select()
          .single();
        if (releaseTxErr) {
          console.error('[wallet] create release tx error:', releaseTxErr);
          return jsonResponse(
            errorPayload('Failed to create release transaction', 'release_create_failed', true),
            500
          );
        }

        // Atomically credit the hunter's balance and promote the transaction to
        // 'completed' in a single PG transaction via apply_release_tx.  This
        // eliminates the window where a process crash between the two separate
        // Supabase calls would leave a pending transaction with an already-credited
        // balance — which would cause the recovery path to double-credit on retry.
        const { data: releaseResult, error: releaseRpcErr } = await supabase.rpc(
          'apply_release_tx',
          {
            p_tx_id: (releaseTxRow as WalletTransaction).id,
            p_hunter_id: hunterId,
            p_amount: hunterAmount,
          }
        );
        if (releaseRpcErr) {
          console.error('[wallet] apply_release_tx RPC error:', releaseRpcErr);
          // Roll back the pending transaction so the caller can retry cleanly.
          await supabase
            .from('wallet_transactions')
            .delete()
            .eq('id', (releaseTxRow as WalletTransaction).id);
          return jsonResponse(
            errorPayload('Failed to finalize release transaction', 'release_finalize_failed', true),
            500
          );
        }

        const releaseApplied = Array.isArray(releaseResult)
          ? (releaseResult[0] as any)?.applied
          : (releaseResult as any)?.applied;
        if (!releaseApplied) {
          // Should not happen for a freshly-inserted pending row; log for investigation.
          console.warn(
            '[wallet] apply_release_tx returned applied=false for new pending tx:',
            (releaseTxRow as WalletTransaction).id
          );
        }

        // Payout readiness for the hunter who was just credited.
        //
        // ADR 0001 §4.3 (option B3): this deliberately does NOT block the
        // release. A v1 credit is recoverable — the hunter onboards later and
        // withdraws — whereas blocking would strand the poster's escrow and
        // leave the hunter with nothing for completed work, over a gap that
        // resolves itself. What was actually missing was that nobody was told.
        // So: allow, label honestly, and surface the state to both sides.
        //
        // Advisory only. A lookup failure must never fail a release that has
        // already moved money in the ledger.
        let hunterPayoutReady = false;
        try {
          const { data: hunterProfile } = await supabase
            .from('profiles')
            .select('stripe_connect_account_id, stripe_connect_payouts_enabled')
            .eq('id', hunterId)
            .maybeSingle();
          const hp = hunterProfile as {
            stripe_connect_account_id?: string | null;
            stripe_connect_payouts_enabled?: boolean | null;
          } | null;
          hunterPayoutReady =
            Boolean(hp?.stripe_connect_account_id) && hp?.stripe_connect_payouts_enabled === true;
        } catch (readinessErr) {
          console.warn('[wallet] release: hunter payout readiness lookup failed', {
            bountyId,
            hunterId,
            error: readinessErr,
          });
        }

        // NOTE: the hunter's "finish payout setup" notification is NOT enqueued
        // here. It is fired by trg_wallet_tx_notify_unready_payee, an AFTER
        // INSERT trigger on wallet_transactions, so that it covers every release
        // path uniformly — including fn_release_wallet_escrow_for_dispute(),
        // which is PL/pgSQL and never passes through this function. Enqueueing
        // in both places would double-notify.

        const { data: posterProfile, error: posterBalanceErr } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', posterId)
          .maybeSingle();
        if (posterBalanceErr) {
          console.warn('[wallet] release succeeded but poster balance refresh failed:', {
            bountyId,
            posterId,
            error: posterBalanceErr,
          });
        }

        return jsonResponse({
          success: true,
          transactionId: (releaseTxRow as WalletTransaction).id,
          releaseAmount: hunterAmount,
          platformFee,
          posterBalance:
            typeof (posterProfile as Profile | null)?.balance === 'number'
              ? (posterProfile as Profile).balance
              : null,
          // A v1 release moves nothing outside Postgres — this function does
          // not import Stripe at all. The honest description is a balance
          // credit, not a payment. "Released"/"paid" here is what led both
          // parties on bounty 53656a8b ("Walk my cat") to believe $73.60 had
          // settled to a hunter who had no Connect account and could not
          // withdraw a cent of it. See ADR 0001 §2.7.
          settlementState: 'ledger_only' satisfies SettlementState,
          hunterPayoutReady,
          message: `$${hunterAmount.toFixed(2)} added to the hunter's Bounty balance.`,
          ...(hunterPayoutReady
            ? {}
            : {
                hunterPayoutWarning:
                  'This hunter has not finished payout setup, so they cannot move these funds to a bank account yet. They keep the balance and can withdraw once onboarding is complete.',
              }),
        });
      }

      return jsonResponse(errorPayload('Not found', 'route_not_found'), 404);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('[wallet edge fn] Error:', err);
      return jsonResponse(
        errorPayload('Internal server error', 'wallet_unhandled_error', true),
        500
      );
    }
  } catch (outerError: unknown) {
    const err = outerError as { message?: string };
    console.error('[wallet edge fn] Outer unhandled error:', err);
    return jsonResponse(errorPayload('Internal server error', 'wallet_unhandled_error', true), 500);
  }
});
