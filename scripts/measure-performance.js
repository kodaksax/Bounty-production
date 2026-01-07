#!/usr/bin/env node
/**
 * Performance Measurement Script
 * 
 * This script measures query performance before and after index creation.
 * It runs a series of benchmark queries and compares the results.
 * 
 * Usage:
 *   npm run measure:performance -- --output before.json  # Before migration
 *   npm run db:migrate                                   # Run migration
 *   npm run measure:performance -- --output after.json   # After migration
 *   npm run measure:performance -- --compare before.json after.json  # Compare
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bountyexpo:bountyexpo123@localhost:5432/bountyexpo'
});

/**
 * Benchmark queries with descriptions
 */
const benchmarkQueries = [
  {
    id: 'notifications_by_user',
    description: 'Get user notifications ordered by time',
    query: 'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    params: ['00000000-0000-0000-0000-000000000001'],
  },
  {
    id: 'unread_notifications_count',
    description: 'Count unread notifications',
    query: 'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false',
    params: ['00000000-0000-0000-0000-000000000001'],
  },
  {
    id: 'bounties_by_status',
    description: 'Get open bounties ordered by time',
    query: 'SELECT * FROM bounties WHERE status = $1 ORDER BY created_at DESC LIMIT 20',
    params: ['open'],
  },
  {
    id: 'user_bounties_by_status',
    description: 'Get user bounties filtered by status',
    query: 'SELECT * FROM bounties WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC',
    params: ['00000000-0000-0000-0000-000000000001', 'open'],
  },
  {
    id: 'wallet_transactions',
    description: 'Get user wallet transaction history',
    query: 'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    params: ['00000000-0000-0000-0000-000000000001'],
  },
  {
    id: 'conversation_messages',
    description: 'Get messages in conversation',
    query: 'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50',
    params: ['00000000-0000-0000-0000-000000000001'],
  },
  {
    id: 'user_conversations',
    description: 'Get user conversations with participants',
    query: `
      SELECT c.* FROM conversations c
      INNER JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE cp.user_id = $1 AND cp.deleted_at IS NULL
      ORDER BY c.updated_at DESC
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
  },
  {
    id: 'pending_outbox_events',
    description: 'Get pending outbox events for processing',
    query: 'SELECT * FROM outbox_events WHERE status = $1 ORDER BY created_at ASC LIMIT 100',
    params: ['pending'],
  },
  {
    id: 'bounty_requests_by_status',
    description: 'Get bounty requests filtered by status',
    query: 'SELECT * FROM bounty_requests WHERE bounty_id = $1 AND status = $2',
    params: ['00000000-0000-0000-0000-000000000001', 'pending'],
  },
  {
    id: 'risk_assessments',
    description: 'Get user risk assessments',
    query: 'SELECT * FROM risk_assessments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
    params: ['00000000-0000-0000-0000-000000000001'],
  },
];

/**
 * Run a single query multiple times and return average metrics
 */
async function benchmarkQuery(client, query, params, iterations = 10) {
  const timings = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    
    try {
      await client.query(query, params);
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      timings.push(durationMs);
    } catch (error) {
      // Query might fail if table/data doesn't exist yet - that's ok
      console.warn(`Query failed: ${error.message}`);
      return null;
    }
  }
  
  if (timings.length === 0) return null;
  
  timings.sort((a, b) => a - b);
  const sum = timings.reduce((a, b) => a + b, 0);
  
  return {
    min: timings[0],
    max: timings[timings.length - 1],
    avg: sum / timings.length,
    median: timings[Math.floor(timings.length / 2)],
    p95: timings[Math.floor(timings.length * 0.95)],
    p99: timings[Math.floor(timings.length * 0.99)],
    iterations: timings.length,
  };
}

/**
 * Run EXPLAIN ANALYZE and get query plan details
 */
async function getQueryPlan(client, query, params) {
  try {
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, params);
    const plan = result.rows[0]['QUERY PLAN'][0];
    
    let hasSeqScan = false;
    let hasIndexScan = false;
    
    function checkPlan(node) {
      if (node['Node Type']) {
        if (node['Node Type'].includes('Seq Scan')) hasSeqScan = true;
        if (node['Node Type'].includes('Index Scan') || node['Node Type'].includes('Index Only Scan')) hasIndexScan = true;
      }
      if (node.Plans) node.Plans.forEach(checkPlan);
    }
    
    checkPlan(plan.Plan);
    
    return {
      executionTime: plan['Execution Time'],
      planningTime: plan['Planning Time'],
      hasSeqScan,
      hasIndexScan,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Run full benchmark suite
 */
async function runBenchmark() {
  const client = await pool.connect();
  const results = {
    timestamp: new Date().toISOString(),
    queries: {},
  };
  
  try {
    console.log('🏃 Running performance benchmarks...\n');
    
    for (const bench of benchmarkQueries) {
      process.stdout.write(`  Testing ${bench.id}... `);
      
      // Get query plan
      const plan = await getQueryPlan(client, bench.query, bench.params);
      
      // Run benchmark
      const metrics = await benchmarkQuery(client, bench.query, bench.params);
      
      if (metrics && plan) {
        results.queries[bench.id] = {
          description: bench.description,
          metrics,
          plan,
        };
        console.log(`✅ avg: ${metrics.avg.toFixed(2)}ms`);
      } else {
        console.log('⏭️  skipped (table not ready)');
      }
    }
    
    console.log('\n✅ Benchmark complete!\n');
    
  } finally {
    client.release();
  }
  
  return results;
}

/**
 * Compare two benchmark results
 */
function compareBenchmarks(before, after) {
  console.log('\n📊 PERFORMANCE COMPARISON');
  console.log('='.repeat(100));
  console.log(`Before: ${before.timestamp}`);
  console.log(`After:  ${after.timestamp}`);
  console.log('='.repeat(100));
  console.log();
  
  const improvements = [];
  const regressions = [];
  
  for (const queryId in before.queries) {
    if (!after.queries[queryId]) continue;
    
    const beforeData = before.queries[queryId];
    const afterData = after.queries[queryId];
    
    const beforeAvg = beforeData.metrics.avg;
    const afterAvg = afterData.metrics.avg;
    const improvement = ((beforeAvg - afterAvg) / beforeAvg) * 100;
    
    const beforeSeqScan = beforeData.plan.hasSeqScan;
    const afterSeqScan = afterData.plan.hasSeqScan;
    
    console.log(`${queryId}`);
    console.log(`  ${beforeData.description}`);
    console.log(`  Before: ${beforeAvg.toFixed(2)}ms (avg) | ${beforeData.metrics.p95.toFixed(2)}ms (p95)`);
    console.log(`  After:  ${afterAvg.toFixed(2)}ms (avg) | ${afterData.metrics.p95.toFixed(2)}ms (p95)`);
    console.log(`  Change: ${improvement > 0 ? '🚀' : '⚠️'} ${improvement.toFixed(1)}%`);
    
    if (beforeSeqScan && !afterSeqScan) {
      console.log(`  Index: ✅ Sequential scan eliminated!`);
    } else if (!beforeSeqScan && afterSeqScan) {
      console.log(`  Index: ⚠️ Sequential scan introduced!`);
    }
    
    console.log();
    
    if (improvement > 0) {
      improvements.push({ queryId, improvement, beforeAvg, afterAvg });
    } else if (improvement < -5) { // Flag regressions > 5%
      regressions.push({ queryId, improvement, beforeAvg, afterAvg });
    }
  }
  
  // Summary
  console.log('='.repeat(100));
  console.log('📈 SUMMARY');
  console.log('='.repeat(100));
  
  if (improvements.length > 0) {
    console.log(`\n✅ Improvements (${improvements.length} queries):`);
    improvements.sort((a, b) => b.improvement - a.improvement);
    improvements.forEach((imp, i) => {
      console.log(`  ${i + 1}. ${imp.queryId}: ${imp.improvement.toFixed(1)}% faster (${imp.beforeAvg.toFixed(2)}ms → ${imp.afterAvg.toFixed(2)}ms)`);
    });
    
    const avgImprovement = improvements.reduce((sum, imp) => sum + imp.improvement, 0) / improvements.length;
    console.log(`\n  Average improvement: ${avgImprovement.toFixed(1)}%`);
  }
  
  if (regressions.length > 0) {
    console.log(`\n⚠️  Regressions (${regressions.length} queries):`);
    regressions.sort((a, b) => a.improvement - b.improvement);
    regressions.forEach((reg, i) => {
      console.log(`  ${i + 1}. ${reg.queryId}: ${Math.abs(reg.improvement).toFixed(1)}% slower (${reg.beforeAvg.toFixed(2)}ms → ${reg.afterAvg.toFixed(2)}ms)`);
    });
  }
  
  if (improvements.length === 0 && regressions.length === 0) {
    console.log('\n📊 No significant performance changes detected');
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let outputFile = null;
  let compareFiles = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--compare' && args[i + 1] && args[i + 2]) {
      compareFiles = [args[i + 1], args[i + 2]];
      i += 2;
    }
  }
  
  try {
    if (compareFiles.length === 2) {
      // Compare mode
      const before = JSON.parse(fs.readFileSync(compareFiles[0], 'utf8'));
      const after = JSON.parse(fs.readFileSync(compareFiles[1], 'utf8'));
      compareBenchmarks(before, after);
    } else {
      // Benchmark mode
      const results = await runBenchmark();
      
      if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
        console.log(`📝 Results saved to ${outputFile}`);
      } else {
        console.log('💡 Tip: Use --output filename.json to save results for comparison');
      }
      
      // Display summary
      console.log('\n📊 Performance Summary:');
      console.log('-'.repeat(80));
      const queryTimes = Object.entries(results.queries).map(([id, data]) => ({
        id,
        avg: data.metrics.avg,
        p95: data.metrics.p95,
      }));
      queryTimes.sort((a, b) => b.avg - a.avg);
      
      console.log('Slowest queries (by average time):');
      queryTimes.slice(0, 5).forEach((q, i) => {
        console.log(`  ${i + 1}. ${q.id}: ${q.avg.toFixed(2)}ms avg, ${q.p95.toFixed(2)}ms p95`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
