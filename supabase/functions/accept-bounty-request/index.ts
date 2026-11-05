// Allow remote Deno std import in this file (Edge Function runtime).
// @ts-ignore: Remote Deno std types may not be available to the workspace TypeScript server
import { serve } from 'https://deno.land/std@0.201.0/http/server.ts';
import Stripe from 'npm:stripe@14';
import {
  blockedAccountCode,
  fundAcceptanceFromCard,
  mayChargeCard,
  unwindChargeAfterFailedAccept,
  type AcceptFundingDeps,
  type AcceptFundingResult,
  type FundingStripe,
} from './logic.ts';

// Edge Function: accept-bounty-request
// POST body: { request_id: string, allow_card_charge?: boolean }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_KEY') ||
  Deno.env.get('SERVICE_ROLE_KEY') ||
  '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in environment');
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

// The app's web build calls this from a browser. Access is by the bearer token,
// checked below, so the origin doesn't matter.
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Wrap DB queries in a timeout so a paused/cold-starting DB returns a fast
// failure instead of hanging (mirrors payments/wallet/bounty-payments).
// fn_accept_bounty_request is deliberately NOT wrapped: a timeout there would
// not stop it committing, and we would then refund a hire that went through.
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

function fundingDeps(baseUrl: string, callerToken: string): AcceptFundingDeps | null {
  if (!STRIPE_SECRET_KEY) return null;

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  }) as unknown as FundingStripe;

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  const firstRow = async (path: string): Promise<any> => {
    const res = await withDbTimeout(
      fetch(`${baseUrl}/rest/v1/${path}`, { headers: serviceHeaders })
    );
    if (!res.ok) throw new Error(`${path.split('?')[0]} lookup failed: ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] ?? null : null;
  };

  const rpc = async (name: string, args: unknown, bearer: string): Promise<any> => {
    const res = await withDbTimeout(
      fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(args),
      })
    );
    if (!res.ok)
      throw new Error(`${name} failed: ${res.status} ${await res.text().catch(() => '')}`);
    return res.json();
  };

  return {
    stripe,
    // Runs as the poster: the function refuses any caller but the poster, and
    // the ownership check above has established that this caller is one. A 42501
    // from a stale denormalized poster_id throws, which means "no charge".
    getShortfall: async bountyId => {
      const rows = await rpc(
        'fn_get_bounty_funding_requirement',
        { p_bounty_id: bountyId },
        callerToken
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      return row ? Number(row.shortfall) : null;
    },
    getBountyStatus: async bountyId =>
      (await firstRow(`bounties?id=eq.${encodeURIComponent(bountyId)}&select=status`))?.status ??
      null,
    getProfileCustomerId: async userId =>
      (await firstRow(`profiles?id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id`))
        ?.stripe_customer_id ?? null,
    getDefaultCardId: async userId =>
      (
        await firstRow(
          `payment_methods?user_id=eq.${encodeURIComponent(
            userId
          )}&type=eq.card&is_default=eq.true` +
            `&select=stripe_payment_method_id&order=updated_at.desc&limit=1`
        )
      )?.stripe_payment_method_id ?? null,
    getRequestStatus: async requestId =>
      (await firstRow(`bounty_requests?id=eq.${encodeURIComponent(requestId)}&select=status`))
        ?.status ?? null,
    applyDeposit: async ({ userId, amount, paymentIntentId, metadata }) => {
      await rpc(
        'apply_deposit',
        {
          p_user_id: userId,
          p_amount: amount,
          p_payment_intent_id: paymentIntentId,
          p_metadata: metadata,
        },
        SUPABASE_SERVICE_KEY
      );
    },
    applyRefund: async ({ userId, amount, refundId, chargeId, description, metadata }) => {
      await rpc(
        'apply_refund',
        {
          p_user_id: userId,
          p_amount: amount,
          p_stripe_refund_id: refundId,
          p_stripe_charge_id: chargeId,
          p_description: description,
          p_metadata: metadata,
        },
        SUPABASE_SERVICE_KEY
      );
    },
    alertAdmins: async ({ title, body, bountyId }) => {
      // The paging list, which delivers through send-notification-email. If the
      // database is the thing that failed, go straight to that function: its
      // team alert needs no database.
      try {
        await rpc(
          'fn_notify_admins',
          {
            p_type: 'accept_refund_reversal_failed',
            p_severity: 'critical',
            p_title: title,
            p_body: body,
            p_data: {},
            p_bounty_id: bountyId,
          },
          SUPABASE_SERVICE_KEY
        );
        return;
      } catch (err) {
        console.error('accept-bounty-request: fn_notify_admins failed, using the team alert', err);
      }
      try {
        const res = await fetch(`${baseUrl}/functions/v1/send-notification-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ supportAlert: true, title, body, data: {} }),
        });
        if (!res.ok) console.error('accept-bounty-request: team alert failed', res.status);
      } catch (err) {
        console.error('accept-bounty-request: team alert failed', err);
      }
    },
    log: {
      warn: (message, details) => console.warn(message, details),
      error: (message, details) => console.error(message, details),
    },
  };
}

