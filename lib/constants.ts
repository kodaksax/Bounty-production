// Shared application constants
export const DEFERRED_PUSH_REGISTRATION_KEY = 'notifications:register_on_signin'

// ────────────────────────────────────────────────────────────
// Wallet / Payment constants
// ────────────────────────────────────────────────────────────

/**
 * Minimum withdrawal amount in USD.
 *
 * Mobile UI components import from this file. The API server (`services/api/src/routes/wallet.ts`)
 * keeps its own copy because it cannot import from the mobile `lib/` directory.
 * Keep both values in sync when changing the threshold.
 */
export const MIN_WITHDRAWAL_AMOUNT = 10; // USD
