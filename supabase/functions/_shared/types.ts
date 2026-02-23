// Shared types for Supabase Edge Functions.
// These represent the Supabase table shapes used across multiple functions.

export interface Profile {
  id: string
  email?: string | null
  balance?: number | null
  stripe_customer_id?: string | null
  stripe_connect_account_id?: string | null
  stripe_connect_onboarded_at?: string | null
}

export interface WalletTransaction {
  id: string
  user_id: string
  type: string
  amount: number
  description?: string | null
  status?: string | null
  stripe_payment_intent_id?: string | null
  stripe_transfer_id?: string | null
  stripe_charge_id?: string | null
  bounty_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
}
