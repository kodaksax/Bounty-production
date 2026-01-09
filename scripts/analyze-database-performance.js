#!/usr/bin/env node

/**
 * Database Performance Analysis Script
 * 
 * Analyzes PostgreSQL performance metrics and provides optimization recommendations.
 * 
 * Usage:
 *   node scripts/analyze-database-performance.js
 * 
 * Prerequisites:
 *   - PostgreSQL connection configured in DATABASE_URL
 *   - pg_stat_statements extension enabled (optional but recommended)
 */

require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function analyzeDatabase() {
  console.log('🔍 BountyExpo Database Performance Analysis');
  console.log('==========================================\n');

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // 1. Check database size
    await checkDatabaseSize();

    // 2. Analyze table sizes
    await analyzeTableSizes();

    // 3. Check index usage
    await analyzeIndexUsage();

    // 4. Find missing indexes
    await findMissingIndexes();

    // 5. Check for slow queries (if pg_stat_statements is available)
    await analyzeSlowQueries();

    // 6. Check connection pool status
    await checkConnectionPool();

    // 7. Check cache hit ratio
    await checkCacheHitRatio();

    // 8. Provide recommendations
    await provideRecommendations();

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

async function checkDatabaseSize() {
  console.log('📊 Database Size');
  console.log('----------------');
  
  const query = `
    SELECT 
      pg_size_pretty(pg_database_size(current_database())) as size
  `;
  
  const result = await client.query(query);
  console.log(`Total size: ${result.rows[0].size}\n`);
}

async function analyzeTableSizes() {
  console.log('📋 Table Sizes');
  console.log('---------------');
  
  const query = `
    SELECT 
      schemaname,
      tablename,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
      pg_total_relation_size(schemaname||'.'||tablename) as bytes
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY bytes DESC
    LIMIT 10
  `;
  
  const result = await client.query(query);
  result.rows.forEach(row => {
    console.log(`  ${row.tablename.padEnd(25)} ${row.size}`);
  });
  console.log();
}

async function analyzeIndexUsage() {
  console.log('🔍 Index Usage Analysis');
  console.log('----------------------');
  
  const query = `
    SELECT 
      schemaname,
      tablename,
      indexname,
      idx_scan as scans,
      idx_tup_read as tuples_read,
      pg_size_pretty(pg_relation_size(indexrelid)) as size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan DESC
    LIMIT 10
  `;
  
  const result = await client.query(query);
  
  if (result.rows.length === 0) {
    console.log('  No index usage statistics available yet.\n');
    return;
  }
  
  console.log('  Top 10 Most Used Indexes:');
  result.rows.forEach(row => {
    console.log(`    ${row.indexname.padEnd(40)} Scans: ${row.scans.toString().padStart(8)} Size: ${row.size}`);
  });
  
  // Find unused indexes
  const unusedQuery = `
    SELECT 
      schemaname,
      tablename,
      indexname,
      pg_size_pretty(pg_relation_size(indexrelid)) as size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
      AND idx_scan = 0
      AND indexname NOT LIKE '%_pkey'
    ORDER BY pg_relation_size(indexrelid) DESC
  `;
  
  const unusedResult = await client.query(unusedQuery);
  
  if (unusedResult.rows.length > 0) {
    console.log('\n  ⚠️  Unused Indexes (candidates for removal):');
    unusedResult.rows.forEach(row => {
      console.log(`    ${row.indexname.padEnd(40)} Size: ${row.size}`);
    });
  }
  
  console.log();
}

async function findMissingIndexes() {
  console.log('🔎 Potential Missing Indexes');
  console.log('----------------------------');
  
  const query = `
    SELECT 
      schemaname,
      tablename,
      attname,
      n_distinct,
      correlation
    FROM pg_stats
    WHERE schemaname = 'public'
      AND n_distinct > 100
      AND abs(correlation) < 0.5
    ORDER BY n_distinct DESC
    LIMIT 10
  `;
  
  const result = await client.query(query);
  
  if (result.rows.length === 0) {
    console.log('  ✅ No obvious missing indexes detected.\n');
    return;
  }
  
  console.log('  Columns that might benefit from indexes:');
  result.rows.forEach(row => {
    console.log(`    ${row.tablename}.${row.attname.padEnd(25)} (${row.n_distinct} distinct values)`);
  });
  console.log();
}

async function analyzeSlowQueries() {
  console.log('🐌 Slow Query Analysis');
  console.log('----------------------');
  
  // Check if pg_stat_statements extension is available
  const extensionCheck = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) as has_extension
  `);
  
  if (!extensionCheck.rows[0].has_extension) {
    console.log('  ⚠️  pg_stat_statements extension not installed.');
    console.log('  Install with: CREATE EXTENSION pg_stat_statements;\n');
    return;
  }
  
  const query = `
    SELECT 
      substring(query, 1, 80) as query_snippet,
      calls,
      round(total_exec_time::numeric, 2) as total_time_ms,
      round(mean_exec_time::numeric, 2) as mean_time_ms,
      round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 2) as percent_time
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat_statements%'
    ORDER BY total_exec_time DESC
    LIMIT 10
  `;
  
  try {
    const result = await client.query(query);
    
    if (result.rows.length === 0) {
      console.log('  No query statistics available yet.\n');
      return;
    }
    
    console.log('  Top 10 Slowest Queries:');
    result.rows.forEach((row, i) => {
      console.log(`\n  ${i + 1}. ${row.query_snippet}...`);
      console.log(`     Calls: ${row.calls}, Mean: ${row.mean_time_ms}ms, Total: ${row.total_time_ms}ms (${row.percent_time}%)`);
    });
    console.log();
  } catch (error) {
    console.log('  Could not retrieve slow query statistics.\n');
  }
}

async function checkConnectionPool() {
  console.log('🔌 Connection Pool Status');
  console.log('-------------------------');
  
  const query = `
    SELECT 
      count(*) FILTER (WHERE state = 'active') as active,
      count(*) FILTER (WHERE state = 'idle') as idle,
      count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
      count(*) as total
    FROM pg_stat_activity
    WHERE datname = current_database()
  `;
  
  const result = await client.query(query);
  const stats = result.rows[0];
  
  console.log(`  Active connections: ${stats.active}`);
  console.log(`  Idle connections: ${stats.idle}`);
  console.log(`  Idle in transaction: ${stats.idle_in_transaction}`);
  console.log(`  Total connections: ${stats.total}`);
  
  if (parseInt(stats.idle_in_transaction) > 0) {
    console.log('\n  ⚠️  Warning: Connections idle in transaction detected.');
    console.log('  This may indicate long-running transactions or connection leaks.');
  }
  
  console.log();
}

async function checkCacheHitRatio() {
  console.log('💾 Cache Hit Ratio');
  console.log('------------------');
  
  const query = `
    SELECT 
      sum(heap_blks_read) as heap_read,
      sum(heap_blks_hit) as heap_hit,
      round(
        (sum(heap_blks_hit) * 100.0 / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0))::numeric, 
        2
      ) as cache_hit_ratio
    FROM pg_statio_user_tables
  `;
  
  const result = await client.query(query);
  const ratio = result.rows[0].cache_hit_ratio;
  
  console.log(`  Cache hit ratio: ${ratio || 0}%`);
  
  if (ratio < 90) {
    console.log('  ⚠️  Cache hit ratio is low. Consider:');
    console.log('     - Increasing shared_buffers');
    console.log('     - Adding more system memory');
    console.log('     - Optimizing queries to reduce disk I/O');
  } else {
    console.log('  ✅ Cache hit ratio is healthy');
  }
  
  console.log();
}

async function provideRecommendations() {
  console.log('💡 Performance Recommendations');
  console.log('==============================\n');
  
  console.log('Based on the analysis above, consider these actions:\n');
  
  console.log('1. 📈 Database Indexing:');
  console.log('   - Run: psql -f services/api/migrations/add-performance-indexes.sql');
  console.log('   - Remove unused indexes to save disk space\n');
  
  console.log('2. 🔄 Connection Pooling:');
  console.log('   - Adjust DATABASE_POOL_MIN and DATABASE_POOL_MAX');
  console.log('   - Monitor connection usage during load tests\n');
  
  console.log('3. 💾 Caching:');
  console.log('   - Enable Redis caching (REDIS_ENABLED=true)');
  console.log('   - Tune cache TTL values based on update frequency\n');
  
  console.log('4. 🔍 Query Optimization:');
  console.log('   - Review slow queries identified above');
  console.log('   - Use EXPLAIN ANALYZE for query planning\n');
  
  console.log('5. 📊 Monitoring:');
  console.log('   - Enable pg_stat_statements: CREATE EXTENSION pg_stat_statements;');
  console.log('   - Set up regular performance monitoring\n');
  
  console.log('6. ⚡ Load Testing:');
  console.log('   - Run: npm run test:load:baseline');
  console.log('   - Compare results after applying optimizations\n');
}

// Run the analysis
analyzeDatabase().catch(console.error);
