/**
 * Wallet utility functions
 * Shared helpers for wallet balance calculations and operations
 */

import { db } from '../db/connection';
import { walletTransactions } from '../db/schema';
import { eq } from 'drizzle-orm';

// Transaction types that add to balance (inflow)
export const INFLOW_TYPES = ['deposit', 'release', 'refund', 'bounty_received'];

// Transaction types that subtract from balance (outflow)
export const OUTFLOW_TYPES = ['withdrawal', 'escrow', 'bounty_posted'];

/**
 * Calculate wallet balance from transactions
 * This is the single source of truth for balance calculations
 * 
 * PERFORMANCE NOTES:
 * - Current implementation fetches all transactions per user for accuracy
 * - Acceptable for initial deployment (most users have < 100 transactions)
 * - Query is indexed on user_id for optimal performance
 * 
 * FUTURE OPTIMIZATION (if needed for scale):
 * - Add a cached `balance_cents` column to users table
 * - Update balance atomically with each transaction using database triggers
 * - Implement periodic reconciliation job to verify cached vs. calculated balance
 * - Add database-level aggregation queries with proper indexing
 * 
 * The current approach prioritizes correctness and simplicity over performance.
 */
export async function calculateUserBalance(userId: string): Promise<number> {
  const transactions = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.user_id, userId));

  let balanceCents = 0;
  for (const tx of transactions) {
    if (INFLOW_TYPES.includes(tx.type)) {
      balanceCents += tx.amount_cents;
    } else if (OUTFLOW_TYPES.includes(tx.type)) {
      balanceCents -= tx.amount_cents;
    }
  }
  return balanceCents;
}
