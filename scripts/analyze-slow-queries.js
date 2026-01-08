#!/usr/bin/env node
/**
 * Slow Query Analysis Script
 * 
 * This script analyzes database queries and identifies potential slow queries
 * by examining query patterns in the codebase and running EXPLAIN ANALYZE
 * on common query patterns.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Error: DATABASE_URL environment variable is not set. Please set DATABASE_URL before running analyze-slow-queries.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
});

/**
 * Common query patterns used in the application
 */
const queryPatterns = [
  {
    name: 'Get user notifications ordered by created_at',
    query: `
      SELECT * FROM notifications 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_notifications_user_id_created_at',
  },
  {
    name: 'Get unread notifications count',
    query: `
      SELECT COUNT(*) FROM notifications 
      WHERE user_id = $1 AND read = false
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_notifications_user_id_read',
  },
  {
    name: 'Get user conversations with messages',
    query: `
      SELECT c.* FROM conversations c
      INNER JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE cp.user_id = $1 AND cp.deleted_at IS NULL
      ORDER BY c.updated_at DESC
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_conversation_participants_user_id_deleted_at',
  },
  {
    name: 'Get messages for conversation ordered by time',
    query: `
      SELECT * FROM messages 
      WHERE conversation_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_messages_conversation_id_created_at (already exists)',
  },
  {
    name: 'Get bounties by status and created date',
    query: `
      SELECT * FROM bounties 
      WHERE status = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `,
    params: ['open'],
    expectedIndex: 'idx_bounties_status_created_at',
  },
  {
    name: 'Get bounties by user and status',
    query: `
      SELECT * FROM bounties 
      WHERE user_id = $1 AND status = $2
      ORDER BY created_at DESC
    `,
    params: ['00000000-0000-0000-0000-000000000001', 'open'],
    expectedIndex: 'idx_bounties_user_id_status',
  },
  {
    name: 'Get wallet transactions by user ordered by time',
    query: `
      SELECT * FROM wallet_transactions 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_wallet_transactions_user_id_created_at',
  },
  {
    name: 'Get wallet transactions by bounty',
    query: `
      SELECT * FROM wallet_transactions 
      WHERE bounty_id = $1 
      ORDER BY created_at DESC
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_wallet_transactions_bounty_id',
  },
  {
    name: 'Get bounty requests by status',
    query: `
      SELECT * FROM bounty_requests 
      WHERE bounty_id = $1 AND status = $2
    `,
    params: ['00000000-0000-0000-0000-000000000001', 'pending'],
    expectedIndex: 'idx_bounty_requests_bounty_id_status',
  },
  {
    name: 'Get outbox events pending processing',
    query: `
      SELECT * FROM outbox_events 
      WHERE status = $1 
      ORDER BY created_at ASC 
      LIMIT 100
    `,
    params: ['pending'],
    expectedIndex: 'idx_outbox_events_status_created_at',
  },
  {
    name: 'Get risk assessments by user',
    query: `
      SELECT * FROM risk_assessments 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 10
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_risk_assessments_user_id_created_at',
  },
  {
    name: 'Get active risk actions',
    query: `
      SELECT * FROM risk_actions 
      WHERE user_id = $1 AND status = $2
    `,
    params: ['00000000-0000-0000-0000-000000000001', 'active'],
    expectedIndex: 'idx_risk_actions_user_id_status',
  },
  {
    name: 'Get push tokens by user',
    query: `
      SELECT * FROM push_tokens 
      WHERE user_id = $1 
      ORDER BY updated_at DESC
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_push_tokens_user_id',
  },
  {
    name: 'Get conversation participants not deleted',
    query: `
      SELECT * FROM conversation_participants 
      WHERE conversation_id = $1 AND deleted_at IS NULL
    `,
    params: ['00000000-0000-0000-0000-000000000001'],
    expectedIndex: 'idx_conversation_participants_conversation_id_deleted_at',
  },
  {
    name: 'Get messages by status for delivery tracking',
    query: `
      SELECT * FROM messages 
      WHERE conversation_id = $1 AND status = $2
    `,
    params: ['00000000-0000-0000-0000-000000000001', 'sent'],
    expectedIndex: 'idx_messages_conversation_id_status',
  },
];

