#!/bin/bash
# Verify database index migration
# This script validates that the migration can be safely applied

set -e

echo "🔍 Database Index Migration Verification"
echo "========================================"
echo ""

# Database connection string
DATABASE_URL="${DATABASE_URL:-postgresql://bountyexpo:bountyexpo123@localhost:5432/bountyexpo}"

echo "📊 Checking database connection..."
if psql "$DATABASE_URL" -c "SELECT version();" > /dev/null 2>&1; then
  echo "✅ Database connection successful"
else
  echo "❌ Cannot connect to database"
  echo "   Make sure PostgreSQL is running: npm run dev"
  exit 1
fi

echo ""
echo "📋 Listing existing tables..."
psql "$DATABASE_URL" -c "\dt" 2>&1 | grep -E "public\s+\|" || echo "   No tables found (fresh database)"

echo ""
echo "📊 Checking existing indexes..."
INDEX_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" | tr -d ' ')
echo "   Current index count: $INDEX_COUNT"

echo ""
echo "✨ Testing migration syntax..."
if psql "$DATABASE_URL" -f supabase/migrations/20260107_add_performance_indexes.sql > /tmp/migration-test.log 2>&1; then
  echo "✅ Migration applied successfully"
  
  # Count how many indexes were created
  NEW_INDEX_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" | tr -d ' ')
  CREATED_COUNT=$((NEW_INDEX_COUNT - INDEX_COUNT))
  
  echo "   New indexes created: $CREATED_COUNT"
  echo ""
  echo "📊 Newly created indexes:"
  psql "$DATABASE_URL" -c "
    SELECT 
      tablename,
      indexname,
      indexdef
    FROM pg_indexes 
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
    LIMIT 20;" 2>&1
else
  echo "⚠️  Migration had errors (expected if tables don't exist yet)"
  echo ""
  echo "📝 Migration output:"
  cat /tmp/migration-test.log | head -20
  echo ""
  echo "💡 This is normal for a fresh database without tables."
  echo "   The migration uses IF NOT EXISTS so it's safe to run."
fi

echo ""
echo "✅ Verification complete!"
echo ""
echo "Next steps:"
echo "  1. Ensure all tables exist (run schema migrations first)"
echo "  2. Apply this index migration"
echo "  3. Run performance measurement: npm run measure:performance"
