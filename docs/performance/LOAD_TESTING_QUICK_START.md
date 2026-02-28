# Load Testing Quick Start Guide

This guide will help you run your first load test in under 5 minutes.

## Prerequisites

1. **Install k6**:
   ```bash
   # macOS
   brew install k6
   
   # Or use Docker
   docker pull grafana/k6
   ```

2. **Start the API server**:
   ```bash
   cd services/api
   npm install
   npm run dev
   ```
   
   The API should be running at http://localhost:3001

## Step 1: Verify Environment

Run the setup script to verify everything is configured:

```bash
./scripts/setup-load-tests.sh
```

This will check:
- k6 installation
- API server availability
- Database connection
- Redis cache (if enabled)

## Step 2: Run Your First Test

Start with the baseline test (10 users, 5 minutes):

```bash
npm run test:load:baseline
```

You should see output like:

```
     ✓ status 200
     ✓ response time < 300ms

     checks.........................: 100.00% ✓ 3000    ✗ 0
     data_received..................: 1.5 MB  5 kB/s
     data_sent......................: 486 kB  1.6 kB/s
     http_req_blocked...............: avg=1.2ms   min=2µs     med=5µs
     http_req_connecting............: avg=1.1ms   min=0s      med=0s
     http_req_duration..............: avg=145ms   min=23ms    med=132ms  max=487ms
       { expected_response:true }...: avg=145ms   min=23ms    med=132ms  max=487ms
     ✓ { p(95)<300ms }
     http_req_failed................: 0.00%   ✓ 0       ✗ 3000
     http_req_receiving.............: avg=124µs   min=31µs    med=89µs   max=2.14ms
     http_req_sending...............: avg=36µs    min=11µs    med=27µs   max=842µs
     http_req_tls_handshaking.......: avg=0s      min=0s      med=0s     max=0s
     http_req_waiting...............: avg=144ms   min=23ms    med=131ms  max=487ms
     http_reqs......................: 3000    10/s
     iteration_duration.............: avg=3.14s   min=3.02s   med=3.13s  max=3.49s
     iterations.....................: 1000    3.333333/s
     vus............................: 10      min=10    max=10
     vus_max........................: 10      min=10    max=10
```

## Step 3: Analyze Results

Look at these key metrics:

1. **http_req_duration p(95)**: Should be < 500ms
   - This means 95% of requests completed within this time

2. **http_req_failed**: Should be < 1%
   - Percentage of failed requests

3. **http_reqs**: Total requests made
   - Higher is better (more throughput)

4. **✓/✗ Indicators**: 
   - ✓ = Threshold passed
   - ✗ = Threshold failed

## Step 4: Identify Bottlenecks (If Any)

If your test didn't pass the thresholds:

1. **Check API logs**:
   ```bash
   cd services/api
   npm run dev | grep ERROR
   ```

2. **Analyze database performance**:
   ```bash
   npm run analyze:db-performance
   ```

3. **Monitor system resources**:
   ```bash
   top
   # or
   htop
   ```

## Step 5: Apply Optimizations

If you found performance issues:

1. **Add database indexes**:
   ```bash
   psql -U bountyexpo -d bountyexpo -f services/api/migrations/add-performance-indexes.sql
   ```

2. **Enable Redis caching** (if not already):
   ```env
   # In services/api/.env
   REDIS_ENABLED=true
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

3. **Tune connection pool**:
   ```env
   # In services/api/.env
   DATABASE_POOL_MIN=5
   DATABASE_POOL_MAX=20
   ```

## Step 6: Re-test

After applying optimizations, run the test again:

```bash
npm run test:load:baseline
```

Compare the results to see improvements!

## Next Tests to Run

Once baseline passes, try:

1. **Normal Load** (50 users):
   ```bash
   npm run test:load:bounty-flow
   ```

2. **Peak Load** (200 users):
   ```bash
   # Included in bounty-flow test
   npm run test:load:bounty-flow
   ```

3. **Spike Test** (sudden traffic):
   ```bash
   npm run test:load:spike
   ```

## Common Issues & Solutions

### Issue: "Server health check failed"

**Solution**: Ensure API server is running
```bash
cd services/api && npm run dev
```

### Issue: High error rates (> 5%)

**Solution**: 
- Check API server logs for errors
- Verify database connection
- Check if services are running (PostgreSQL, Redis)

### Issue: Slow response times (p95 > 1000ms)

**Solution**:
- Run database analysis: `npm run analyze:db-performance`
- Add missing indexes
- Enable caching
- Check for slow queries

### Issue: Connection timeouts

**Solution**:
- Increase connection pool size (DATABASE_POOL_MAX)
- Check database connection limits
- Verify network configuration

## Tips for Success

1. **Start Small**: Always run baseline test first
2. **Monitor**: Watch server metrics during tests
3. **Document**: Save test results for comparison
4. **Iterate**: Test → Optimize → Retest
5. **Production-like**: Use realistic data volumes

## Quick Reference: Test Scenarios

| Test | VUs | Duration | Command |
|------|-----|----------|---------|
| Baseline | 10 | 5m | `npm run test:load:baseline` |
| Bounty Flow | 50-200 | 23m | `npm run test:load:bounty-flow` |
| Spike | 10→200 | 8m | `npm run test:load:spike` |
| Stress | up to 500 | 30m | `npm run test:load:stress` |
| Mixed | 30-150 | 18m | `npm run test:load:mixed` |

## Getting Help

- **Full Documentation**: See `tests/load/README.md`
- **Performance Guide**: See `LOAD_TESTING_RESULTS.md`
- **k6 Docs**: https://k6.io/docs/

## Success Criteria

Your load testing is successful when:

- ✅ Baseline test passes (p95 < 300ms, errors < 1%)
- ✅ Normal load test passes (p95 < 500ms at 50 VUs)
- ✅ Peak load test passes (p95 < 500ms at 200 VUs)
- ✅ System remains stable under stress
- ✅ Error rate stays below 1%

Congratulations! You're now ready to ensure your API can handle production traffic. 🎉
