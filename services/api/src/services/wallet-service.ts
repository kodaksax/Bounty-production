import { db } from '../db/connection';
import { walletTransactions } from '../db/schema';
import { CreateWalletTransactionInput, WalletTransaction } from '@bountyexpo/domain-types';
import { eq } from 'drizzle-orm';

export class WalletService {
  /**
   * Create a new wallet transaction
   */
  async createTransaction(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    const transaction = await db.insert(walletTransactions).values({
      user_id: input.user_id,
      bounty_id: input.bountyId,
      type: input.type,
      amount_cents: Math.round(input.amount * 100), // Convert to cents
    }).returning();

    return this.mapToWalletTransaction(transaction[0]);
  }

  /**
   * Get transactions by user ID
   */
  async getTransactionsByUserId(userId: string): Promise<WalletTransaction[]> {
    const transactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.user_id, userId))
      .orderBy(walletTransactions.created_at);

    return transactions.map(this.mapToWalletTransaction);
  }

  /**
   * Get transactions by bounty ID
   */
  async getTransactionsByBountyId(bountyId: string): Promise<WalletTransaction[]> {
    const transactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.bounty_id, bountyId))
      .orderBy(walletTransactions.created_at);

    return transactions.map(this.mapToWalletTransaction);
  }

  /**
   * Map database record to domain type
   */
  private mapToWalletTransaction(record: any): WalletTransaction {
    return {
      id: record.id,
      user_id: record.user_id,
      type: record.type,
      amount: record.amount_cents / 100, // Convert cents back to dollars
      bountyId: record.bounty_id,
      description: `${record.type} transaction`,
      status: 'completed', // For now, all transactions are immediately completed
      createdAt: record.created_at.toISOString(),
      completedAt: record.created_at.toISOString(),
    };
  }
}

export const walletService = new WalletService();