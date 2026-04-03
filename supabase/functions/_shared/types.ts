// Shared types for Supabase Edge Functions.
// These represent the Supabase table shapes used across multiple functions.

export interface Profile {
  id: string
  email?: string | null
  balance?: number | null
  stripe_customer_id?: string | null
  stripe_connect_account_id?: string | null
  stripe_connect_onboarded_at?: string | null
  payout_failed_at?: string | null
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

export interface PaymentMethod {
  id: string
  user_id: string
  stripe_payment_method_id: string
  type: string
  card_brand?: string | null
  card_last4?: string | null
  card_exp_month?: number | null
  card_exp_year?: number | null
  is_default?: boolean | null
  created_at: string
  updated_at: string
}

export interface StripeEvent {
  id: string
  stripe_event_id: string
  event_type: string
  processed: boolean
  processed_at?: string | null
  event_data?: Record<string, unknown> | null
  created_at: string
  status?: 'processing' | 'processed' | 'failed' | null
  retry_count?: number | null
  last_error?: string | null
  last_retry_at?: string | null
}