/**
 * Run EXPLAIN ANALYZE on a query and return the execution plan
 */
async function analyzeQuery(client, query, params) {
  try {
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
    const result = await client.query(explainQuery, params);
    return result.rows[0]['QUERY PLAN'][0];
  } catch (error) {
    console.error(`Error analyzing query: ${error.message}`);
    return null;
  }
}

/**
 * Extract key metrics from query plan
 */
function extractMetrics(plan) {
  const execution = plan['Execution Time'] || 0;
  const planning = plan['Planning Time'] || 0;
  const totalTime = execution + planning;
  
  let seqScans = 0;
  let indexScans = 0;
  let bufferHits = 0;
  let bufferReads = 0;
  
  function traversePlan(node) {
    if (node['Node Type']) {
      if (node['Node Type'].includes('Seq Scan')) {
        seqScans++;
      }
      if (node['Node Type'].includes('Index Scan') || node['Node Type'].includes('Index Only Scan')) {
        indexScans++;
      }
    }
    
    if (node['Shared Hit Blocks']) bufferHits += node['Shared Hit Blocks'];
    if (node['Shared Read Blocks']) bufferReads += node['Shared Read Blocks'];
    
    if (node.Plans) {
      node.Plans.forEach(traversePlan);
    }
  }
  
  traversePlan(plan.Plan);
  
  return {
    totalTime: totalTime.toFixed(2),
    executionTime: execution.toFixed(2),
    planningTime: planning.toFixed(2),
    seqScans,
    indexScans,
    bufferHits,
    bufferReads,
    cacheHitRatio: bufferHits + bufferReads > 0 
      ? ((bufferHits / (bufferHits + bufferReads)) * 100).toFixed(2) 
      : 'N/A',
  };
}

/**
 * Check if recommended index exists
 */
async function checkIndexExists(client, indexName) {
  const query = `
    SELECT indexname 
    FROM pg_indexes 
    WHERE indexname = $1
  `;
  const result = await client.query(query, [indexName]);
  return result.rows.length > 0;
}

/**
 * Get current database statistics
 */
async function getDatabaseStats(client) {
  const stats = {};
  
  // Table sizes
  const tableSizes = await client.query(`
    SELECT 
      schemaname,
      tablename,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
      pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY size_bytes DESC
    LIMIT 10
  `);
  stats.tableSizes = tableSizes.rows;
  
  // Index usage
  const indexUsage = await client.query(`
    SELECT 
      schemaname,
      tablename,
      indexname,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch
    FROM pg_stat_user_indexes
    ORDER BY idx_scan DESC
    LIMIT 20
  `);
  stats.indexUsage = indexUsage.rows;
  
  // Missing indexes (tables with seq scans)
  const missingIndexes = await client.query(`
    SELECT 
      schemaname,
      tablename,
      seq_scan,
      seq_tup_read,
      idx_scan,
      ROUND(100.0 * seq_scan / NULLIF(seq_scan + idx_scan, 0), 2) AS seq_scan_pct
    FROM pg_stat_user_tables
    WHERE seq_scan > 0
    ORDER BY seq_tup_read DESC
    LIMIT 10
  `);
  stats.missingIndexes = missingIndexes.rows;
  
  return stats;
}

/**
 * Main analysis function
 */
