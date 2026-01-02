# Phase 7: Performance Testing

## Overview
Validate system performance under load to ensure the consolidated backend can handle production traffic.

## 7.1 Load Testing Configuration

### Using Artillery

Install Artillery:
```bash
npm install -g artillery
```

#### Configuration File: `artillery-load-test.yml`

```yaml
config:
  target: 'http://localhost:3001'
  phases:
    # Warm-up phase
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    
    # Sustained load
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
    
    # Peak load
    - duration: 120
      arrivalRate: 100
      name: "Peak load"
    
    # Cool down
    - duration: 60
      arrivalRate: 10
      name: "Cool down"
  
  # HTTP settings
  http:
    timeout: 30
  
  # Variables
  variables:
    testEmail:
      - "test1@example.com"
      - "test2@example.com"
      - "test3@example.com"
    testPassword: "TestPassword123!"
  
  # Plugins
  plugins:
    metrics-by-endpoint:
      # Track metrics per endpoint
      stripQueryString: true
    expect:
      {}
  
  # Processor for custom logic
  processor: "./artillery-processor.js"

scenarios:
  # Core API scenario
  - name: "Core API Flow"
    weight: 40
    flow:
      # Health check
      - get:
          url: "/health"
          expect:
            - statusCode: 200
      
      # Sign in
      - post:
          url: "/auth/sign-in"
          json:
            email: "{{ testEmail }}"
            password: "{{ testPassword }}"
          capture:
            - json: "$.token"
              as: "authToken"
          expect:
            - statusCode: [200, 401]
      
      # Get profile (if signed in)
      - get:
          url: "/api/profile"
          headers:
            Authorization: "Bearer {{ authToken }}"
          ifTrue: "authToken"
          expect:
            - statusCode: [200, 401]
      
      # List bounties
      - get:
          url: "/api/bounties"
          qs:
            limit: 20
            status: "open"
          expect:
            - statusCode: 200
      
      # Get specific bounty
      - get:
          url: "/api/bounties/{{ $randomString() }}"
          expect:
            - statusCode: [200, 404]

  # Payment flow scenario
  - name: "Payment Operations"
    weight: 20
    flow:
      # Sign in first
      - post:
          url: "/auth/sign-in"
          json:
            email: "{{ testEmail }}"
            password: "{{ testPassword }}"
          capture:
            - json: "$.token"
              as: "authToken"
      
      # Check wallet balance
      - get:
          url: "/wallet/balance"
          headers:
            Authorization: "Bearer {{ authToken }}"
          ifTrue: "authToken"
          expect:
            - statusCode: [200, 401]
      
      # Get transactions
      - get:
          url: "/wallet/transactions"
          headers:
            Authorization: "Bearer {{ authToken }}"
          ifTrue: "authToken"
          expect:
            - statusCode: [200, 401]

  # Notification scenario
  - name: "Notifications"
    weight: 20
    flow:
      # Sign in
      - post:
          url: "/auth/sign-in"
          json:
            email: "{{ testEmail }}"
            password: "{{ testPassword }}"
          capture:
            - json: "$.token"
              as: "authToken"
      
      # Get notifications
      - get:
          url: "/notifications"
          headers:
            Authorization: "Bearer {{ authToken }}"
          ifTrue: "authToken"
          expect:
            - statusCode: [200, 401]
      
      # Get unread count
      - get:
          url: "/notifications/unread-count"
          headers:
            Authorization: "Bearer {{ authToken }}"
          ifTrue: "authToken"
          expect:
            - statusCode: [200, 401]

  # Admin scenario
  - name: "Admin Operations"
    weight: 10
    flow:
      # Admin metrics
      - get:
          url: "/admin/metrics"
          headers:
            Authorization: "Bearer {{ adminToken }}"
          expect:
            - statusCode: [200, 401, 403]
      
      # Analytics
      - get:
          url: "/admin/analytics/metrics"
          headers:
            Authorization: "Bearer {{ adminToken }}"
          expect:
            - statusCode: [200, 401, 403]

  # Monitoring scenario
  - name: "Health Checks"
    weight: 10
    flow:
      # Basic health
      - get:
          url: "/health"
          expect:
            - statusCode: 200
      
      # Detailed health
      - get:
          url: "/health/detailed"
          expect:
            - statusCode: [200, 503]
      
      # Metrics
      - get:
          url: "/metrics/json"
          expect:
            - statusCode: 200
```

#### Artillery Processor: `artillery-processor.js`

