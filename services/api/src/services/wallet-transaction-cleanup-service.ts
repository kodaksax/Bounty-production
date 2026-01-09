/**
 * Wallet Transaction Cleanup Service
 * 
 * Handles cleanup of orphaned wallet transactions that may occur due to:
 * - Application crashes between transaction creation and bounty creation
 * - Network failures during bounty creation
 * - Database update failures
 * 
 * This service runs periodically to identify and clean up orphaned transactions
 * where bounty_id is null after a reasonable timeout period.
 */

import { db } from '../db/connection';
import { walletTransactions } from '../db/schema';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

export class WalletTransactionCleanupService {
  /**
   * Find orphaned wallet transactions
   * Orphaned = bounty_id is null and created > TIMEOUT_MINUTES ago
   */
  async findOrphanedTransactions(timeoutMinutes: number = 60): Promise<any[]> {
    const timeoutDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    
    try {
      const orphaned = await db
        .select()
        .from(walletTransactions)
        .where(
          and(
            isNull(walletTransactions.bounty_id),
            eq(walletTransactions.type, 'bounty_posted'),
            lt(walletTransactions.created_at, timeoutDate)
          )
        );
      
      console.log(`Found ${orphaned.length} orphaned wallet transactions older than ${timeoutMinutes} minutes`);
      return orphaned;
    } catch (error) {
      console.error('Error finding orphaned transactions:', error);
      return [];
    }
  }

  /**
   * Clean up orphaned transactions
   * Removes transactions that are clearly orphaned (no associated bounty)
   */
  async cleanupOrphanedTransactions(timeoutMinutes: number = 60): Promise<number> {
    try {
      const orphaned = await this.findOrphanedTransactions(timeoutMinutes);
      
      if (orphaned.length === 0) {
        return 0;
      }

      let cleanedCount = 0;
      
      for (const transaction of orphaned) {
        try {
          // Double-check that bounty_id is still null before deleting
          await db
            .delete(walletTransactions)
            .where(
              and(
                eq(walletTransactions.id, transaction.id),
                isNull(walletTransactions.bounty_id)
              )
            );
          
          cleanedCount++;
          console.log(`Cleaned up orphaned transaction ${transaction.id} for user ${transaction.user_id}`);
        } catch (error) {
          console.error(`Failed to clean up transaction ${transaction.id}:`, error);
        }
      }
      
      console.log(`✅ Cleanup complete: Removed ${cleanedCount} orphaned transactions`);
      return cleanedCount;
    } catch (error) {
      console.error('Error during cleanup:', error);
      return 0;
    }
  }

  /**
   * Run cleanup on a schedule
   * This should be called by a cron job or scheduled task
   */
  async runScheduledCleanup(): Promise<void> {
    console.log('🧹 Starting scheduled wallet transaction cleanup...');
    
    try {
      const cleaned = await this.cleanupOrphanedTransactions(60); // 60 minute timeout
      
      if (cleaned > 0) {
        console.log(`⚠️  Cleanup recovered from ${cleaned} orphaned transactions`);
      } else {
        console.log('✅ No orphaned transactions found');
      }
    } catch (error) {
      console.error('❌ Scheduled cleanup failed:', error);
    }
  }

  /**
   * Get cleanup statistics for monitoring
   */
  async getCleanupStats(): Promise<{
    totalOrphaned: number;
    oldestOrphanedAge: number | null;
  }> {
    try {
      const orphaned = await this.findOrphanedTransactions(0); // Find all orphaned, regardless of age
      
      let oldestAge: number | null = null;
      if (orphaned.length > 0) {
        const oldestTransaction = orphaned.reduce((oldest, tx) => {
          return tx.created_at < oldest.created_at ? tx : oldest;
        });
        oldestAge = Date.now() - new Date(oldestTransaction.created_at).getTime();
      }
      
      return {
        totalOrphaned: orphaned.length,
        oldestOrphanedAge: oldestAge,
      };
    } catch (error) {
      console.error('Error getting cleanup stats:', error);
      return {
        totalOrphaned: 0,
        oldestOrphanedAge: null,
      };
    }
  }
}

export const walletTransactionCleanupService = new WalletTransactionCleanupService();
