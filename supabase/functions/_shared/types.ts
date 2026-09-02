// Shared types for Supabase Edge Functions.
// These represent the Supabase table shapes used across multiple functions.

export interface Profile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  zip_code?: string | null;
  balance?: number | null;
  balance_on_hold?: number | null;
  stripe_customer_id?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_connect_onboarded_at?: string | null;
  /**
   * Live-synced by the account.updated / capability.updated webhooks. This —
   * NOT stripe_connect_onboarded_at, which is set once and never cleared — is
   * the field that answers "can this account receive a payout right now".
   */
  stripe_connect_payouts_enabled?: boolean | null;
  stripe_connect_charges_enabled?: boolean | null;
  payout_failed_at?: string | null;
  payout_failure_code?: string | null;
  account_status?: string | null;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  description?: string | null;
  status?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_transfer_id?: string | null;
  stripe_charge_id?: string | null;
  stripe_payout_id?: string | null;
  stripe_refund_id?: string | null;
  /** Stripe's own payout.status, written only by the payout webhooks. */
  stripe_payout_status?: string | null;
  /** Derived by fn_derive_settlement_state(); never written by application code. */
  settlement_state?: 'ledger_only' | 'stripe_pending' | 'stripe_settled' | 'stripe_failed' | null;
  payout_method?: string | null;
  idempotency_key?: string | null;
  bounty_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface ApplyDepositResult {
  applied: boolean;
  tx_id?: string | null;
}
