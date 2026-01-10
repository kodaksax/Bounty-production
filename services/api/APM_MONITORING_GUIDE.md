# APM Monitoring Setup Guide

## Overview

BountyExpo API now includes comprehensive Application Performance Monitoring (APM) using OpenTelemetry, providing real-time visibility into system performance, errors, and business metrics.

## Features

### 1. Request Tracing ✅
- Automatic tracking of all API requests
- Response time recording with percentile calculations (p50, p95, p99)
- Slow endpoint identification (> 1s)
- Distributed tracing with trace ID propagation

### 2. Error Tracking ✅
- Automatic error capture with stack traces
- User context preservation
- Error spike alerts (> 1% error rate)
- Integration with Sentry for advanced error tracking

### 3. Database Monitoring ✅
- PostgreSQL query performance tracking
- Slow query identification (> 5s)
- Connection pool monitoring
- Query duration percentiles

### 4. Business Metrics ✅
- Bounties created per hour
- Payment success rate tracking
- User sign-ups monitoring
- Active user tracking
- Completion rate analysis

### 5. Alerts ✅
- API response time > 1s (critical)
- Error rate > 1% (critical)
- Database query > 5s (critical)
- Payment failure rate > 5% (critical)
- WebSocket connection surge (warning)

## Quick Start

### 1. Environment Configuration

Add to your `.env` file:

```env
# Enable OpenTelemetry
OTEL_ENABLED=true
OTEL_SERVICE_NAME=bountyexpo-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

### 2. Local Development with Jaeger

Run Jaeger for local tracing visualization:

```bash
docker run -d --name jaeger \
  -p 4318:4318 \
  -p 16686:16686 \
  jaegertracing/all-in-one:latest
```

Access Jaeger UI at: http://localhost:16686

### 3. Start the API

```bash
cd services/api
npm run dev
```

### 4. Access Monitoring Dashboards

- **Main Dashboard**: http://localhost:3001/monitoring/dashboard
- **Health Check**: http://localhost:3001/health/detailed
- **Metrics (Prometheus)**: http://localhost:3001/metrics
- **Metrics (JSON)**: http://localhost:3001/metrics/json
- **Active Alerts**: http://localhost:3001/metrics/alerts
- **Business Metrics**: http://localhost:3001/monitoring/business
- **Performance Summary**: http://localhost:3001/monitoring/performance

## Production Setup

### Option 1: Datadog

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=bountyexpo-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.datadoghq.com/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"DD-API-KEY":"your-datadog-api-key"}
```

### Option 2: New Relic

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=bountyexpo-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.nr-data.net:4318/v1/traces
OTEL_EXPORTER_OTLP_HEADERS={"api-key":"your-new-relic-license-key"}
```

### Option 3: Honeycomb

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=bountyexpo-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io:443
OTEL_EXPORTER_OTLP_HEADERS={"x-honeycomb-team":"your-api-key"}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BountyExpo API                          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         OpenTelemetry SDK                            │  │
│  │  - Auto-instrumentation (HTTP, PG, Redis)            │  │
│  │  - Custom spans for business operations              │  │
│  │  - Trace context propagation                         │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│  ┌──────────────────▼───────────────────────────────────┐  │
│  │         Monitoring Modules                           │  │
│  │  - metrics.ts: Counters, gauges, histograms          │  │
│  │  - tracing.ts: Distributed tracing                   │  │
│  │  - alerts.ts: Alert rules and triggering             │  │
│  │  - business-metrics.ts: Business KPIs                │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  APM Backend           │
         │  - Datadog             │
         │  - New Relic           │
         │  - Jaeger (local)      │
         │  - Honeycomb           │
         └────────────────────────┘
```

## Monitored Metrics

### HTTP Requests
- `http_requests_total`: Total HTTP requests (counter)
- `http_request_duration_milliseconds`: Request duration (histogram)
- `http_errors_total`: HTTP errors (counter)

### Database
- `db_queries_total`: Total database queries (counter)
- `db_query_duration_milliseconds`: Query duration (histogram)
- `db_errors_total`: Database errors (counter)
- `db_connections_active`: Active connections (gauge)

### WebSocket
- `websocket_connections_active`: Active connections (gauge)
- `websocket_messages_sent`: Messages sent (counter)
- `websocket_messages_received`: Messages received (counter)
- `websocket_errors_total`: WebSocket errors (counter)

### Payments
- `payment_transactions_total`: Total transactions (counter)
- `payment_success_total`: Successful payments (counter)
- `payment_failures_total`: Failed payments (counter)
- `payment_amount_cents_total`: Total amount processed (counter)

### Business Metrics
- `bounties_created_total`: Bounties created (counter)
- `bounties_accepted_total`: Bounties accepted (counter)
- `bounties_completed_total`: Bounties completed (counter)
- `bounties_cancelled_total`: Bounties cancelled (counter)
- `user_signups_total`: User registrations (counter)
- `active_users_gauge`: Currently active users (gauge)

## Alert Configuration

