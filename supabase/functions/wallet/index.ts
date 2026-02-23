// Supabase Edge Function: wallet
// Handles wallet routes previously served by the Node/Express server.
// Routes:
//   GET /wallet/balance
//   GET /wallet/transactions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Profile, WalletTransaction } from '../_shared/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  if (req.method !== 'GET') {
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
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }
  const userId = user.id

  try {
    // GET /wallet/balance
    if (subPath === '/balance') {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('[wallet] Error fetching balance:', error)
        return jsonResponse({ error: 'Failed to fetch balance' }, 500)
      }

      return jsonResponse({ balance: (profile as Profile | null)?.balance ?? 0, currency: 'USD' })
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
})
