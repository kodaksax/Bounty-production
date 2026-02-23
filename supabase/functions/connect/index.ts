// Supabase Edge Function: connect
// Handles all /connect/* routes previously served by the Node/Express server.
// Routes:
//   POST /connect/create-account-link
//   POST /connect/verify-onboarding
//   POST /connect/transfer
//   POST /connect/retry-transfer

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno&no-check'
import type { Profile, WalletTransaction } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/connect')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500)
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }
  const userId = user.id

  try {
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:8081'

    // POST /connect/create-account-link
    if (subPath === '/create-account-link') {
      const body = await req.json()
      const { returnUrl, refreshUrl } = body

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, email')
        .eq('id', userId)
        .single()

      const profileRow = profile as Profile | null
      let accountId = profileRow?.stripe_connect_account_id

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          email: profileRow?.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: 'individual',
          metadata: { user_id: userId },
        })
        accountId = account.id
        await supabase.from('profiles').update({ stripe_connect_account_id: accountId }).eq('id', userId)
        console.log(`[connect] Created new account: ${accountId} for user ${userId}`)
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl ?? `${appUrl}/wallet/connect/refresh`,
        return_url: returnUrl ?? `${appUrl}/wallet/connect/return`,
        type: 'account_onboarding',
      })

      return jsonResponse({
        url: accountLink.url,
        accountId,
        expiresAt: accountLink.expires_at * 1000,
      })
    }

    // POST /connect/verify-onboarding
    if (subPath === '/verify-onboarding') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single()

      const profileRow = profile as Profile | null
      if (!profileRow?.stripe_connect_account_id) {
        return jsonResponse({ onboarded: false })
      }

      const account = await stripe.accounts.retrieve(profileRow.stripe_connect_account_id)
      const onboarded = account.charges_enabled && account.payouts_enabled

      if (onboarded && !profileRow.stripe_connect_onboarded_at) {
        await supabase
          .from('profiles')
          .update({ stripe_connect_onboarded_at: new Date().toISOString() })
          .eq('id', userId)
      }

      return jsonResponse({
        onboarded,
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      })
    }

    // POST /connect/transfer
    if (subPath === '/transfer') {
      const body = await req.json()
      const { amount, currency = 'usd' } = body

      if (!amount || amount <= 0) {
        return jsonResponse({ error: 'Invalid amount' }, 400)
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('balance, stripe_connect_account_id, stripe_connect_onboarded_at')
        .eq('id', userId)
        .single()

      if (!profile) {
        return jsonResponse({ error: 'Profile not found' }, 404)
      }

      const p = profile as Profile
      if (!p.stripe_connect_account_id || !p.stripe_connect_onboarded_at) {
        return jsonResponse({ error: 'Stripe Connect account not set up' }, 400)
      }

      if ((p.balance ?? 0) < amount) {
        return jsonResponse({ error: 'Insufficient balance' }, 400)
      }

      const transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency,
        destination: p.stripe_connect_account_id,
        metadata: { user_id: userId },
      })

      const { data: transaction, error: txError } = await supabase
        .from('wallet_transactions')
        .insert({
          user_id: userId,
          type: 'withdrawal',
          amount: -amount,
          description: 'Withdrawal to bank account',
          status: 'pending',
          stripe_transfer_id: transfer.id,
          stripe_connect_account_id: p.stripe_connect_account_id,
          metadata: { transfer },
        })
        .select()
        .single()

      if (txError) {
        console.error('[connect] Error creating transaction:', txError)
        throw txError
      }

      const { error: balanceError } = await supabase.rpc('update_balance', {
        p_user_id: userId,
        p_amount: -amount,
      })

      if (balanceError) {
        console.error('[connect] Error updating balance:', balanceError)
        throw new Error('Failed to update balance')
      }

      return jsonResponse({
        transferId: transfer.id,
        status: 'pending',
        amount,
        currency,
        accountId: p.stripe_connect_account_id,
        transactionId: (transaction as WalletTransaction).id,
        estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        message: 'Transfer initiated. Funds typically arrive in 1-2 business days.',
      })
    }

    // POST /connect/retry-transfer
    if (subPath === '/retry-transfer') {
      const body = await req.json()
      const { transactionId } = body

      if (!transactionId) {
        return jsonResponse({ error: 'Transaction ID is required' }, 400)
      }

      const { data: tx, error: txError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .eq('status', 'failed')
        .single()

      if (txError || !tx) {
        return jsonResponse({ error: 'Failed transaction not found' }, 404)
      }

      const t = tx as WalletTransaction
      const retryCount = (t.metadata as Record<string, unknown> | null)?.retry_count as number ?? 0
      if (retryCount >= 3) {
        return jsonResponse({
          error: 'Maximum retry attempts reached. Please contact support.',
          maxRetriesReached: true,
        }, 400)
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, balance')
        .eq('id', userId)
        .single()

      const p = profile as Profile | null
      if (!p?.stripe_connect_account_id) {
        return jsonResponse({ error: 'Stripe Connect account not found' }, 400)
      }

      const amount = Math.abs(t.amount)

      if ((p.balance ?? 0) < amount) {
        return jsonResponse({ error: 'Insufficient balance for retry' }, 400)
      }

      const { error: rpcError } = await supabase.rpc('decrement_balance', {
        p_user_id: userId,
        p_amount: amount,
      })

      let balanceDeducted = !rpcError

      if (rpcError) {
        console.warn('[connect] RPC not available, using optimistic locking for transfer retry')
        const { data: updatedProfile, error: updateError } = await supabase
          .from('profiles')
          .update({ balance: (p.balance ?? 0) - amount })
          .eq('id', userId)
          .eq('balance', p.balance)
          .select()
          .single()

        if (updateError || !updatedProfile) {
          return jsonResponse({
            error: 'Balance changed during processing. Please try again.',
            code: 'BALANCE_CONFLICT',
          }, 409)
        }
        balanceDeducted = true
      }

      if (!balanceDeducted) {
        return jsonResponse({ error: 'Failed to deduct balance for retry' }, 400)
      }

      let transfer: Stripe.Transfer
      try {
        transfer = await stripe.transfers.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          destination: p.stripe_connect_account_id,
          metadata: { user_id: userId, retry_of_transaction: transactionId },
        })
      } catch (stripeError) {
        console.error('[connect] Transfer creation failed, refunding balance:', stripeError)
        await supabase.rpc('increment_balance', { p_user_id: userId, p_amount: amount }).catch(async () => {
          await supabase.from('profiles').update({ balance: p.balance }).eq('id', userId)
        })
        throw stripeError
      }

      await supabase
        .from('wallet_transactions')
        .update({
          stripe_transfer_id: transfer.id,
          status: 'pending',
          metadata: { ...t.metadata, retry_count: retryCount + 1, retried_at: new Date().toISOString() },
        })
        .eq('id', transactionId)

      console.log(`[connect] Transfer retry successful: ${transfer.id} for transaction ${transactionId}`)

      return jsonResponse({
        success: true,
        transferId: transfer.id,
        transactionId,
        message: 'Transfer retry initiated successfully.',
      })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[connect edge fn] Error:', err)
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500)
  }
})
