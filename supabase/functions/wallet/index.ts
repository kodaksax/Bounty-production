// Supabase Edge Function: wallet
// Handles wallet routes previously served by the Node/Express server.
// Routes:
//   GET  /wallet/balance
//   GET  /wallet/transactions
//   POST /wallet/deposit   (client-initiated deposit after Stripe payment confirmation)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ApplyDepositResult, Profile, WalletTransaction } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isApplyDepositResult(obj: unknown): obj is ApplyDepositResult {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return typeof o.applied === 'boolean'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Single outer try/catch ensures ALL errors—including those thrown by the
  // authentication step—are caught and returned as a JSON response instead of
  // propagating to Deno's default handler (which returns text/plain; 500).
  try {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/wallet')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[wallet edge fn] missing Authorization header')
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const token = authHeader.substring(7)

  let userId: string
  try {
    const { data, error: authError } = await supabase.auth.getUser(token)
    if (authError || !data?.user) {
      console.warn('[wallet edge fn] invalid or expired token', authError || 'no user')
      return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
    }
    userId = data.user.id
  } catch (authException: unknown) {
    const msg = (authException instanceof Error ? authException.message : String(authException))
    console.error('[wallet edge fn] getUser threw unexpectedly:', msg)
    return jsonResponse({ error: 'Authentication service unavailable. Please try again.' }, 503)
  }

  try {
    // POST /wallet/deposit — client-initiated deposit after Stripe payment confirmation.
    // Called immediately after processPayment() succeeds on the client so that
    // profiles.balance is updated durably without relying solely on the webhook.
    // Uses the apply_deposit RPC which is idempotent on stripe_payment_intent_id,
    // so a concurrent webhook delivery results in a safe no-op.
    if (req.method === 'POST' && subPath === '/deposit') {
      let body: { amount?: unknown; paymentIntentId?: unknown }
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400)
      }

      const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount)
      const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : ''

      if (!Number.isFinite(amount) || amount <= 0) {
        return jsonResponse({ error: 'Invalid amount' }, 400)
      }
      if (!paymentIntentId) {
        return jsonResponse({ error: 'paymentIntentId is required' }, 400)
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
          payment_intent_id: paymentIntentId,
          created_via: 'client_post_payment',
        },
      })

      if (applyErr) {
        console.error('[wallet] apply_deposit error:', applyErr)
        return jsonResponse({ error: 'Failed to record deposit' }, 500)
      }

      // Normalize possible shapes: RPC may return an object or an array with a single row.
      let applied = false
      let tx_id: string | null = null
      const candidate = Array.isArray(applyRes) ? (applyRes[0] as unknown) : (applyRes as unknown)
      if (isApplyDepositResult(candidate)) {
        applied = candidate.applied
        tx_id = (candidate as any).tx_id ?? null
      } else if (candidate && typeof (candidate as any).applied === 'boolean') {
        applied = Boolean((candidate as any).applied)
        tx_id = (candidate as any).tx_id ?? null
      } else {
        console.warn('[wallet] apply_deposit returned unexpected shape', applyRes)
      }

      // Fetch updated balance to return to client
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', userId)
        .single()

      if (profileError) {
        console.error('[wallet] failed to fetch updated balance after deposit:', profileError)
        return jsonResponse({ success: applied, tx_id, balance: null, warning: 'Deposit recorded, but failed to fetch updated balance' }, 500)
      }

      const newBalance = (profileData as Profile | null)?.balance ?? (applied ? amount : 0)

      return jsonResponse({ success: applied, tx_id, balance: newBalance })
    }

    // GET /wallet/balance
    if (subPath === '/balance') {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('balance, payout_failed_at, payout_failure_code')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('[wallet] Error fetching balance:', error)
        return jsonResponse({ error: 'Failed to fetch balance' }, 500)
      }

      let balance = (profile as Profile | null)?.balance ?? 0

      // Cross-check: when cached balance is 0, derive from completed
      // transactions. wallet_transactions stores signed amounts (negative for
      // debits), so we sum them directly instead of applying direction by type.
      if (balance === 0) {
        const { data: txRows } = await supabase
          .from('wallet_transactions')
          .select('amount')
          .eq('user_id', userId)
          .eq('status', 'completed')

        if (txRows && txRows.length > 0) {
          let derived = 0
          for (const tx of txRows as { amount: number }[]) {
            derived += Number(tx.amount) || 0
          }
          if (derived > 0) {
            balance = derived
            // Reconcile (fire-and-forget)
            supabase
              .from('profiles')
              .update({ balance: derived, updated_at: new Date().toISOString() })
              .eq('id', userId)
              .then(() => console.log('[wallet] Reconciled stale profile balance', userId, derived))
              .catch((err: unknown) => console.warn('[wallet] Failed to reconcile cached balance', userId, err))
          }
        }
      }

      const profileRow = profile as (Profile & { payout_failed_at?: string | null; payout_failure_code?: string | null }) | null
      return jsonResponse({
        balance,
        currency: 'USD',
        payoutFailedAt: profileRow?.payout_failed_at ?? null,
        payoutFailureCode: profileRow?.payout_failure_code ?? null,
      })
    }

    // GET /wallet/transactions
    if (subPath === '/transactions') {
      const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const limit = Math.min(Number.isNaN(limitParam) ? 50 : limitParam, 100)
      const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const offset = Math.max(Number.isNaN(offsetParam) ? 0 : offsetParam, 0)

      const { data: transactions, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        console.error('[wallet] Error fetching transactions:', error)
        return jsonResponse({ error: 'Failed to fetch transactions' }, 500)
      }

      const formattedTransactions = (transactions ?? []).map((tx: WalletTransaction) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        date: tx.created_at,
        details: {
          title: tx.description,
          method: tx.stripe_payment_intent_id ? 'Stripe' : 'Wallet',
          status: tx.status ?? 'completed',
          bounty_id: tx.bounty_id,
        },
      }))

      return jsonResponse({ transactions: formattedTransactions })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[wallet edge fn] Error:', err)
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500)
  }

  } catch (outerError: unknown) {
    const err = outerError as { message?: string }
    console.error('[wallet edge fn] Outer unhandled error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
