# Load Testing with k6

This directory contains load testing scripts for the BountyExpo API using [k6](https://k6.io/), a modern open-source load testing tool.

## Prerequisites

### Install k6

**macOS (Homebrew):**
```bash
brew install k6
```

**Windows (Chocolatey):**
```bash
choco install k6
```

**Linux (Debian/Ubuntu):**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Docker:**
```bash
docker pull grafana/k6
```

For other installation methods, see the [official k6 documentation](https://k6.io/docs/getting-started/installation/).

## Test Scenarios

### 1. Baseline Test (`baseline-test.js`)
Tests with minimal load to establish baseline performance metrics.

- **Load**: 10 concurrent users for 5 minutes
- **Purpose**: Establish performance baseline
- **Thresholds**: 
  - p95 response time < 300ms
  - Error rate < 1%

```bash
npm run test:load:baseline
# or
k6 run tests/load/baseline-test.js
```

### 2. Bounty Flow Test (`bounty-flow.js`)
Comprehensive test of the core bounty listing and viewing flows.

- **Load**: Progressive ramp from 50 to 200 users
- **Duration**: ~23 minutes
- **Operations**: List bounties, view details, search
- **Thresholds**:
  - p95 response time < 500ms
  - Error rate < 1%

```bash
npm run test:load:bounty-flow
# or
k6 run tests/load/bounty-flow.js
```

### 3. Spike Test (`spike-test.js`)
Tests system response to sudden traffic spikes.

- **Load**: Sudden jump from 10 to 200 users
- **Duration**: ~8 minutes
- **Purpose**: Test resilience to traffic spikes
- **Thresholds**:
  - p95 response time < 1000ms
  - Error rate < 5%

```bash
npm run test:load:spike
# or
k6 run tests/load/spike-test.js
```

### 4. Stress Test (`stress-test.js`)
Gradually increases load to find system limits and breaking points.

- **Load**: Progressive ramp from 100 to 500 users
- **Duration**: ~30 minutes
- **Purpose**: Identify bottlenecks and breaking points
- **Thresholds**:
  - p95 response time < 2000ms
  - Error rate < 10%

```bash
npm run test:load:stress
# or
k6 run tests/load/stress-test.js
```

### 5. Mixed Scenario Test (`mixed-scenario.js`)
Simulates realistic user behavior with mixed operations.

- **Load**: Progressive ramp from 30 to 150 users
- **Duration**: ~18 minutes
- **User Types**:
  - 50% browsers (list and page through bounties)
  - 30% searchers (search specific terms)
  - 20% detail viewers (view multiple bounty details)

```bash
npm run test:load:mixed
# or
k6 run tests/load/mixed-scenario.js
```

### 6. Authentication Flow Test (`auth-flow.js`)
Tests authentication-related endpoints under load.

- **Load**: Progressive ramp from 20 to 50 users
- **Duration**: ~9 minutes
- **Note**: Currently tests public endpoints with auth-like patterns

```bash
npm run test:load:auth
# or
k6 run tests/load/auth-flow.js
```

## Configuration

### Environment Variables

All tests support the following environment variables:

- `BASE_URL`: API base URL (default: `http://localhost:3001`)

Example:
```bash
k6 run -e BASE_URL=https://api.bountyexpo.com tests/load/bounty-flow.js
```

### Custom Test Duration

Override test duration and virtual users:
```bash
k6 run --vus 50 --duration 10m tests/load/bounty-flow.js
```

## Running Tests

### Local Development

1. Start the API server:
```bash
cd services/api
npm run dev
```

2. In a separate terminal, run the load test:
```bash
npm run test:load:baseline
```

### Using npm Scripts

The following npm scripts are available from the project root:

```bash
npm run test:load:baseline     # Baseline test (10 users, 5 min)
npm run test:load:bounty-flow  # Main bounty flow (50-200 users)
npm run test:load:spike        # Spike test (10->200 users)
npm run test:load:stress       # Stress test (up to 500 users)
npm run test:load:mixed        # Mixed scenario (30-150 users)
npm run test:load:auth         # Auth flow test (20-50 users)
npm run test:load:all          # Run all tests sequentially
```

### Using Docker

Run tests in Docker:
```bash
docker run --rm -i --network="host" grafana/k6 run - < tests/load/bounty-flow.js
```

## Understanding Results

### Key Metrics

k6 provides detailed metrics after each test:

- **http_req_duration**: Response time distribution
  - `p(95)`: 95th percentile - 95% of requests were faster than this
  - `p(99)`: 99th percentile
  - `avg`: Average response time
  - `min/max`: Fastest and slowest requests

- **http_req_failed**: Percentage of failed requests
- **http_reqs**: Total number of requests made
- **vus**: Current number of virtual users
- **vus_max**: Maximum number of virtual users

### Custom Metrics

Our tests also track custom metrics:

- `errors`: Custom error rate
- `list_bounties_duration`: Response time for listing bounties
- `get_bounty_duration`: Response time for getting single bounty
- `search_bounties_duration`: Response time for search operations

### Sample Output

```
     ✓ list bounties status 200
     ✓ list bounties < 500ms
     ✓ get bounty status 200
     
     checks.........................: 98.50%  ✓ 2955     ✗ 45   
     data_received..................: 1.2 MB  40 kB/s
     data_sent......................: 486 kB  16 kB/s
     http_req_duration..............: avg=145ms  p(95)=320ms
     http_req_failed................: 0.50%   ✓ 15       ✗ 2985
     http_reqs......................: 3000    100/s
     vus............................: 50      min=10  max=200
```

### Interpreting Thresholds

- ✓ Green checkmark: Threshold passed
- ✗ Red X: Threshold failed

Example:
```
✓ http_req_duration..............: p(95)=450ms < 500ms [PASS]
✗ http_req_failed................: rate=0.02 > 0.01 [FAIL]
```

## Performance Benchmarks

After running tests, document your results:

| Test Scenario | VUs | Duration | p95 Response Time | Error Rate | RPS |
|--------------|-----|----------|------------------|------------|-----|
| Baseline | 10 | 5m | 245ms | 0.1% | 50 |
| Normal Load | 50 | 10m | 420ms | 0.5% | 250 |
| Peak Load | 200 | 5m | 680ms | 1.2% | 800 |
| Stress | 500 | 30m | 1850ms | 8.5% | 1200 |

## Troubleshooting

### Server Not Responding

Ensure the API server is running:
```bash
curl http://localhost:3001/health
```

### Connection Refused

Check that the `BASE_URL` is correct:
```bash
k6 run -e BASE_URL=http://localhost:3001 tests/load/baseline-test.js
```

### High Error Rates

- Check server logs for errors
- Verify database connection
- Check Redis cache availability
- Monitor CPU and memory usage

### Slow Response Times

Potential causes:
- Database query performance
- Missing indexes
- Cache not working
- Connection pool exhausted
- CPU/memory constraints

## Monitoring During Tests

### Server Monitoring

Monitor these metrics during load tests:

1. **CPU Usage**: `top` or `htop`
2. **Memory Usage**: `free -m`
3. **Database Connections**: Check PostgreSQL connection count
4. **Redis Cache**: Monitor hit/miss rates
5. **API Logs**: Watch for errors and slow queries

### Example Monitoring Setup

Terminal 1 - Run test:
```bash
npm run test:load:bounty-flow
```

Terminal 2 - Monitor API logs:
```bash
cd services/api
npm run dev | grep ERROR
```

Terminal 3 - Monitor system resources:
```bash
watch -n 1 'echo "CPU:"; mpstat 1 1; echo "Memory:"; free -m'
```

## Best Practices

1. **Start Small**: Always run baseline test first
2. **Incremental Load**: Gradually increase load to identify breaking points
3. **Realistic Scenarios**: Use mixed scenarios that match real user behavior
4. **Monitor Resources**: Watch server resources during tests
5. **Document Results**: Keep a record of test results and configurations
6. **Test Regularly**: Run load tests before major releases
7. **Use Production-Like Data**: Seed database with realistic data volumes

## CI/CD Integration

### GitHub Actions

To run load tests in CI/CD, create `.github/workflows/load-test.yml`:

```yaml
name: Load Tests

on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      
      - name: Run baseline test
        run: k6 run -e BASE_URL=${{ secrets.STAGING_API_URL }} tests/load/baseline-test.js
```

## Next Steps

After running load tests:

1. **Identify Bottlenecks**: Review slow queries, high CPU usage, etc.
2. **Optimize**: 
   - Add database indexes
   - Implement caching
   - Optimize queries
   - Tune connection pools
3. **Re-test**: Verify optimizations improved performance
4. **Document**: Update benchmarks with new results
5. **Monitor**: Set up alerts for performance degradation

## Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [k6 Metrics](https://k6.io/docs/using-k6/metrics/)
- [k6 Examples](https://k6.io/docs/examples/)
