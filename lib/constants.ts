// Shared application constants
export const DEFERRED_PUSH_REGISTRATION_KEY = 'notifications:register_on_signin'

// ────────────────────────────────────────────────────────────
// Wallet / Payment constants
// ────────────────────────────────────────────────────────────

/**
 * Minimum withdrawal amount in USD.
 *
 * This threshold must also be kept in sync with the server-side schema:
 *   services/api/src/routes/wallet.ts  →  MIN_WITHDRAWAL_AMOUNT
 *
 * All mobile UI components import from this file; only the API server
 * keeps its own copy because it cannot import from the mobile lib.
 */
export const MIN_WITHDRAWAL_AMOUNT = 10; // USD