```javascript
// Custom functions for Artillery scenarios

module.exports = {
  // Generate random string
  generateRandomString: function(context, events, done) {
    context.vars.randomString = Math.random().toString(36).substring(7);
    return done();
  },
  
  // Log response
  logResponse: function(requestParams, response, context, ee, next) {
    console.log(`Status: ${response.statusCode}`);
    return next();
  },
  
  // Custom validation
  validateResponse: function(requestParams, response, context, ee, next) {
    if (response.statusCode !== 200) {
      console.warn(`Unexpected status: ${response.statusCode}`);
    }
    return next();
  }
};
```

### Running Load Tests

```bash
# Basic run
artillery run artillery-load-test.yml

# With output report
artillery run artillery-load-test.yml --output report.json

# Generate HTML report
artillery report report.json

# Quick test (reduced duration)
artillery quick --count 100 --num 10 http://localhost:3001/health
```

### Expected Results

**Acceptable Performance:**
- p50 response time: < 100ms
- p95 response time: < 200ms
- p99 response time: < 500ms
- Error rate: < 1%
- Throughput: > 100 req/s

## 7.2 Stress Testing

### Purpose
Find the breaking point and identify bottlenecks.

### Stress Test Configuration: `artillery-stress-test.yml`

```yaml
config:
  target: 'http://localhost:3001'
  phases:
    # Ramp up gradually
    - duration: 60
      arrivalRate: 50
      rampTo: 100
      name: "Ramp up to 100/s"
    
    - duration: 60
      arrivalRate: 100
      rampTo: 200
      name: "Ramp up to 200/s"
    
    - duration: 60
      arrivalRate: 200
      rampTo: 500
      name: "Ramp up to 500/s"
    
    - duration: 60
      arrivalRate: 500
      rampTo: 1000
      name: "Ramp up to 1000/s"
    
    # Sustain maximum load
    - duration: 120
      arrivalRate: 1000
      name: "Maximum load"
  
  http:
    timeout: 30

scenarios:
  - name: "Simple health check"
    flow:
      - get:
          url: "/health"
```

### Running Stress Tests

```bash
# Run stress test
artillery run artillery-stress-test.yml --output stress-report.json

# Monitor system during test
watch -n 1 'curl -s http://localhost:3001/metrics/json | jq ".metrics.requests"'

# Monitor health
watch -n 5 'curl -s http://localhost:3001/health/detailed'
```

### What to Monitor During Stress Tests

1. **Application Metrics**
   - Response times (p50, p95, p99)
   - Error rates
   - Active connections
   - Queue depths

2. **System Resources**
   ```bash
   # CPU and Memory
   top
   
   # Network
   netstat -an | grep ESTABLISHED | wc -l
   
   # Disk I/O
   iostat -x 1
   
   # Process stats
   ps aux | grep node
   ```

3. **Database**
   - Connection pool usage
   - Query performance
   - Lock contention
   - Replication lag

## 7.3 Benchmark Key Operations

### Benchmarking Script: `benchmark.ts`

