import * as cron from 'node-cron';
import { walletTransactionCleanupService } from './wallet-transaction-cleanup-service';

/**
 * Wallet Cleanup Cron Service
 * 
 * Runs periodic cleanup of orphaned wallet transactions:
 * - Hourly: Check for and clean up transactions older than 60 minutes
 * 
 * Orphaned transactions can occur when:
 * - App crashes between wallet transaction and bounty creation
 * - Network failures during bounty creation
 * - Database update failures
 */
export class WalletCleanupCronService {
  private cleanupTask: cron.ScheduledTask | null = null;
  private isEnabled: boolean;

  constructor() {
    // Enable by default, can be disabled with env var
    this.isEnabled = process.env.ENABLE_WALLET_CLEANUP_CRON !== 'false';
  }

  /**
   * Start the cleanup cron job
   */
  start() {
    if (!this.isEnabled) {
      console.log('⏭️  Wallet cleanup cron disabled (ENABLE_WALLET_CLEANUP_CRON=false)');
      return;
    }

    console.log('🕐 Starting wallet cleanup cron job...');

    // Hourly cleanup at minute 15 (or custom schedule)
    // Default: Every hour at :15 (e.g., 1:15, 2:15, 3:15)
    const cleanupSchedule = process.env.WALLET_CLEANUP_CRON || '15 * * * *';
    
    this.cleanupTask = cron.schedule(cleanupSchedule, async () => {
      await walletTransactionCleanupService.runScheduledCleanup();
    });

    console.log(`✅ Wallet cleanup cron started (schedule: ${cleanupSchedule})`);
  }

  /**
   * Stop the cleanup cron job
   */
  stop() {
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      console.log('🛑 Wallet cleanup cron stopped');
    }
  }

  /**
   * Check if the service is running
   */
  isRunning(): boolean {
    return this.cleanupTask !== null;
  }
}

export const walletCleanupCron = new WalletCleanupCronService();
