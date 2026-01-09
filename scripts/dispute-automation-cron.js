#!/usr/bin/env node
/**
 * Automated Dispute Resolution Cron Job
 * 
 * This script should be scheduled to run daily to:
 * 1. Auto-close stale disputes (no activity for 7+ days)
 * 2. Escalate unresolved disputes (open for 14+ days)
 * 
 * Usage:
 *   node scripts/dispute-automation-cron.js
 * 
 * Cron schedule (runs daily at 2 AM):
 *   0 2 * * * cd /path/to/Bounty-production && node scripts/dispute-automation-cron.js
 */

import { disputeService } from '../lib/services/dispute-service.js';
import { logger } from '../lib/utils/error-logger.js';

async function runDisputeAutomation() {
  console.log('=== Dispute Automation Cron Job Started ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  try {
    // Step 1: Auto-close stale disputes
    console.log('\n[1/2] Checking for stale disputes to auto-close...');
    const closedCount = await disputeService.autoCloseStaleDisputes();
    console.log(`✓ Auto-closed ${closedCount} stale disputes`);
    
    // Step 2: Escalate unresolved disputes
    console.log('\n[2/2] Checking for disputes to escalate...');
    const escalatedCount = await disputeService.escalateUnresolvedDisputes();
    console.log(`✓ Escalated ${escalatedCount} unresolved disputes`);
    
    // Summary
    console.log('\n=== Dispute Automation Summary ===');
    console.log(`Auto-closed: ${closedCount}`);
    console.log(`Escalated: ${escalatedCount}`);
    console.log(`Status: SUCCESS`);
    console.log(`Completed at: ${new Date().toISOString()}`);
    
    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Dispute automation failed:', error);
    logger.error('Dispute automation cron job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    
    // Exit with error
    process.exit(1);
  }
}

// Run the automation
runDisputeAutomation();