```typescript
// services/api/src/benchmark.ts

import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

interface BenchmarkResult {
  operation: string;
  samples: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
}

async function measureOperation(
  name: string,
  operation: () => Promise<any>,
  samples: number = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];
  
  console.log(`\nBenchmarking: ${name} (${samples} samples)`);
  
  for (let i = 0; i < samples; i++) {
    const start = Date.now();
    try {
      await operation();
      const duration = Date.now() - start;
      times.push(duration);
      
      if ((i + 1) % 10 === 0) {
        process.stdout.write('.');
      }
    } catch (error) {
      console.error(`Error in sample ${i}:`, error);
    }
  }
  
  console.log(' Done!');
  
  // Calculate statistics
  times.sort((a, b) => a - b);
  
  const result: BenchmarkResult = {
    operation: name,
    samples: times.length,
    min: times[0],
    max: times[times.length - 1],
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)]
  };
  
  return result;
}

async function runBenchmarks() {
  console.log('🚀 Starting Performance Benchmarks\n');
  console.log('=' .repeat(60));
  
  const results: BenchmarkResult[] = [];
  
  // Benchmark 1: Health Check
  results.push(await measureOperation(
    'Health Check',
    async () => {
      await axios.get(`${API_BASE_URL}/health`);
    },
    200
  ));
  
  // Benchmark 2: List Bounties
  results.push(await measureOperation(
    'List Bounties',
    async () => {
      await axios.get(`${API_BASE_URL}/api/bounties?limit=20`);
    },
    100
  ));
  
  // Benchmark 3: Payment Intent Creation (with auth)
  // Note: Requires valid auth token
  const authToken = process.env.TEST_AUTH_TOKEN;
  if (authToken) {
    results.push(await measureOperation(
      'Create Payment Intent',
      async () => {
        await axios.post(
          `${API_BASE_URL}/api/payments/create-intent`,
          { amountCents: 5000 },
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
      },
      50
    ));
  }
  
  // Benchmark 4: Wallet Balance Query
  if (authToken) {
    results.push(await measureOperation(
      'Get Wallet Balance',
      async () => {
        await axios.get(
          `${API_BASE_URL}/wallet/balance`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
      },
      100
    ));
  }
  
  // Benchmark 5: Notifications
  if (authToken) {
    results.push(await measureOperation(
      'Get Notifications',
      async () => {
        await axios.get(
          `${API_BASE_URL}/notifications?limit=50`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
      },
      100
    ));
  }
  
  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Benchmark Results\n');
  
  console.log('| Operation | Samples | Min | Max | Mean | Median | P95 | P99 |');
  console.log('|-----------|---------|-----|-----|------|--------|-----|-----|');
  
  for (const result of results) {
    console.log(
      `| ${result.operation.padEnd(25)} | ` +
      `${result.samples.toString().padEnd(7)} | ` +
      `${result.min.toFixed(0).padEnd(3)}ms | ` +
      `${result.max.toFixed(0).padEnd(3)}ms | ` +
      `${result.mean.toFixed(0).padEnd(4)}ms | ` +
      `${result.median.toFixed(0).padEnd(6)}ms | ` +
      `${result.p95.toFixed(0).padEnd(3)}ms | ` +
      `${result.p99.toFixed(0).padEnd(3)}ms |`
    );
  }
  
  console.log('\n' + '='.repeat(60));
  
  // Check if any operation exceeds thresholds
  const failures: string[] = [];
  
  for (const result of results) {
    if (result.p95 > 200) {
      failures.push(`${result.operation}: p95 (${result.p95.toFixed(0)}ms) > 200ms`);
    }
    if (result.mean > 100) {
      failures.push(`${result.operation}: mean (${result.mean.toFixed(0)}ms) > 100ms`);
    }
  }
  
  if (failures.length > 0) {
    console.log('\n⚠️  Performance Issues Detected:\n');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n✅ All benchmarks passed!\n');
    process.exit(0);
  }
}

// Run benchmarks
runBenchmarks().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
```

### Running Benchmarks

```bash
# Run benchmarks
tsx services/api/src/benchmark.ts

# With auth token for protected endpoints
TEST_AUTH_TOKEN=your-token-here tsx services/api/src/benchmark.ts
```

## Success Criteria

### Load Testing
- ✅ System handles 100 req/s sustained load
- ✅ p95 response time < 200ms under load
- ✅ Error rate < 1% under load
- ✅ No memory leaks after extended run
- ✅ Graceful degradation under stress

### Stress Testing
- ✅ Breaking point identified (> 500 req/s)
- ✅ No crashes or unhandled errors
- ✅ Recovery after load reduction
- ✅ Database connections managed properly
- ✅ Resource cleanup occurs

### Benchmarks
- ✅ Health check: < 10ms
- ✅ Simple queries: < 50ms
- ✅ Complex queries: < 200ms
- ✅ Payment operations: < 500ms
- ✅ Consistent performance across runs

## Optimization Strategies

If performance issues are found:

### Database Optimization
- Add indexes on frequently queried columns
- Optimize slow queries
- Use connection pooling
- Consider read replicas
- Implement caching

### Application Optimization
- Enable HTTP/2
- Add response compression
- Implement request caching
- Use CDN for static assets
- Optimize payload sizes

### Infrastructure Optimization
- Scale horizontally (add more instances)
- Increase server resources
- Use load balancer
- Implement auto-scaling
- Optimize network configuration

## Monitoring During Tests

### Real-time Monitoring
```bash
# Watch metrics
watch -n 1 'curl -s http://localhost:3001/metrics/json | jq'

# Watch health
watch -n 5 'curl -s http://localhost:3001/health/detailed | jq'

# Watch active connections
watch -n 1 'netstat -an | grep :3001 | wc -l'
```

### Log Monitoring
```bash
# Follow application logs
tail -f services/api/logs/app.log

# Filter errors only
tail -f services/api/logs/app.log | grep ERROR

# Count error rate
tail -f services/api/logs/app.log | grep -c ERROR
```

## Documentation

Test results should be documented including:
- Date and time of test
- System configuration
- Test parameters
- Results (with graphs)
- Issues discovered
- Actions taken

Store test reports in `services/api/performance-reports/` directory.
