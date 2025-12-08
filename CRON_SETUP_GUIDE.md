# Periodic Risk Assessment Cron Setup Guide

This guide shows you how to configure periodic risk assessments to run automatically at scheduled intervals.

## Overview

Periodic risk assessments should run:
- **Daily**: For all active users (users with transactions in last 7 days)
- **Weekly**: For all users with open bounties
- **On-demand**: Via API for specific users

## Option 1: Using Node-Cron (Recommended for Development)

### Step 1: Install node-cron

```bash
cd services/api
npm install node-cron
npm install --save-dev @types/node-cron
```

### Step 2: Create Cron Service

Create `services/api/src/services/risk-assessment-cron.ts`:

```typescript
import cron from 'node-cron';
import { riskManagementService } from './risk-management-service';
import { db } from '../db/connection';
import { walletTransactions, users } from '../db/schema';
import { eq, gte, sql } from 'drizzle-orm';

export class RiskAssessmentCronService {
  private dailyAssessmentTask: cron.ScheduledTask | null = null;
  private weeklyAssessmentTask: cron.ScheduledTask | null = null;

  /**
   * Start all cron jobs
   */
  start() {
    console.log('🕐 Starting risk assessment cron jobs...');

    // Daily assessment at 2 AM UTC
    this.dailyAssessmentTask = cron.schedule('0 2 * * *', async () => {
      console.log('🔍 Running daily risk assessments...');
      await this.runDailyAssessments();
    });

    // Weekly assessment on Mondays at 3 AM UTC
    this.weeklyAssessmentTask = cron.schedule('0 3 * * 1', async () => {
      console.log('🔍 Running weekly risk assessments...');
      await this.runWeeklyAssessments();
    });

    console.log('✅ Risk assessment cron jobs started');
    console.log('   - Daily assessments: 2 AM UTC');
    console.log('   - Weekly assessments: Mondays at 3 AM UTC');
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
   */
  private async runDailyAssessments() {
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

      for (const user of activeUsers) {
        try {
          await riskManagementService.assessUserRisk(user.user_id, 'periodic');
          assessed++;
        } catch (error) {
          console.error(`❌ Error assessing user ${user.user_id}:`, error);
          errors++;
        }
      }

      console.log(`✅ Daily assessment complete: ${assessed} assessed, ${errors} errors`);
    } catch (error) {
      console.error('❌ Error running daily assessments:', error);
    }
  }

  /**
   * Run weekly assessments for all users
   */
  private async runWeeklyAssessments() {
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
        
        await Promise.allSettled(
          batch.map(async (user) => {
            try {
              await riskManagementService.assessUserRisk(user.id, 'periodic');
              assessed++;
            } catch (error) {
              console.error(`❌ Error assessing user ${user.id}:`, error);
              errors++;
            }
          })
        );

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`✅ Weekly assessment complete: ${assessed} assessed, ${errors} errors`);
    } catch (error) {
      console.error('❌ Error running weekly assessments:', error);
    }
  }

  /**
   * Run assessment for a specific user (manual trigger)
   */
  async assessUser(userId: string) {
    console.log(`🔍 Running manual assessment for user ${userId}`);
    return await riskManagementService.assessUserRisk(userId, 'manual');
  }
}

export const riskAssessmentCron = new RiskAssessmentCronService();
```

### Step 3: Register Cron in Server

Edit `services/api/src/index.ts` to start the cron jobs:

```typescript
// Add import at the top
import { riskAssessmentCron } from './services/risk-assessment-cron';

// In the start() function, after starting the server:
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';

    // ... existing server startup code ...

    await fastify.listen({ port, host });
    console.log(`🚀 BountyExpo API server listening on ${host}:${port}`);
    
    // Start risk assessment cron jobs
    riskAssessmentCron.start();
    
    // ... rest of startup code ...
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Update graceful shutdown to stop cron
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop cron jobs
  riskAssessmentCron.stop();
  
  // Stop the outbox worker
  outboxWorker.stop();
  
  // Flush analytics events
  await backendAnalytics.flush();
  
  await fastify.close();
  process.exit(0);
});
```

## Option 2: Using GitHub Actions (Recommended for Production)

Create `.github/workflows/risk-assessment-cron.yml`:

```yaml
name: Periodic Risk Assessment

on:
  schedule:
    # Daily at 2 AM UTC
    - cron: '0 2 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  assess-risk:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Risk Assessment
        run: |
          curl -X POST ${{ secrets.API_URL }}/api/risk/assess-batch \
            -H "Authorization: Bearer ${{ secrets.CRON_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"assessmentType": "periodic"}'
```

Then add a batch assessment endpoint in `services/api/src/routes/risk-management.ts`:

```typescript
/**
 * Batch assess all active users (for cron jobs)
 */
fastify.post('/api/risk/assess-batch', async (request, reply) => {
  try {
    // Verify cron API key
    const apiKey = request.headers.authorization?.replace('Bearer ', '');
    if (apiKey !== process.env.CRON_API_KEY) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { assessmentType = 'periodic' } = request.body as { assessmentType?: string };

    // Get active users from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeUsers = await db
      .selectDistinct({ user_id: walletTransactions.user_id })
      .from(walletTransactions)
      .where(gte(walletTransactions.created_at, sevenDaysAgo));

    const results = {
      total: activeUsers.length,
      assessed: 0,
      errors: 0,
    };

    for (const user of activeUsers) {
      try {
        await riskManagementService.assessUserRisk(user.user_id, assessmentType);
        results.assessed++;
      } catch (error) {
        console.error(`Error assessing user ${user.user_id}:`, error);
        results.errors++;
      }
    }

    return reply.code(200).send({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Error in batch assessment:', error);
    return reply.code(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run batch assessment',
    });
  }
});
```

## Option 3: Using Supabase Cron (Production on Supabase)

If using Supabase, create a database function and use pg_cron:

```sql
-- Create function to run assessments
CREATE OR REPLACE FUNCTION run_periodic_risk_assessments()
RETURNS void AS $$
DECLARE
  user_record RECORD;
  assessment_count INTEGER := 0;
BEGIN
  -- Loop through active users
  FOR user_record IN 
    SELECT DISTINCT user_id 
    FROM wallet_transactions 
    WHERE created_at >= NOW() - INTERVAL '7 days'
  LOOP
    -- Call your API endpoint or insert into a queue table
    PERFORM pg_notify('risk_assessment', user_record.user_id::text);
    assessment_count := assessment_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Queued % users for risk assessment', assessment_count;
END;
$$ LANGUAGE plpgsql;

-- Schedule to run daily at 2 AM UTC
SELECT cron.schedule(
  'daily-risk-assessment',
  '0 2 * * *',
  $$SELECT run_periodic_risk_assessments()$$
);
```

## Testing the Cron

### Test Manual Trigger

```bash
# Trigger manual assessment for a user
curl -X POST http://localhost:3001/api/risk/assess/[user-id] \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"assessmentType": "manual"}'
```

### Test Batch Assessment

```bash
# Trigger batch assessment (simulate cron)
curl -X POST http://localhost:3001/api/risk/assess-batch \
  -H "Authorization: Bearer <cron-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"assessmentType": "periodic"}'
```

### Monitor Cron Execution

Check logs for cron execution:

```bash
# In production
tail -f /var/log/api-server.log | grep "risk assessment"

# In development
# Watch the console output for cron job messages
```

## Cron Schedule Reference

Common cron expressions:

```
0 2 * * *        # Daily at 2 AM UTC
0 3 * * 1        # Every Monday at 3 AM UTC
0 */6 * * *      # Every 6 hours
*/30 * * * *     # Every 30 minutes
0 0 1 * *        # First day of every month at midnight
```

## Environment Variables

Add to `.env`:

```bash
# Cron API key for batch operations
CRON_API_KEY=your-secure-random-key-here

# Enable/disable cron jobs
ENABLE_RISK_ASSESSMENT_CRON=true

# Cron schedule (optional, overrides defaults)
DAILY_ASSESSMENT_CRON="0 2 * * *"
WEEKLY_ASSESSMENT_CRON="0 3 * * 1"
```

## Monitoring & Alerts

Set up monitoring for cron jobs:

1. **Log Aggregation**: Send cron logs to monitoring service
2. **Metrics**: Track number of assessments, errors, duration
3. **Alerts**: Alert if cron fails or error rate is high
4. **Dashboard**: Visualize cron execution over time

Example monitoring:

```typescript
// In the cron service
import { backendAnalytics } from './analytics';

private async runDailyAssessments() {
  const startTime = Date.now();
  let assessed = 0;
  let errors = 0;

  try {
    // ... assessment logic ...
    
    // Track metrics
    backendAnalytics.track({
      event: 'risk_assessment_cron_completed',
      properties: {
        type: 'daily',
        assessed,
        errors,
        duration_ms: Date.now() - startTime,
      },
    });
  } catch (error) {
    // Alert on failure
    backendAnalytics.track({
      event: 'risk_assessment_cron_failed',
      properties: {
        type: 'daily',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}
```

## Troubleshooting

### Cron not running
- Check server logs for startup messages
- Verify cron service was started in index.ts
- Check timezone settings (cron uses UTC by default)

### High error rate
- Check database connectivity
- Verify risk service is working
- Look for specific user errors in logs

### Performance issues
- Reduce batch size in weekly assessments
- Increase delay between batches
- Consider running assessments during off-peak hours

## Next Steps

1. Choose your cron implementation (node-cron for simple, GitHub Actions for production)
2. Create the cron service file
3. Register it in your server startup
4. Test with manual triggers
5. Monitor execution and errors
6. Set up alerts for failures

For questions, see `RISK_MANAGEMENT_QUICKSTART.md` for more details on the risk assessment system.
