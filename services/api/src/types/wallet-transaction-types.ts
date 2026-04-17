export const TRANSACTION_TYPES = [
  'deposit',
  'withdrawal',
  'escrow',
  'release',
  'refund',
  'platform_fee',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
