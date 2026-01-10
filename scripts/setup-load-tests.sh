#!/bin/bash

# Load Test Environment Setup Script
# This script prepares the environment for running k6 load tests

set -e

echo "🚀 BountyExpo Load Test Environment Setup"
echo "=========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if k6 is installed
echo "📦 Checking k6 installation..."
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}❌ k6 is not installed${NC}"
    echo ""
    echo "Please install k6:"
    echo "  macOS:   brew install k6"
    echo "  Ubuntu:  See https://k6.io/docs/getting-started/installation/"
    echo "  Docker:  docker pull grafana/k6"
    exit 1
fi

K6_VERSION=$(k6 version | head -n 1)
echo -e "${GREEN}✓ k6 installed: $K6_VERSION${NC}"
echo ""

# Check if API server is running
echo "🔍 Checking API server..."
API_URL="${BASE_URL:-http://localhost:3001}"
echo "Testing: $API_URL/health"

if curl -s -f "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API server is running at $API_URL${NC}"
else
    echo -e "${YELLOW}⚠️  API server not responding at $API_URL${NC}"
    echo ""
    echo "Please start the API server:"
    echo "  cd services/api"
    echo "  npm run dev"
    echo ""
    echo "Or set BASE_URL environment variable if using different host:"
    echo "  export BASE_URL=https://your-api-url.com"
    exit 1
fi
echo ""

# Check database connection
echo "🗄️  Checking database..."
DB_CHECK=$(curl -s "$API_URL/health" | grep -o '"database":"healthy"' || echo "")
if [ -n "$DB_CHECK" ]; then
    echo -e "${GREEN}✓ Database connection healthy${NC}"
else
    echo -e "${YELLOW}⚠️  Database connection issue detected${NC}"
    echo "Check API server logs for details"
fi
echo ""

# Check Redis connection (if applicable)
echo "📊 Checking Redis cache..."
REDIS_CHECK=$(curl -s "$API_URL/health" | grep -o '"redis":"healthy"' || echo "")
if [ -n "$REDIS_CHECK" ]; then
    echo -e "${GREEN}✓ Redis cache healthy${NC}"
else
    echo -e "${YELLOW}⚠️  Redis cache not available or not configured${NC}"
    echo "Load tests will still run, but caching won't be tested"
fi
echo ""

# Display test options
echo "📋 Available Load Tests:"
echo "========================"
echo ""
echo "1. Baseline Test (10 users, 5 min)"
echo "   npm run test:load:baseline"
echo ""
echo "2. Bounty Flow Test (50-200 users, ~23 min)"
echo "   npm run test:load:bounty-flow"
echo ""
echo "3. Spike Test (10->200 users, ~8 min)"
echo "   npm run test:load:spike"
echo ""
echo "4. Stress Test (up to 500 users, ~30 min)"
echo "   npm run test:load:stress"
echo ""
echo "5. Mixed Scenario (30-150 users, ~18 min)"
echo "   npm run test:load:mixed"
echo ""
echo "6. Auth Flow Test (20-50 users, ~9 min)"
echo "   npm run test:load:auth"
echo ""
echo "7. Run All Tests"
echo "   npm run test:load:all"
echo ""

# Recommendations
echo "💡 Recommendations:"
echo "==================="
echo ""
echo "1. Start with the baseline test:"
echo "   npm run test:load:baseline"
echo ""
echo "2. Monitor server resources during tests:"
echo "   - CPU usage (top/htop)"
echo "   - Memory usage (free -m)"
echo "   - Database connections"
echo "   - API logs"
echo ""
echo "3. Open a separate terminal to watch API logs:"
echo "   cd services/api"
echo "   npm run dev"
echo ""
echo "4. Use a custom BASE_URL if needed:"
echo "   k6 run -e BASE_URL=https://staging.api.com tests/load/baseline-test.js"
echo ""

# Optional: Check if we should seed test data
echo "🌱 Test Data Preparation"
echo "========================"
echo ""
echo "For best results, ensure your database has test data:"
echo "  - At least 100 bounties with various statuses"
echo "  - Multiple user accounts"
echo "  - Sample conversations and messages"
echo ""
read -r -p "Do you want to run database seeding? (y/N) " -n 1 answer
echo ""
if [[ $answer =~ ^[Yy]$ ]]; then
    echo "Running database seed..."
    cd services/api
    npm run db:seed || echo -e "${YELLOW}⚠️  Seeding failed or not configured${NC}"
    cd ../..
fi
echo ""

echo -e "${GREEN}✅ Environment setup complete!${NC}"
echo ""
echo "Ready to run load tests. Start with:"
echo "  npm run test:load:baseline"
echo ""