async function runAnalysis() {
  const client = await pool.connect();
  
  try {
    console.log('='.repeat(80));
    console.log('DATABASE SLOW QUERY ANALYSIS');
    console.log('='.repeat(80));
    console.log();
    
    // Get database stats
    console.log('📊 Database Statistics');
    console.log('-'.repeat(80));
    const stats = await getDatabaseStats(client);
    
    console.log('\n📦 Top 10 Largest Tables:');
    stats.tableSizes.forEach((table, i) => {
      console.log(`  ${i + 1}. ${table.tablename}: ${table.size}`);
    });
    
    console.log('\n🔍 Top 20 Most Used Indexes:');
    stats.indexUsage.slice(0, 10).forEach((idx, i) => {
      console.log(`  ${i + 1}. ${idx.indexname}: ${idx.idx_scan} scans, ${idx.idx_tup_read} tuples read`);
    });
    
    console.log('\n⚠️  Tables with High Sequential Scan Ratio:');
    stats.missingIndexes.forEach((table, i) => {
      console.log(`  ${i + 1}. ${table.tablename}: ${table.seq_scan_pct}% seq scans (${table.seq_scan} scans, ${table.seq_tup_read} tuples)`);
    });
    
    // Analyze query patterns
    console.log('\n\n🔬 Query Pattern Analysis');
    console.log('='.repeat(80));
    
    const slowQueries = [];
    const missingIndexes = [];
    
    for (const pattern of queryPatterns) {
      console.log(`\n${pattern.name}`);
      console.log('-'.repeat(80));
      
      const plan = await analyzeQuery(client, pattern.query, pattern.params);
      
      if (plan) {
        const metrics = extractMetrics(plan);
        
        console.log(`  Total Time: ${metrics.totalTime} ms`);
        console.log(`  Execution Time: ${metrics.executionTime} ms`);
        console.log(`  Planning Time: ${metrics.planningTime} ms`);
        console.log(`  Sequential Scans: ${metrics.seqScans}`);
        console.log(`  Index Scans: ${metrics.indexScans}`);
        console.log(`  Cache Hit Ratio: ${metrics.cacheHitRatio}%`);
        
        // Check if index exists
        const indexExists = await checkIndexExists(client, pattern.expectedIndex);
        console.log(`  Expected Index: ${pattern.expectedIndex} - ${indexExists ? '✅ EXISTS' : '❌ MISSING'}`);
        
        if (!indexExists) {
          missingIndexes.push({
            name: pattern.name,
            index: pattern.expectedIndex,
            metrics,
          });
        }
        
        // Flag slow queries (> 10ms)
        if (parseFloat(metrics.executionTime) > 10 || metrics.seqScans > 0) {
          slowQueries.push({
            name: pattern.name,
            metrics,
            indexExists,
            expectedIndex: pattern.expectedIndex,
          });
        }
      }
    }
    
    // Summary
    console.log('\n\n📋 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total queries analyzed: ${queryPatterns.length}`);
    console.log(`Slow queries identified (>10ms or seq scans): ${slowQueries.length}`);
    console.log(`Missing recommended indexes: ${missingIndexes.length}`);
    
    if (slowQueries.length > 0) {
      console.log('\n⚠️  Slow Queries Detected:');
      slowQueries.forEach((q, i) => {
        console.log(`  ${i + 1}. ${q.name}`);
        console.log(`     Time: ${q.metrics.executionTime}ms, Seq Scans: ${q.metrics.seqScans}`);
        console.log(`     Index Status: ${q.indexExists ? 'EXISTS' : 'MISSING'} (${q.expectedIndex})`);
      });
    }
    
    if (missingIndexes.length > 0) {
      console.log('\n❌ Missing Indexes:');
      missingIndexes.forEach((idx, i) => {
        console.log(`  ${i + 1}. ${idx.index}`);
        console.log(`     Query: ${idx.name}`);
        console.log(`     Current Time: ${idx.metrics.executionTime}ms`);
      });
    }
    
    console.log('\n✅ Analysis complete!');
    console.log('\nNext steps:');
    console.log('  1. Run the index migration: npm run db:migrate');
    console.log('  2. Re-run this analysis to measure improvement');
    console.log('  3. Monitor query performance in production');
    
  } catch (error) {
    console.error('Error running analysis:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the analysis
runAnalysis().catch(console.error);
