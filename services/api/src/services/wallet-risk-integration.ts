import { riskManagementService } from './risk-management-service';
import { db } from '../db/connection';
import { walletTransactions } from '../db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';

/**
 * Integration service to connect wallet operations with risk management
 * 
 * This service ensures all wallet transactions are monitored for risk
 */
export class WalletRiskIntegrationService {
  /**
   * Monitor a wallet transaction for risk patterns
   * Called after a transaction is created
   */
  async monitorTransaction(transactionId: string): Promise<void> {
    try {
      // Get transaction details
      const txn = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, transactionId))
        .limit(1);

      if (!txn.length) {
        console.warn(`Transaction ${transactionId} not found for risk monitoring`);
        return;
      }

      const transaction = txn[0];

      // Monitor transaction patterns
      await riskManagementService.monitorTransactionPattern(
        transaction.user_id,
        transactionId,
        {
          type: transaction.type,
          amount_cents: transaction.amount_cents,
          bounty_id: transaction.bounty_id,
        }
      );

      // Check if user needs a periodic risk assessment
      // (Run assessment every 50 transactions or weekly, whichever comes first)
      const shouldAssess = await this.shouldRunPeriodicAssessment(transaction.user_id);
      
      if (shouldAssess) {
        console.log(`Running periodic risk assessment for user ${transaction.user_id}`);
        await riskManagementService.assessUserRisk(transaction.user_id, 'periodic');
      }
    } catch (error) {
      console.error('Error monitoring transaction for risk:', error);
      // Don't throw - risk monitoring shouldn't block transactions
    }
  }

  /**
   * Determine if a periodic risk assessment should be run
   */
  private async shouldRunPeriodicAssessment(userId: string): Promise<boolean> {
    // Run assessment every 50 transactions
    const txnCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(eq(walletTransactions.user_id, userId));

    const count = txnCount[0]?.count || 0;

    // Run on multiples of 50
    return count > 0 && count % 50 === 0;
  }

  /**
   * Validate transaction before creation
   * Checks if user is restricted or requires additional verification
   */
  async validateTransactionAllowed(
    userId: string,
    transactionType: string,
    amountCents: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // Get user from database
      const { users } = await import('../db/schema');
      const userRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord.length) {
        return {
          allowed: false,
          reason: 'User not found',
        };
      }

      const user = userRecord[0];

      // Check if account is restricted
      if (user.account_restricted) {
        return {
          allowed: false,
          reason: user.restriction_reason || 'Account is restricted. Please contact support.',
        };
      }

      // Check verification status for certain transaction types
      if (['withdrawal', 'escrow'].includes(transactionType)) {
        if (user.verification_status === 'rejected') {
          return {
            allowed: false,
            reason: 'Account verification was rejected. Please contact support.',
          };
        }

        if (user.verification_status === 'pending' && amountCents > 10000) {
          // Allow small transactions ($100 or less) for unverified users
          return {
            allowed: false,
            reason: 'Please complete account verification to make transactions over $100.',
          };
        }
      }

      // Check if user is high/critical risk for large transactions
      if (['withdrawal', 'escrow'].includes(transactionType) && amountCents > 50000) {
        // $500+ transactions
        if (user.risk_level === 'critical' || user.risk_level === 'high') {
          return {
            allowed: false,
            reason: 'Large transactions are temporarily restricted on your account. Please contact support.',
          };
        }
      }

      return {
        allowed: true,
      };
    } catch (error) {
      console.error('Error validating transaction:', error);
      // Fail open for availability (but log the error)
      return {
        allowed: true,
      };
    }
  }

  /**
   * Calculate required reserve for a user based on their transaction history
   */
  async calculateRecommendedReserve(userId: string): Promise<{
    recommendedAmountCents: number;
    percentage: number;
    reason: string;
  }> {
    try {
      // Get user's risk assessment
      const assessment = await riskManagementService.assessUserRisk(userId, 'reserve_calculation');

      // Calculate 30-day transaction volume
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentTransactions = await db
        .select()
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.user_id, userId),
            gte(walletTransactions.created_at, thirtyDaysAgo)
          )
        );

      const totalVolumeCents = recentTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount_cents), 0);

      // Reserve percentage based on risk level
      const percentage = assessment.reservePercentage || 5;

      const recommendedAmountCents = Math.round(totalVolumeCents * (percentage / 100));

      return {
        recommendedAmountCents,
        percentage,
        reason: `${percentage}% reserve recommended based on ${assessment.riskLevel} risk level`,
      };
    } catch (error) {
      console.error('Error calculating recommended reserve:', error);
      // Default to minimum reserve
      return {
        recommendedAmountCents: 5000, // $50 minimum
        percentage: 5,
        reason: 'Default minimum reserve',
      };
    }
  }

  /**
   * Check and establish reserves for a user if needed
   */
  async ensureReservesEstablished(userId: string): Promise<void> {
    try {
      const reserve = await this.calculateRecommendedReserve(userId);

      if (reserve.recommendedAmountCents > 0) {
        await riskManagementService.establishReserve(
          userId,
          'rolling',
          reserve.recommendedAmountCents,
          reserve.percentage,
          reserve.reason,
          90 // 90-day release
        );

        console.log(`✅ Established ${reserve.percentage}% reserve (${reserve.recommendedAmountCents} cents) for user ${userId}`);
      }
    } catch (error) {
      console.error('Error ensuring reserves established:', error);
      // Don't throw - reserve establishment is best-effort
    }
  }
}

export const walletRiskIntegration = new WalletRiskIntegrationService();
