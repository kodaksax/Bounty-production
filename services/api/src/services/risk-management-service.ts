import { db } from '../db/connection';
import {
  users,
  riskAssessments,
  riskActions,
  platformReserves,
  riskCommunications,
  transactionPatterns,
  restrictedBusinessCategories,
  walletTransactions,
} from '../db/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';

// Risk level thresholds
const RISK_THRESHOLDS = {
  LOW: 30,
  MEDIUM: 60,
  HIGH: 85,
  CRITICAL: 95,
};

// Reserve percentages based on risk level
const RESERVE_PERCENTAGES = {
  low: 5, // 5% reserve
  medium: 10, // 10% reserve
  high: 20, // 20% reserve
  critical: 30, // 30% reserve
};

export interface RiskFactors {
  transactionVelocity: number; // 0-100
  transactionAmount: number; // 0-100
  accountAge: number; // 0-100
  verificationStatus: number; // 0-100
  chargebackHistory: number; // 0-100
  refundPattern: number; // 0-100
  businessCategory: number; // 0-100
  geographicRisk: number; // 0-100
}

export interface RiskAssessmentResult {
  userId: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactors;
  recommendedActions: string[];
  requiresReserve: boolean;
  reservePercentage?: number;
}

export class RiskManagementService {
  /**
   * Assess user risk based on multiple factors
   */
  async assessUserRisk(userId: string, assessmentType: string = 'periodic'): Promise<RiskAssessmentResult> {
    try {
      // Get user data
      const userRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord.length) {
        throw new Error('User not found');
      }

      const user = userRecord[0];

      // Calculate risk factors
      const factors = await this.calculateRiskFactors(userId, user);

      // Calculate overall risk score (weighted average)
      const weights = {
        transactionVelocity: 0.15,
        transactionAmount: 0.15,
        accountAge: 0.10,
        verificationStatus: 0.20,
        chargebackHistory: 0.15,
        refundPattern: 0.10,
        businessCategory: 0.10,
        geographicRisk: 0.05,
      };

      const riskScore = Math.round(
        Object.entries(factors).reduce((acc, [key, value]) => {
          return acc + value * (weights[key as keyof RiskFactors] || 0);
        }, 0)
      );

      // Determine risk level
      const riskLevel = this.getRiskLevel(riskScore);

      // Determine recommended actions
      const recommendedActions = this.getRecommendedActions(riskScore, factors);

      // Determine if reserve is required
      const requiresReserve = riskLevel !== 'low';
      const reservePercentage = requiresReserve ? RESERVE_PERCENTAGES[riskLevel] : undefined;

      // Store assessment in database
      await db.insert(riskAssessments).values({
        user_id: userId,
        assessment_type: assessmentType,
        risk_score: riskScore,
        risk_level: riskLevel,
        factors: factors as any,
        assessed_by: 'automated_system',
        notes: `Automated risk assessment. Score: ${riskScore}, Level: ${riskLevel}`,
      });

      // Update user risk fields
      await db
        .update(users)
        .set({
          risk_score: riskScore,
          risk_level: riskLevel,
        })
        .where(eq(users.id, userId));

      return {
        userId,
        riskScore,
        riskLevel,
        factors,
        recommendedActions,
        requiresReserve,
        reservePercentage,
      };
    } catch (error) {
      console.error('Error assessing user risk:', error);
      throw error;
    }
  }

  /**
   * Calculate individual risk factors
   */
  private async calculateRiskFactors(userId: string, user: any): Promise<RiskFactors> {
    // Transaction velocity risk (high frequency of transactions)
    const transactionVelocity = await this.calculateTransactionVelocityRisk(userId);

    // Transaction amount risk (unusually large transactions)
    const transactionAmount = await this.calculateTransactionAmountRisk(userId);

    // Account age risk (newer accounts are riskier)
    const accountAge = this.calculateAccountAgeRisk(user.created_at);

    // Verification status risk
    const verificationStatus = this.calculateVerificationRisk(user.verification_status, user.kyc_verified_at);

    // Chargeback history risk
    const chargebackHistory = await this.calculateChargebackRisk(userId);

    // Refund pattern risk
    const refundPattern = await this.calculateRefundPatternRisk(userId);

    // Business category risk
    const businessCategory = await this.calculateBusinessCategoryRisk(user.business_category);

    // Geographic risk (placeholder - would need location data)
    const geographicRisk = 0;

    return {
      transactionVelocity,
      transactionAmount,
      accountAge,
      verificationStatus,
      chargebackHistory,
      refundPattern,
      businessCategory,
      geographicRisk,
    };
  }

  /**
   * Calculate transaction velocity risk (0-100)
   */
  private async calculateTransactionVelocityRisk(userId: string): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Count transactions in last 24 hours
    const dailyCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.user_id, userId), gte(walletTransactions.created_at, oneDayAgo)));

    // Count transactions in last 7 days
    const weeklyCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.user_id, userId), gte(walletTransactions.created_at, oneWeekAgo)));

    const daily = dailyCount[0]?.count || 0;
    const weekly = weeklyCount[0]?.count || 0;

    // High risk if >10 transactions/day or >50/week
    if (daily > 10) return 90;
    if (daily > 5) return 70;
    if (weekly > 50) return 80;
    if (weekly > 30) return 60;
    if (weekly > 15) return 40;

    return 10;
  }

  /**
   * Calculate transaction amount risk (0-100)
   */
  private async calculateTransactionAmountRisk(userId: string): Promise<number> {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Get recent large transactions
    const recentTransactions = await db
      .select()
      .from(walletTransactions)
      .where(and(eq(walletTransactions.user_id, userId), gte(walletTransactions.created_at, oneWeekAgo)))
      .orderBy(desc(walletTransactions.amount_cents))
      .limit(10);

    if (!recentTransactions.length) return 0;

    // Calculate average transaction amount
    const avgAmount = recentTransactions.reduce((sum, t) => sum + t.amount_cents, 0) / recentTransactions.length;

    // High risk for large amounts
    if (avgAmount > 50000) return 90; // >$500 average
    if (avgAmount > 25000) return 70; // >$250 average
    if (avgAmount > 10000) return 50; // >$100 average
    if (avgAmount > 5000) return 30; // >$50 average

    return 10;
  }

  /**
   * Calculate account age risk (0-100)
   */
  private calculateAccountAgeRisk(createdAt: Date): number {
    const ageInDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);

    // Newer accounts are higher risk
    if (ageInDays < 1) return 100;
    if (ageInDays < 7) return 80;
    if (ageInDays < 30) return 60;
    if (ageInDays < 90) return 40;
    if (ageInDays < 180) return 20;

    return 0;
  }

  /**
   * Calculate verification status risk (0-100)
   */
  private calculateVerificationRisk(verificationStatus: string, kycVerifiedAt: Date | null): number {
    if (verificationStatus === 'rejected') return 100;
    if (verificationStatus === 'pending' || verificationStatus === 'under_review') return 70;
    if (verificationStatus === 'verified' && kycVerifiedAt) return 0;

    return 50; // Unknown status
  }

  /**
   * Calculate chargeback risk (0-100)
   */
  private async calculateChargebackRisk(userId: string): Promise<number> {
    // Count refund transactions (proxy for chargebacks)
    const refundCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.user_id, userId), eq(walletTransactions.type, 'refund')));

    const count = refundCount[0]?.count || 0;

    if (count > 5) return 100;
    if (count > 3) return 80;
    if (count > 1) return 50;
    if (count === 1) return 30;

    return 0;
  }

  /**
   * Calculate refund pattern risk (0-100)
   */
  private async calculateRefundPatternRisk(userId: string): Promise<number> {
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get all transactions in last 30 days
    const allTransactions = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.user_id, userId), gte(walletTransactions.created_at, oneMonthAgo)));

    const refunds = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.user_id, userId),
          eq(walletTransactions.type, 'refund'),
          gte(walletTransactions.created_at, oneMonthAgo)
        )
      );

    const total = allTransactions[0]?.count || 0;
    const refundCount = refunds[0]?.count || 0;

    if (total === 0) return 0;

    const refundRate = (refundCount / total) * 100;

    if (refundRate > 50) return 100;
    if (refundRate > 30) return 80;
    if (refundRate > 20) return 60;
    if (refundRate > 10) return 40;
    if (refundRate > 5) return 20;

    return 0;
  }

  /**
   * Calculate business category risk (0-100)
   */
  private async calculateBusinessCategoryRisk(businessCategory: string | null): Promise<number> {
    if (!businessCategory) return 30; // Unknown category has moderate risk

    // Check if category is restricted
    const restricted = await db
      .select()
      .from(restrictedBusinessCategories)
      .where(eq(restrictedBusinessCategories.category_code, businessCategory))
      .limit(1);

    if (restricted.length) {
      const category = restricted[0];
      if (category.is_prohibited) return 100;

      switch (category.risk_level) {
        case 'high':
          return 90;
        case 'medium':
          return 60;
        case 'low':
          return 30;
        default:
          return 50;
      }
    }

    return 10; // Non-restricted category
  }

  /**
   * Get risk level from score
   */
  private getRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= RISK_THRESHOLDS.CRITICAL) return 'critical';
    if (score >= RISK_THRESHOLDS.HIGH) return 'high';
    if (score >= RISK_THRESHOLDS.MEDIUM) return 'medium';
    return 'low';
  }

  /**
   * Get recommended actions based on risk assessment
   */
  private getRecommendedActions(riskScore: number, factors: RiskFactors): string[] {
    const actions: string[] = [];

    if (riskScore >= RISK_THRESHOLDS.CRITICAL) {
      actions.push('suspend_account');
      actions.push('require_manual_review');
      actions.push('hold_all_payouts');
    } else if (riskScore >= RISK_THRESHOLDS.HIGH) {
      actions.push('delay_payouts_72h');
      actions.push('require_additional_verification');
      actions.push('increase_reserve');
    } else if (riskScore >= RISK_THRESHOLDS.MEDIUM) {
      actions.push('delay_payouts_24h');
      actions.push('monitor_closely');
      actions.push('establish_reserve');
    }

    if (factors.verificationStatus > 50) {
      actions.push('require_identity_verification');
    }

    if (factors.transactionVelocity > 70) {
      actions.push('flag_high_velocity_transactions');
    }

    if (factors.chargebackHistory > 50) {
      actions.push('review_chargeback_history');
    }

    if (factors.businessCategory > 80) {
      actions.push('verify_business_category');
      actions.push('review_restricted_category_compliance');
    }

    return actions;
  }

  /**
   * Take risk mitigation action
   */
  async takeRiskAction(
    userId: string,
    actionType: string,
    reason: string,
    severity: string,
    automated: boolean = true,
    triggeredBy?: string
  ): Promise<string> {
    const actionRecord = await db
      .insert(riskActions)
      .values({
        user_id: userId,
        action_type: actionType,
        reason,
        severity,
        automated,
        triggered_by: triggeredBy,
        actioned_by: automated ? 'automated_system' : 'admin',
        metadata: {},
      })
      .returning();

    const actionId = actionRecord[0].id;

    // Apply account restrictions if needed
    if (actionType === 'restrict' || actionType === 'suspend') {
      await db
        .update(users)
        .set({
          account_restricted: true,
          restriction_reason: reason,
          restricted_at: new Date(),
        })
        .where(eq(users.id, userId));
    }

    // Send notification to user
    await this.notifyUserOfAction(userId, actionId, actionType, reason);

    return actionId;
  }

  /**
   * Establish or update platform reserve for a user
   */
  async establishReserve(
    userId: string,
    reserveType: string,
    amountCents: number,
    percentage: number | null,
    reason: string,
    releaseDays: number = 90
  ): Promise<string> {
    const releaseDate = new Date(Date.now() + releaseDays * 24 * 60 * 60 * 1000);

    const reserveRecord = await db
      .insert(platformReserves)
      .values({
        user_id: userId,
        reserve_type: reserveType,
        amount_cents: amountCents,
        percentage,
        reason,
        release_date: releaseDate,
      })
      .returning();

    return reserveRecord[0].id;
  }

  /**
   * Monitor transaction patterns for fraud detection
   */
  async monitorTransactionPattern(userId: string, transactionId: string, transactionData: any): Promise<void> {
    // Check for high velocity
    const velocityRisk = await this.calculateTransactionVelocityRisk(userId);
    if (velocityRisk > 70) {
      await db.insert(transactionPatterns).values({
        user_id: userId,
        pattern_type: 'high_velocity',
        severity: velocityRisk > 85 ? 'critical' : 'high',
        details: { transaction_id: transactionId, velocity_score: velocityRisk },
        threshold_exceeded: true,
      });

      // Auto-trigger risk action
      if (velocityRisk > 85) {
        await this.takeRiskAction(
          userId,
          'delay_payout',
          'High transaction velocity detected',
          'high',
          true,
          'high_velocity_monitor'
        );
      }
    }

    // Check for unusual amounts
    const amountRisk = await this.calculateTransactionAmountRisk(userId);
    if (amountRisk > 70) {
      await db.insert(transactionPatterns).values({
        user_id: userId,
        pattern_type: 'unusual_amount',
        severity: amountRisk > 85 ? 'high' : 'medium',
        details: { transaction_id: transactionId, amount_score: amountRisk },
        threshold_exceeded: true,
      });
    }
  }

  /**
   * Notify user of risk action taken
   */
  private async notifyUserOfAction(userId: string, actionId: string, actionType: string, reason: string): Promise<void> {
    const messages: Record<string, { subject: string; message: string }> = {
      hold: {
        subject: 'Account Hold Notice',
        message: `Your account has been temporarily held for review. Reason: ${reason}. Please contact support for assistance.`,
      },
      restrict: {
        subject: 'Account Restriction Notice',
        message: `Your account has been restricted. Reason: ${reason}. Please review our terms of service and contact support.`,
      },
      delay_payout: {
        subject: 'Payout Delay Notice',
        message: `Your payout has been delayed for review. Reason: ${reason}. This is a precautionary measure.`,
      },
      suspend: {
        subject: 'Account Suspension Notice',
        message: `Your account has been suspended. Reason: ${reason}. Please contact support immediately.`,
      },
    };

    const notification = messages[actionType] || {
      subject: 'Account Action Notice',
      message: `An action has been taken on your account. Reason: ${reason}. Please contact support.`,
    };

    await db.insert(riskCommunications).values({
      user_id: userId,
      risk_action_id: actionId,
      communication_type: 'in_app',
      subject: notification.subject,
      message: notification.message,
    });
  }

  /**
   * Check if user's business category is restricted or prohibited
   */
  async checkBusinessCategoryCompliance(businessCategory: string): Promise<{
    allowed: boolean;
    reason?: string;
    riskLevel?: string;
  }> {
    const restricted = await db
      .select()
      .from(restrictedBusinessCategories)
      .where(eq(restrictedBusinessCategories.category_code, businessCategory))
      .limit(1);

    if (!restricted.length) {
      return { allowed: true };
    }

    const category = restricted[0];

    if (category.is_prohibited) {
      return {
        allowed: false,
        reason: `Business category '${category.category_name}' is prohibited on this platform`,
        riskLevel: 'prohibited',
      };
    }

    return {
      allowed: true,
      riskLevel: category.risk_level,
    };
  }

  /**
   * Calculate total negative balance liability
   */
  async calculateTotalLiability(): Promise<{
    totalLiability: number;
    totalReserves: number;
    netExposure: number;
    userBreakdown: Array<{ userId: string; exposure: number }>;
  }> {
    // Get all active reserves
    const reserves = await db
      .select()
      .from(platformReserves)
      .where(eq(platformReserves.status, 'active'));

    const totalReserves = reserves.reduce((sum, r) => sum + r.amount_cents, 0);

    // Calculate potential liability from in-progress bounties
    // (This would need to query bounties with status 'in_progress' and sum their amounts)
    // For now, returning reserves as the main metric
    const totalLiability = totalReserves; // Simplified
    const netExposure = Math.max(0, totalLiability - totalReserves);

    return {
      totalLiability,
      totalReserves,
      netExposure,
      userBreakdown: [], // Would aggregate by user in production
    };
  }
}

export const riskManagementService = new RiskManagementService();
