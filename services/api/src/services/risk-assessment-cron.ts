import cron from 'node-cron';
import { riskManagementService } from './risk-management-service';
import { db } from '../db/connection';
import { walletTransactions, users } from '../db/schema';
import { gte, sql } from 'drizzle-orm';

/**
 * Risk Assessment Cron Service
 * 
 * Runs periodic risk assessments on a schedule:
 * - Daily: Active users (transactions in last 7 days)
 * - Weekly: All users
 */
export class RiskAssessmentCronService {
  private dailyAssessmentTask: cron.ScheduledTask | null = null;
  private weeklyAssessmentTask: cron.ScheduledTask | null = null;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = process.env.ENABLE_RISK_ASSESSMENT_CRON !== 'false';
  }

  /**
   * Start all cron jobs
   */
  start() {
    if (!this.isEnabled) {
      console.log('⏭️  Risk assessment cron jobs disabled (ENABLE_RISK_ASSESSMENT_CRON=false)');
      return;
    }

    console.log('🕐 Starting risk assessment cron jobs...');

    // Daily assessment at 2 AM UTC (or custom schedule)
    const dailySchedule = process.env.DAILY_ASSESSMENT_CRON || '0 2 * * *';
    this.dailyAssessmentTask = cron.schedule(dailySchedule, async () => {
      console.log('🔍 Running daily risk assessments...');
      await this.runDailyAssessments();
    });

    // Weekly assessment on Mondays at 3 AM UTC (or custom schedule)
    const weeklySchedule = process.env.WEEKLY_ASSESSMENT_CRON || '0 3 * * 1';
    this.weeklyAssessmentTask = cron.schedule(weeklySchedule, async () => {
      console.log('🔍 Running weekly risk assessments...');
      await this.runWeeklyAssessments();
    });

    console.log('✅ Risk assessment cron jobs started');
    console.log(`   - Daily assessments: ${dailySchedule}`);
    console.log(`   - Weekly assessments: ${weeklySchedule}`);
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    console.log('🛑 Stopping risk assessment cron jobs...');
    
    if (this.dailyAssessmentTask) {
      this.dailyAssessmentTask.stop();
      this.dailyAssessmentTask = null;
    }

    if (this.weeklyAssessmentTask) {
      this.weeklyAssessmentTask.stop();
      this.weeklyAssessmentTask = null;
    }

    console.log('✅ Risk assessment cron jobs stopped');
  }

  /**
   * Run daily assessments for active users
   * Active = users with transactions in last 7 days
   */
  private async runDailyAssessments() {
    const startTime = Date.now();
    
    try {
      // Get users with transactions in last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const activeUsers = await db
        .selectDistinct({ user_id: walletTransactions.user_id })
        .from(walletTransactions)
        .where(gte(walletTransactions.created_at, sevenDaysAgo));

      console.log(`📊 Found ${activeUsers.length} active users for daily assessment`);

      let assessed = 0;
      let errors = 0;

      // Process users sequentially to avoid overload
      for (const user of activeUsers) {
        try {
          await riskManagementService.assessUserRisk(user.user_id, 'periodic');
          assessed++;
          
          // Log progress every 10 users
          if (assessed % 10 === 0) {
            console.log(`   Progress: ${assessed}/${activeUsers.length} users assessed`);
          }
        } catch (error) {
          console.error(`❌ Error assessing user ${user.user_id}:`, error);
          errors++;
        }
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Daily assessment complete: ${assessed} assessed, ${errors} errors (${Math.round(duration / 1000)}s)`);
    } catch (error) {
      console.error('❌ Error running daily assessments:', error);
    }
  }

  /**
   * Run weekly assessments for all users
   * Processes in batches to avoid system overload
   */
  private async runWeeklyAssessments() {
    const startTime = Date.now();
    
    try {
      // Get all non-deleted users
      const allUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.deleted_at} IS NULL`);

      console.log(`📊 Found ${allUsers.length} users for weekly assessment`);

      let assessed = 0;
      let errors = 0;

      // Process in batches to avoid overwhelming the system
      const batchSize = 50;
      for (let i = 0; i < allUsers.length; i += batchSize) {
        const batch = allUsers.slice(i, i + batchSize);
        
        console.log(`   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allUsers.length / batchSize)}`);
        
        // Process batch in parallel
        const results = await Promise.allSettled(
          batch.map(async (user) => {
            try {
              await riskManagementService.assessUserRisk(user.id, 'periodic');
              return { success: true };
            } catch (error) {
              console.error(`❌ Error assessing user ${user.id}:`, error);
              return { success: false };
            }
          })
        );

        // Count results
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value.success) {
            assessed++;
          } else {
            errors++;
          }
        });

        // Small delay between batches to be gentle on the system
        if (i + batchSize < allUsers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Weekly assessment complete: ${assessed} assessed, ${errors} errors (${Math.round(duration / 1000)}s)`);
    } catch (error) {
      console.error('❌ Error running weekly assessments:', error);
    }
  }

  /**
   * Run assessment for a specific user (manual trigger)
   * Can be called via API or admin tools
   */
  async assessUser(userId: string) {
    console.log(`🔍 Running manual assessment for user ${userId}`);
    try {
      const result = await riskManagementService.assessUserRisk(userId, 'manual');
      console.log(`✅ Assessment complete for user ${userId}: ${result.riskLevel} (score: ${result.riskScore})`);
      return result;
    } catch (error) {
      console.error(`❌ Error assessing user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get cron job status
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      dailyRunning: this.dailyAssessmentTask !== null,
      weeklyRunning: this.weeklyAssessmentTask !== null,
    };
  }
}

// Export singleton instance
export const riskAssessmentCron = new RiskAssessmentCronService();
