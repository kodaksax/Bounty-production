import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { walletTransactions } from '../db/schema';
import { walletRiskIntegration } from './wallet-risk-integration';

// Define types locally to avoid import issues
export interface CreateWalletTransactionInput {
  user_id: string;
  bountyId?: string;
  type: string;
  amount: number;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  bountyId?: string;
  description?: string;
  status: string;
  stripe_transfer_id?: string;
  platform_fee?: number;
  createdAt: string;
  completedAt?: string;
}

export class WalletService {
  /**
   * Create a new wallet transaction with risk validation
   */
  async createTransaction(input: CreateWalletTransactionInput): Promise<WalletTransaction> {
    // STEP 1: Validate transaction is allowed (BEFORE creating)
    const validation = await walletRiskIntegration.validateTransactionAllowed(
      input.user_id,
      input.type,
      Math.round(input.amount * 100) // Convert to cents
    );

    if (!validation.allowed) {
      throw new Error(validation.reason || 'Transaction not allowed due to risk restrictions');
    }

    // STEP 2: Create the transaction
    const transaction = await db.insert(walletTransactions).values({
      user_id: input.user_id,
      bounty_id: input.bountyId,
      type: input.type,
      amount_cents: Math.round(input.amount * 100), // Convert to cents
    }).returning();

    const transactionId = transaction[0].id;

    // STEP 3: Monitor transaction for risk patterns (AFTER creating)
    // This runs asynchronously and won't block the response
    walletRiskIntegration.monitorTransaction(transactionId).catch(error => {
      console.error('Error monitoring transaction for risk:', error);
      // Don't throw - monitoring is best-effort
    });

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
      stripe_transfer_id: record.stripe_transfer_id,
      platform_fee: record.platform_fee_cents ? record.platform_fee_cents / 100 : undefined,
      createdAt: record.created_at.toISOString(),
      completedAt: record.created_at.toISOString(),
    };
  }
}

export const walletService = new WalletService();