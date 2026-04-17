/**
 * Canonical transaction types permitted by the `wallet_transactions.type` DB CHECK constraint.
 */
export const TRANSACTION_TYPES = [
  'deposit',
  'withdrawal',
  'escrow',
  'release',
  'refund',
  'dispute_loss',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * Platform ledger fee types recorded in `platform_ledger`, not `wallet_transactions`.
 */
export const PLATFORM_LEDGER_FEE_TYPES = ['platform_fee'] as const;
export type PlatformLedgerFeeType = (typeof PLATFORM_LEDGER_FEE_TYPES)[number];