### Critical Alerts
1. **High Error Rate** (> 1%)
   - Checks: HTTP error rate
   - Cooldown: 5 minutes
   - Action: Page on-call engineer

2. **Slow API Response** (> 1s p95)
   - Checks: HTTP request duration p95
   - Cooldown: 5 minutes
   - Action: Investigate performance bottlenecks

3. **Slow Database Query** (> 5s p95)
   - Checks: Database query duration p95
   - Cooldown: 10 minutes
   - Action: Review query performance, add indexes

4. **Payment Failure Rate** (> 5%)
   - Checks: Payment success rate
   - Cooldown: 5 minutes
   - Action: Check Stripe integration, investigate failures

### Warning Alerts
1. **WebSocket Surge** (> 1000 connections)
   - Checks: Active WebSocket connections
   - Cooldown: 10 minutes
   - Action: Scale infrastructure if needed

## Dashboard Endpoints

### Main Monitoring Dashboard
```bash
GET /monitoring/dashboard
```

Returns comprehensive view including:
- Performance metrics (HTTP, DB, WebSocket)
- Business metrics (bounties, payments, users)
- Active and recent alerts
- Health status

### Real-time Metrics Stream
```javascript
const ws = new WebSocket('ws://localhost:3001/monitoring/stream');
ws.onmessage = (event) => {
  const metrics = JSON.parse(event.data);
  console.log('Real-time metrics:', metrics);
};
```

### Performance Summary
```bash
GET /monitoring/performance
```

Returns response time percentiles for HTTP and database.

### Business Metrics
```bash
GET /monitoring/business
```

Returns business KPIs and hourly rates.

## Integration with Existing Code

### Tracking Bounty Creation

```typescript
import { businessMetrics } from '../monitoring/business-metrics';

// In your bounty creation handler
const bounty = await createBounty(data);
businessMetrics.trackBountyCreated(bounty.id, userId, bounty.amount);
```

### Tracking Payments

```typescript
import { businessMetrics } from '../monitoring/business-metrics';

// In your payment handler
const result = await processPayment(amount);
businessMetrics.trackPayment(
  result.success, 
  amount, 
  'bounty_escrow', 
  userId, 
  bountyId
);
```

### Custom Tracing

```typescript
import { createCustomSpan, recordBusinessMetric } from '../monitoring/opentelemetry';

// Create a custom span for business operation
const span = createCustomSpan('bounty.matching', {
  bountyId: bounty.id,
  hunterId: hunter.id,
});

try {
  // Your business logic
  const match = await performMatching(bounty, hunter);
  
  // Record metric
  recordBusinessMetric('bounty.match.success', 1, {
    bountyId: bounty.id,
    matchScore: match.score,
  });
  
  span?.end();
} catch (error) {
  span?.recordException(error);
  span?.end();
  throw error;
}
```

## Testing

### 1. Generate Test Traffic

```bash
# Run the test suite
npm test

# Or generate manual requests
for i in {1..100}; do
  curl http://localhost:3001/health
done
```

### 2. View Metrics

```bash
# Check Prometheus metrics
curl http://localhost:3001/metrics

# Check JSON metrics
curl http://localhost:3001/metrics/json | jq

# Check dashboard
curl http://localhost:3001/monitoring/dashboard | jq
```

### 3. View Traces in Jaeger

1. Open http://localhost:16686
2. Select service: `bountyexpo-api`
3. Click "Find Traces"
4. Explore distributed traces

## Troubleshooting

### OpenTelemetry not sending traces

1. Check OTEL endpoint is reachable:
```bash
curl -v http://localhost:4318/v1/traces
```

2. Check logs for OTEL initialization:
```bash
grep "otel" logs/api.log
```

3. Verify environment variables:
```bash
echo $OTEL_ENABLED
echo $OTEL_EXPORTER_OTLP_ENDPOINT
```

### Metrics not updating

1. Generate some traffic:
```bash
curl http://localhost:3001/health
```

2. Check metrics endpoint:
```bash
curl http://localhost:3001/metrics/json | jq '.metrics'
```

3. Verify metrics middleware is registered in index.ts

### Alerts not triggering

1. Check alert rules are loaded:
```bash
curl http://localhost:3001/metrics/alerts | jq '.active'
```

2. Generate conditions that should trigger alerts:
```bash
# Generate errors
for i in {1..50}; do
  curl http://localhost:3001/nonexistent
done
```

3. Wait for cooldown period to expire

## Best Practices

1. **Always use business metrics tracking** for critical operations
2. **Set appropriate alert thresholds** based on your SLA
3. **Monitor dashboard regularly** to identify trends
4. **Use custom spans** for complex business logic
5. **Test alerts** in staging before production
6. **Set up on-call rotation** for critical alerts
7. **Review slow queries** weekly and optimize
8. **Track business KPIs** alongside technical metrics

## Additional Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Datadog APM Guide](https://docs.datadoghq.com/tracing/)
- [New Relic APM Guide](https://docs.newrelic.com/docs/apm/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)

## Support

For issues or questions:
1. Check logs: `services/api/logs/`
2. Review this documentation
3. Contact DevOps team
4. File an issue in the repository
