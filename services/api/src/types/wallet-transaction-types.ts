/**
 * Canonical wallet ledger transaction types used across API services and routes.
 */
export const TRANSACTION_TYPES = [
  'deposit',
  'withdrawal',
  'escrow',
  'release',
  'refund',
  'platform_fee',
  'bounty_posted',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