const handleRequest = async (req: Request): Promise<Response> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(
        JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_URL or SERVICE_ROLE_KEY' }),
        { status: 500 }
      );
    }
    if (req.method !== 'POST')
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

    // Authenticate the caller. Stripe and the wallet RPCs run with the service
    // key, so nothing here may proceed on behalf of an unverified user.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid authorization header' }), {
        status: 401,
      });
    }
    const callerToken = authHeader.substring(7);
    const baseUrl = SUPABASE_URL.replace(/\/$/, '');
    const userResp = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${callerToken}` },
    }).catch(() => null);
    if (!userResp || !userResp.ok) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 });
    }
    const callerUser: any = await userResp.json().catch(() => null);
    const callerId = callerUser?.id;
    if (!callerId) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 });
    }

    const body: any = await (req.json?.() ?? Promise.resolve(null)).catch(() => null);
    const requestId = body?.request_id || body?.id;
    if (!requestId)
      return new Response(JSON.stringify({ error: 'Missing request_id' }), { status: 400 });

    // A first check, to refuse strangers before doing any work. It is not the
    // authority: bounty_requests.poster_id is written by the applying hunter and
    // no policy checks it. fn_accept_bounty_request below runs as this caller and
    // checks the bounty's own poster, and fn_get_bounty_funding_requirement does
    // the same before any charge.
    const lookupUrl = `${baseUrl}/rest/v1/bounty_requests?id=eq.${encodeURIComponent(
      String(requestId)
    )}&select=poster_id,status,bounty_id`;
    const lookupResp = await fetch(lookupUrl, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    }).catch(() => null);
    if (!lookupResp || !lookupResp.ok) {
      return new Response(JSON.stringify({ error: 'Failed to verify bounty request' }), {
        status: 502,
      });
    }
    const lookupRows: any = await lookupResp.json().catch(() => null);
    const requestRow = Array.isArray(lookupRows) ? lookupRows[0] : null;
    if (!requestRow) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }
    if (requestRow.poster_id !== callerId) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: only the bounty poster can accept requests' }),
        { status: 403 }
      );
    }

    // A suspended poster can't hire, and must never reach the charge below. The
    // service-role RPC call skips its own assert_account_active. If the status
    // can't be read, nothing has happened yet, so fail closed.
    let accountStatus: string | null;
    try {
      const statusResp = await withDbTimeout(
        fetch(
          `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=account_status`,
          {
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            },
          }
        )
      );
      if (!statusResp.ok) throw new Error(`status ${statusResp.status}`);
      const statusRows: any = await statusResp.json();
      accountStatus = Array.isArray(statusRows) ? statusRows[0]?.account_status ?? null : null;
    } catch (statusErr) {
      console.error('accept-bounty-request: could not read account status', statusErr);
      return new Response(JSON.stringify({ error: 'Failed to verify account status' }), {
        status: 503,
      });
    }
    const blocked = blockedAccountCode(accountStatus);
    if (blocked) {
      return new Response(
        JSON.stringify({ error: 'Your account cannot accept requests right now', code: blocked }),
        { status: 403 }
      );
    }

    // Pay at accept with a saved card: charge any wallet shortfall as a deposit,
    // then accept below as usual. The app sends allow_card_charge: false because
    // its own sheet has already shown the poster the amount and taken any payment,
    // so a shortfall here is a balance that moved after they confirmed: refuse it
    // and let the sheet ask, rather than charge a card they were told it wouldn't.
    const funding = mayChargeCard(requestRow.status, body?.allow_card_charge)
      ? fundingDeps(baseUrl, callerToken)
      : null;
    let funded: AcceptFundingResult = { kind: 'not_charged' };
    if (funding) {
      funded = await fundAcceptanceFromCard(funding, {
        requestId: sanitizeText(requestId),
        bountyId: sanitizeText(requestRow.bounty_id),
        posterId: callerId,
      });
    }
    if (funded.kind === 'card_failed') {
      console.warn('accept-bounty-request: card not charged', {
        requestId,
        reason: funded.reason,
      });
      return new Response(
        JSON.stringify({
          error: 'Payment required: your card could not be charged',
          code: 'card_charge_failed',
          fallback: 'top_up',
        }),
        { status: 402 }
      );
    }
    if (funded.kind === 'in_progress') {
      return new Response(
        JSON.stringify({
          error: 'This acceptance is already in progress',
          code: 'accept_in_progress',
        }),
        { status: 409 }
      );
    }
    if (funded.kind === 'unavailable') {
      return new Response(
        JSON.stringify({
          error: 'Could not confirm the payment. Please try again.',
          code: 'payment_unconfirmed',
        }),
        { status: 503 }
      );
    }

    // Call the DB-stored PL/pgSQL function via Supabase REST RPC endpoint
    const rpcUrl = `${baseUrl}/rest/v1/rpc/fn_accept_bounty_request`;

    // As the caller, never the service key: the RPC only checks the poster and
    // account status when auth.role() = 'authenticated'.
    const rpcResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${callerToken}`,
      },
      body: JSON.stringify({ p_request_id: String(requestId) }),
    }).catch(e => ({ ok: false, status: 500, text: () => Promise.resolve(String(e)) }));

    const isResponse = (r: any): r is Response => !!r && typeof r.json === 'function';

    if (!rpcResp || !('ok' in rpcResp) || !rpcResp.ok) {
      const status = rpcResp && 'status' in rpcResp ? rpcResp.status : 500;
      const text = await (rpcResp && typeof (rpcResp as any).text === 'function'
        ? (rpcResp as any).text()
        : Promise.resolve('<no-body>'));
      console.error('fn_accept_bounty_request RPC failed', { status, text });
      if (funded.kind === 'charged' && funding) {
        const unwound = await unwindChargeAfterFailedAccept(funding, {
          requestId: sanitizeText(requestId),
          posterId: callerId,
          charge: funded,
          bountyId: sanitizeText(requestRow.bounty_id),
          rpcStatus: status,
          rpcBody: text || '',
        });
        console.warn('accept-bounty-request: acceptance failed after a charge', {
          requestId,
          paymentIntentId: funded.paymentIntentId,
          unwound,
        });
      }
      // Map not-found errors to 404, and state-conflict errors to 409
      if (/request_not_found|bounty_not_found/i.test(text || '')) {
        return new Response(JSON.stringify({ error: 'Not Found', details: text }), { status: 404 });
      }
      // Pay-at-accept funding failures. fn_accept_bounty_request reserves
      // escrow in the same transaction as the acceptance, so this means the
      // WHOLE transaction rolled back: the bounty is still open, the request
      // still pending, nothing was charged and no hunter was assigned. 402
      // keeps it distinguishable from the 409 state conflicts below, which the
      // client recovers from very differently.
      if (
        /insufficient_funds_for_escrow|bounty_not_funded|_locked_by_|bounty_funding_mode_is_immutable/i.test(
          text || ''
        )
      ) {
        return new Response(
          JSON.stringify({
            error: 'Payment required: this bounty is not funded yet',
            details: text,
          }),
          { status: 402 }
        );
      }
      if (/request_not_pending|bounty_not_open/i.test(text || '')) {
        return new Response(
          JSON.stringify({
            error: 'Conflict: bounty not open or request not pending',
            details: text,
          }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify({ error: 'Server error', details: text }), {
        status: status,
      });
    }

    if (!isResponse(rpcResp)) {
      // Unexpected shape (shouldn't happen if ok === true), but defend anyway
      return new Response(JSON.stringify({ error: 'Unexpected RPC response' }), { status: 500 });
    }

    const data = await rpcResp.json().catch(() => null);

    // Payout readiness travels back with the acceptance so the hunter can be
    // prompted to finish Connect onboarding BEFORE they start work, rather than
    // discovering after delivery that the money they earned cannot reach a bank
    // account. On bounty 53656a8b ("Walk my cat") nobody was told at any point.
    //
    // Advisory only — ADR 0001 §4.3 (option B3) deliberately does not block
    // acceptance on this. Blocking would strand 313 of 315 profiles, and a v1
    // balance credit is recoverable the moment the hunter onboards. A lookup
    // failure must likewise never fail an otherwise-successful acceptance.
    let hunterPayoutReady: boolean | null = null;
    try {
      const acceptedRow = Array.isArray(data) ? data[0] : data;
      const hunterId: string | undefined =
        acceptedRow?.hunter_id ?? acceptedRow?.accepted_by ?? undefined;
      if (hunterId) {
        const profileUrl =
          `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(hunterId)}` +
          `&select=stripe_connect_account_id,stripe_connect_payouts_enabled`;
        const profileResp = await fetch(profileUrl, {
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        });
        if (profileResp.ok) {
          const rows: any = await profileResp.json().catch(() => null);
          const hp = Array.isArray(rows) ? rows[0] : null;
          hunterPayoutReady =
            Boolean(hp?.stripe_connect_account_id) &&
            hp?.stripe_connect_payouts_enabled === true;
        }
      }
    } catch (readinessError) {
      console.warn('accept-bounty-request: payout readiness lookup failed', readinessError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data,
        hunterPayoutReady,
        ...(hunterPayoutReady === false
          ? {
              hunterPayoutPrompt:
                'Finish payout setup to receive money for this bounty in your bank account.',
            }
          : {}),
      }),
      { status: 200 }
    );
  } catch (e) {
    console.error('Unhandled error in accept-bounty-request', e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'Server error', details: message }), {
      status: 500,
    });
  }
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const response = await handleRequest(req);
  for (const [name, value] of Object.entries(corsHeaders)) response.headers.set(name, value);
  return response;
});
