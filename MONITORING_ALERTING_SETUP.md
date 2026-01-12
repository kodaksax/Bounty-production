# Monitoring and Alerting Setup Guide

> Complete guide for setting up monitoring, error tracking, and alerting for BountyExpo production environment

## Table of Contents

- [Overview](#overview)
- [Error Tracking with Sentry](#error-tracking-with-sentry)
- [Analytics with Mixpanel](#analytics-with-mixpanel)
- [Session Replay with LogRocket (Optional)](#session-replay-with-logrocket-optional)
- [Health Checks and Uptime Monitoring](#health-checks-and-uptime-monitoring)
- [Performance Monitoring](#performance-monitoring)
- [Log Aggregation](#log-aggregation)
- [Alerting Configuration](#alerting-configuration)
- [Incident Response](#incident-response)
- [Metrics and KPIs](#metrics-and-kpis)

---

## Overview

BountyExpo uses a comprehensive monitoring stack to ensure application health, track errors, and maintain high service quality.

### Monitoring Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Mobile App                        │
│  (React Native + Expo)                              │
└─────────────┬───────────────────────┬───────────────┘
              │                       │
              ▼                       ▼
      ┌───────────────┐      ┌──────────────┐
      │    Sentry     │      │   Mixpanel   │
      │ Error Tracking│      │  Analytics   │
      └───────────────┘      └──────────────┘
              
┌─────────────────────────────────────────────────────┐
│                    API Server                        │
│  (Fastify + Node.js)                                │
└─────────────┬───────────────────────┬───────────────┘
              │                       │
              ▼                       ▼
      ┌───────────────┐      ┌──────────────┐
      │    Sentry     │      │   Pino       │
      │ Error Tracking│      │   Logging    │
      └───────────────┘      └──────────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │  CloudWatch     │
                            │  or DataDog     │
                            └─────────────────┘
```

---

## Error Tracking with Sentry

### 1. Sentry Setup

**Create Sentry Projects:**
1. Go to [sentry.io](https://sentry.io)
2. Create two projects:
   - `bountyexpo-mobile` (React Native)
   - `bountyexpo-api` (Node.js)

### 2. Mobile App Configuration

The mobile app already has Sentry configured in the codebase. Update environment variables:

```bash
# .env.production
EXPO_PUBLIC_SENTRY_DSN="https://your-dsn@sentry.io/project-id"
SENTRY_ENVIRONMENT="production"
```

**Verify Integration:**
```typescript
// Mobile app already includes Sentry via @sentry/react-native
// Configuration in App.tsx or providers/ErrorBoundary.tsx
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: process.env.EXPO_PUBLIC_ENVIRONMENT,
  tracesSampleRate: 0.1, // 10% of transactions
  enableAutoSessionTracking: true,
  sessionTrackingIntervalMillis: 30000,
});
```

### 3. API Server Configuration

The API server has Sentry configured in `services/api/src/services/analytics.ts`:

```bash
# services/api/.env.production
SENTRY_DSN="https://your-api-dsn@sentry.io/project-id"
SENTRY_ENVIRONMENT="production"
SENTRY_TRACES_SAMPLE_RATE="0.1"
```

**Key Features Already Implemented:**
- Automatic error capture
- Breadcrumb tracking
- User context
- Custom context
- Performance monitoring

### 4. Sentry Alerts Configuration

**Recommended Alert Rules:**

1. **High Error Rate Alert**
   - Condition: Error count > 50 in 5 minutes
   - Notify: #alerts Slack channel
   - Priority: High

2. **Critical Errors**
   - Condition: Error level = 'fatal' or 'critical'
   - Notify: On-call engineer immediately
   - Priority: Critical

3. **Payment Errors**
   - Condition: Error contains 'stripe' or 'payment'
   - Notify: #payments Slack channel
   - Priority: High

4. **New Error Type**
   - Condition: First seen error
   - Notify: #engineering Slack channel
   - Priority: Medium

**Configure in Sentry Dashboard:**
```
Project Settings → Alerts → New Alert Rule
```

### 5. Sentry Performance Monitoring

**Transaction Sampling:**
```typescript
// Configure transaction sampling
{
  tracesSampleRate: 0.1, // Sample 10% of transactions
  
  // Custom sampling for specific operations
  tracesSampler: (samplingContext) => {
    if (samplingContext.transactionContext.name.includes('payment')) {
      return 1.0; // Sample 100% of payment transactions
    }
    return 0.1; // Default 10%
  }
}
```

**Track Performance:**
- API response times
- Database query performance
- External API call latency
- User interaction timing

---

## Analytics with Mixpanel

### 1. Mixpanel Setup

**Create Mixpanel Project:**
1. Go to [mixpanel.com](https://mixpanel.com)
2. Create a new project: "BountyExpo Production"
3. Get your project token

### 2. Configuration

```bash
# .env.production
EXPO_PUBLIC_MIXPANEL_TOKEN="your-mixpanel-token"
MIXPANEL_TOKEN="your-mixpanel-token"
```

**Already Integrated:**
- User tracking
- Event tracking
- User properties
- Custom events

### 3. Key Events to Track

**User Events:**
- User Registration
- User Login
- Profile Updated
- Email Verified

**Bounty Events:**
- Bounty Created
- Bounty Published
- Bounty Accepted
- Bounty Completed
- Bounty Cancelled

**Payment Events:**
- Payment Method Added
- Escrow Created
- Payment Released
- Payment Failed

**Engagement Events:**
- Message Sent
- Profile Viewed
- Search Performed
- Filter Applied

### 4. Mixpanel Dashboards

**Create Custom Dashboards:**

1. **User Acquisition Dashboard**
   - New users per day/week/month
   - User registration funnel
   - Activation rate
   - Retention cohorts

2. **Bounty Metrics Dashboard**
   - Bounties created
   - Bounties completed
   - Average bounty value
   - Time to completion

3. **Payment Health Dashboard**
   - Payment success rate
   - Failed payment reasons
   - Average transaction value
   - Payment method distribution

4. **Engagement Dashboard**
   - Daily/Monthly active users
   - Session duration
   - Feature usage
   - User retention

---

## Session Replay with LogRocket (Optional)

### 1. LogRocket Setup

LogRocket is included in dependencies but needs configuration:

```bash
npm install logrocket
npm install logrocket-react
```

### 2. Configuration

```typescript
// lib/services/logrocket.ts
import LogRocket from 'logrocket';

if (process.env.EXPO_PUBLIC_ENVIRONMENT === 'production') {
  LogRocket.init('your-app-id/bountyexpo');
  
  // Identify users
  LogRocket.identify(userId, {
    name: user.name,
    email: user.email,
  });
}
```

### 3. Integration with Sentry

```typescript
import LogRocket from 'logrocket';
import * as Sentry from '@sentry/react-native';

// Add LogRocket session URL to Sentry events
LogRocket.getSessionURL((sessionURL) => {
  Sentry.configureScope((scope) => {
    scope.setExtra('sessionURL', sessionURL);
  });
});
```

### 4. Privacy Considerations

**Sanitize sensitive data:**
```typescript
LogRocket.init('your-app-id/bountyexpo', {
  network: {
    requestSanitizer: (request) => {
      // Sanitize authorization headers
      if (request.headers.Authorization) {
        request.headers.Authorization = '[REDACTED]';
      }
      return request;
    },
  },
  dom: {
    inputSanitizer: true, // Sanitize all input fields
  },
});
```

---

## Health Checks and Uptime Monitoring

### 1. Health Check Endpoint

**Already Implemented in API:**
```typescript
// services/api/src/routes/health.ts
fastify.get('/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      supabase: await checkSupabase(),
    },
    version: process.env.npm_package_version,
  };
});
```

### 2. Uptime Monitoring Services

**Option 1: UptimeRobot (Free)**
- URL: https://uptimerobot.com
- Configure monitors:
  - https://api.bountyexpo.com/health (1-minute intervals)
  - https://app.bountyexpo.com (5-minute intervals)

**Option 2: StatusCake (Free tier available)**
- URL: https://www.statuscake.com
- More advanced monitoring options

**Option 3: AWS CloudWatch Synthetics**
- Create canary scripts
- Test critical user flows

### 3. Configure Alerts

**UptimeRobot Alert Settings:**
- Alert when: Down for 2 minutes
- Notify via: Email, Slack, SMS
- Check frequency: 1 minute

**CloudWatch Alarm:**
```yaml
HealthCheckAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: api-health-check
    MetricName: HealthCheckStatus
    Namespace: AWS/ApiGateway
    Statistic: Average
    Period: 60
    EvaluationPeriods: 2
    Threshold: 1
    ComparisonOperator: LessThanThreshold
    AlarmActions:
      - !Ref SNSTopic
```

---

## Performance Monitoring

### 1. API Performance Metrics

**Key Metrics to Track:**
- Response time (p50, p95, p99)
- Throughput (requests per second)
- Error rate
- Database query time
- Redis cache hit rate

**CloudWatch Metrics:**
```typescript
// services/api/src/middleware/metrics.ts
import { CloudWatch } from 'aws-sdk';

const cloudwatch = new CloudWatch();

export function trackMetric(metricName: string, value: number) {
  cloudwatch.putMetricData({
    Namespace: 'BountyExpo/API',
    MetricData: [{
      MetricName: metricName,
      Value: value,
      Unit: 'Count',
      Timestamp: new Date(),
    }],
  });
}
```

### 2. Frontend Performance

**Expo Insights** (Already integrated via `expo-insights`):
```typescript
import { usePerformanceMonitor } from 'expo-insights';

function App() {
  usePerformanceMonitor({
    enabled: process.env.EXPO_PUBLIC_ENVIRONMENT === 'production',
  });
}
```

### 3. Performance Budgets

**Set performance budgets:**
- API response time: < 500ms (p95)
- App launch time: < 3s
- Time to interactive: < 5s
- Bundle size: < 5MB

---

## Log Aggregation

### 1. Structured Logging

**API Server uses Pino (Already configured):**
```typescript
// services/api/src/config/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
});
```

### 2. Log Aggregation Services

**Option 1: CloudWatch Logs**
```bash
# Configure CloudWatch Logs agent
# Already configured in ECS task definition
```

**Option 2: DataDog**
```typescript
// Install DataDog agent
npm install dd-trace

// services/api/src/index.ts
import tracer from 'dd-trace';

tracer.init({
  logInjection: true,
  env: process.env.NODE_ENV,
  service: 'bountyexpo-api',
});
```

**Option 3: Logtail/BetterStack**
```bash
# Simple HTTP logging
LOGTAIL_SOURCE_TOKEN="your-token"
```

### 3. Log Retention

- **Development:** 7 days
- **Staging:** 30 days
- **Production:** 90 days

---

## Alerting Configuration

### 1. Alert Channels

**Slack Integration:**
```yaml
# slack-alerts.yml
channels:
  - name: alerts
    webhook: ${{ secrets.SLACK_WEBHOOK_ALERTS }}
  - name: incidents
    webhook: ${{ secrets.SLACK_WEBHOOK_INCIDENTS }}
  - name: deployments
    webhook: ${{ secrets.SLACK_WEBHOOK_DEPLOYMENTS }}
```

### 2. Alert Rules

**Critical Alerts (Page on-call):**
- API health check fails
- Error rate > 5%
- Database connection failures
- Payment processing errors

**High Priority Alerts (Slack notification):**
- Error rate > 2%
- Response time p95 > 1s
- Memory usage > 85%
- Disk usage > 80%

**Medium Priority Alerts (Slack notification, can wait):**
- Cache hit rate < 70%
- Unusual traffic patterns
- Failed background jobs

### 3. On-Call Schedule

**Set up PagerDuty or similar:**
```yaml
# pagerduty-schedule.yml
escalation_policy:
  - level: 1
    delay_minutes: 5
    targets:
      - type: user
        id: primary_oncall
  - level: 2
    delay_minutes: 10
    targets:
      - type: user
        id: secondary_oncall
```

---

## Incident Response

### 1. Incident Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| P0 | Critical - Complete outage | 5 minutes | Immediately page on-call |
| P1 | High - Major functionality broken | 30 minutes | Alert team lead |
| P2 | Medium - Degraded performance | 4 hours | Normal business hours |
| P3 | Low - Minor issues | Next business day | Backlog |

### 2. Incident Response Runbook

**Step 1: Detection**
- Alert triggers
- Acknowledge within 5 minutes

**Step 2: Investigation**
- Check Sentry for errors
- Review CloudWatch metrics
- Check health endpoints
- Review recent deployments

**Step 3: Mitigation**
- Apply fix if known
- Rollback if needed
- Scale resources if needed

**Step 4: Communication**
- Update status page
- Notify stakeholders
- Post in #incidents

**Step 5: Resolution**
- Verify fix
- Monitor for 30 minutes
- Close incident

**Step 6: Post-Mortem**
- Document incident
- Root cause analysis
- Action items

### 3. Rollback Procedures

**API Rollback:**
```bash
# Roll back to previous Docker image
docker pull ghcr.io/kodaksax/bountyexpo-api:previous-tag
# Redeploy

# Or via ECS
aws ecs update-service \
  --cluster bountyexpo-prod \
  --service api \
  --task-definition bountyexpo-api:previous-revision
```

**Mobile App Rollback:**
```bash
# Roll back OTA update
eas update:republish --channel production --group previous-group-id
```

---

## Metrics and KPIs

### 1. Technical Metrics

**Availability:**
- Target: 99.9% uptime
- Measure: (Total time - Downtime) / Total time

**Performance:**
- API response time p95: < 500ms
- API response time p99: < 1s
- App launch time: < 3s

**Reliability:**
- Error rate: < 0.1%
- API success rate: > 99.9%
- Payment success rate: > 99%

### 2. Business Metrics

**User Metrics:**
- Daily Active Users (DAU)
- Monthly Active Users (MAU)
- User retention (Day 1, Day 7, Day 30)
- Average session duration

**Bounty Metrics:**
- Bounties created per day
- Bounties completed per day
- Average time to completion
- Completion rate

**Revenue Metrics:**
- Total transaction volume
- Average transaction value
- Payment success rate
- Stripe fees

### 3. Dashboard Setup

**Create Grafana/DataDog Dashboard:**
```yaml
# dashboard.json
{
  "dashboard": {
    "title": "BountyExpo Production",
    "panels": [
      {
        "title": "API Response Time",
        "type": "graph",
        "targets": ["response_time_p95"]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": ["error_rate"]
      },
      {
        "title": "Active Users",
        "type": "stat",
        "targets": ["active_users"]
      }
    ]
  }
}
```

---

## Quick Reference

### Key URLs
- **Sentry:** https://sentry.io/organizations/your-org/projects/
- **Mixpanel:** https://mixpanel.com/project/your-project/
- **API Health:** https://api.bountyexpo.com/health
- **Status Page:** https://status.bountyexpo.com (if configured)

### Emergency Contacts
- On-call engineer: PagerDuty
- Team lead: Slack @team-lead
- DevOps: devops@bountyexpo.com

### Common Commands
```bash
# Check API health
curl https://api.bountyexpo.com/health

# View recent errors in Sentry
open https://sentry.io/organizations/your-org/projects/bountyexpo-api/

# Check CloudWatch logs
aws logs tail /aws/ecs/bountyexpo-api --follow

# Rollback deployment
eas update:republish --channel production --group previous-id
```

---

**Questions?** Contact: devops@bountyexpo.com
