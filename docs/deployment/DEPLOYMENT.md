# BountyExpo Deployment Guide

> Comprehensive guide for deploying BountyExpo to production

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Infrastructure Setup](#infrastructure-setup)
- [Environment Configuration](#environment-configuration)
- [Database Deployment](#database-deployment)
- [API Server Deployment](#api-server-deployment)
- [Mobile App Deployment](#mobile-app-deployment)
- [Monitoring & Logging](#monitoring--logging)
- [Backup & Recovery](#backup--recovery)
- [Scaling Strategy](#scaling-strategy)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)

---

## Overview

BountyExpo consists of three main deployable components:

1. **Backend API** (Fastify server)
2. **Mobile App** (React Native via Expo)
3. **Infrastructure** (PostgreSQL, Redis, Supabase)

### Deployment Architecture

```
Production Environment

┌─────────────────────────────────────────┐
│         Content Delivery Network         │
│              (CloudFront)                │
└────────────┬────────────────────────────┘
             │
┌────────────┴────────────────────────────┐
│         Application Load Balancer        │
│         (AWS ALB / Nginx)               │
└────────┬───────────────┬────────────────┘
         │               │
    ┌────┴────┐     ┌────┴────┐
    │  API #1 │     │  API #2 │
    │  (ECS)  │     │  (ECS)  │
    └────┬────┘     └────┬────┘
         │               │
    ┌────┴───────────────┴────────┐
    │                              │
┌───┴──────┐  ┌──────────┐  ┌────┴──────┐
│PostgreSQL│  │  Redis   │  │ Supabase  │
│   RDS    │  │ElastiCache│  │  Cloud   │
└──────────┘  └──────────┘  └───────────┘
```

---

## Prerequisites

### Required Accounts & Services

- [ ] AWS Account (or alternative cloud provider)
- [ ] Supabase Account and Project
- [ ] Stripe Account (with API keys)
- [ ] Expo Account (for EAS builds)
- [ ] Domain name registered
- [ ] GitHub Account (for CI/CD)
- [ ] Monitoring service (DataDog, New Relic, or similar)

### Required Tools

```bash
# Install required CLI tools
npm install -g eas-cli      # Expo Application Services
npm install -g pnpm         # Package manager
# Install Docker for local testing
# Install AWS CLI or equivalent cloud CLI
```

---

## Infrastructure Setup

### Option 1: AWS Deployment

#### 1. Database (RDS PostgreSQL)

```bash
# Create PostgreSQL RDS instance
aws rds create-db-instance \
  --db-instance-identifier bountyexpo-prod \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.3 \
  --master-username bountyexpo \
  --master-user-password <secure-password> \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxxxx \
  --db-subnet-group-name bountyexpo-subnet \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "mon:04:00-mon:05:00" \
  --multi-az \
  --storage-encrypted \
  --publicly-accessible false
```

**Configuration:**
- Instance type: `db.t3.medium` (2 vCPU, 4 GB RAM) for start
- Storage: 20 GB with autoscaling enabled
- Multi-AZ: Yes (for high availability)
- Backup retention: 7 days
- Encryption: Enabled

#### 2. Cache (ElastiCache Redis)

```bash
# Create Redis cluster
aws elasticache create-replication-group \
  --replication-group-id bountyexpo-redis \
  --replication-group-description "BountyExpo Redis Cache" \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-clusters 2 \
  --automatic-failover-enabled \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled \
  --auth-token <secure-token> \
  --cache-subnet-group-name bountyexpo-cache-subnet \
  --security-group-ids sg-xxxxx
```

**Configuration:**
- Node type: `cache.t3.micro` (2 vCPU, 0.5 GB RAM)
- Nodes: 2 (primary + replica)
- Automatic failover: Enabled
- Encryption: At rest and in transit

#### 3. Container Service (ECS Fargate)

**Create ECS Cluster:**
```bash
aws ecs create-cluster --cluster-name bountyexpo-prod
```

**Task Definition** (`task-definition.json`):
```json
{
  "family": "bountyexpo-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "your-registry/bountyexpo-api:latest",
      "portMappings": [
        {
          "containerPort": 3001,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:database-url"
        },
        {
          "name": "STRIPE_SECRET_KEY",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:stripe-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/bountyexpo-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "api"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3001/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

**Register Task:**
```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

**Create Service:**
```bash
aws ecs create-service \
  --cluster bountyexpo-prod \
  --service-name bountyexpo-api \
  --task-definition bountyexpo-api \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=api,containerPort=3001" \
  --health-check-grace-period-seconds 60
```

#### 4. Load Balancer

```bash
# Create Application Load Balancer
aws elbv2 create-load-balancer \
  --name bountyexpo-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx \
  --scheme internet-facing \
  --type application

# Create Target Group
aws elbv2 create-target-group \
  --name bountyexpo-api-tg \
  --protocol HTTP \
  --port 3001 \
  --vpc-id vpc-xxx \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30

# Create Listener
aws elbv2 create-listener \
  --load-balancer-arn <alb-arn> \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=<certificate-arn> \
  --default-actions Type=forward,TargetGroupArn=<target-group-arn>
```

### Option 2: Docker Compose (Smaller Deployments)

**`docker-compose.prod.yml`:**
```yaml
version: '3.8'

services:
  api:
    image: bountyexpo/api:latest
    restart: always
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M

  postgres:
    image: postgres:15-alpine
    restart: always
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=bountyexpo
      - POSTGRES_USER=bountyexpo
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bountyexpo"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:
```

**Deploy:**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Environment Configuration

### Backend API Environment Variables

Create a `.env.production` file:

```bash
# Node Environment
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://user:password@db-host:5432/bountyexpo
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_ENABLED=true
REDIS_TTL_PROFILE=300
REDIS_TTL_BOUNTY=180
REDIS_TTL_BOUNTY_LIST=60

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# CORS
CORS_ORIGIN=https://app.bountyexpo.com,https://bountyexpo.com

# Security
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_AUTH_MAX=5
```

### Mobile App Environment Variables

**For EAS builds**, set variables in `eas.json`:

```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.bountyexpo.com",
        "EXPO_PUBLIC_SUPABASE_URL": "https://your-project.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your-anon-key",
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_live_xxxxx",
        "EXPO_PUBLIC_ENVIRONMENT": "production"
      }
    }
  }
}
```

---

## Database Deployment

### 1. Run Migrations

```bash
# From services/api directory
cd services/api

# Run migrations on production database
DATABASE_URL="postgresql://..." pnpm db:migrate
```

### 2. Seed Initial Data (if needed)

```bash
# Seed categories, system users, etc.
DATABASE_URL="postgresql://..." pnpm db:seed:production
```

### 3. Set up Backups

**Automated Daily Backups:**
```bash
# Cron job for daily backups
0 2 * * * /usr/local/bin/pg_dump -h db-host -U bountyexpo -d bountyexpo | gzip > /backups/bountyexpo-$(date +\%Y\%m\%d).sql.gz
```

**RDS Automated Backups:**
- Already configured with 7-day retention
- Point-in-time recovery enabled
- Snapshots taken daily during backup window

---

## API Server Deployment

### Build Docker Image

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY services ./services

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm --filter @bountyexpo/api build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/services/api/dist ./dist
COPY --from=builder /app/services/api/package.json ./
COPY --from=builder /app/services/api/node_modules ./node_modules

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "dist/index.js"]
```

**Build and Push:**
```bash
# Build image
docker build -t bountyexpo/api:latest -f services/api/Dockerfile .

# Tag for registry
docker tag bountyexpo/api:latest your-registry.com/bountyexpo/api:latest

# Push to registry
docker push your-registry.com/bountyexpo/api:latest
```

### Deploy with CI/CD

**GitHub Actions** (`.github/workflows/deploy-api.yml`):

```yaml
name: Deploy API

on:
  push:
    branches: [main]
    paths:
      - 'services/api/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1
      
      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/bountyexpo-api:$IMAGE_TAG -f services/api/Dockerfile .
          docker push $ECR_REGISTRY/bountyexpo-api:$IMAGE_TAG
          docker tag $ECR_REGISTRY/bountyexpo-api:$IMAGE_TAG $ECR_REGISTRY/bountyexpo-api:latest
          docker push $ECR_REGISTRY/bountyexpo-api:latest
      
      - name: Update ECS service
        run: |
          aws ecs update-service \
            --cluster bountyexpo-prod \
            --service bountyexpo-api \
            --force-new-deployment
```

---

## Mobile App Deployment

### Build Configuration (`eas.json`)

```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.bountyexpo.com",
        "EXPO_PUBLIC_SUPABASE_URL": "https://your-project.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your-anon-key",
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_live_xxxxx"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      },
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "production"
      }
    }
  }
}
```

### Build and Submit

```bash
# Login to Expo
eas login

# Build for iOS
eas build --platform ios --profile production

# Build for Android
eas build --platform android --profile production

# Submit to App Store
eas submit --platform ios --latest

# Submit to Google Play
eas submit --platform android --latest
```

### OTA Updates

```bash
# Publish an update
eas update --branch production --message "Bug fixes and improvements"

# Check update status
eas update:view
```

---

## Monitoring & Logging

### Application Monitoring

**Sentry Integration:**
```typescript
// services/api/src/index.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});
```

### Logging

**Structured Logging:**
```typescript
// Use Fastify's built-in logger
fastify.log.info({ userId, bountyId }, 'Bounty created');
fastify.log.error({ err, userId }, 'Payment failed');
```

**Log Aggregation:**
- AWS CloudWatch Logs
- Datadog
- LogRocket

### Metrics to Monitor

| Metric | Alert Threshold |
|--------|----------------|
| API Response Time (p95) | > 500ms |
| Error Rate | > 5% |
| Database Connection Pool | > 80% utilization |
| Redis Hit Rate | < 70% |
| Memory Usage | > 85% |
| CPU Usage | > 80% |

### Health Checks

```typescript
// services/api/src/routes/health.ts
fastify.get('/health', async () => {
  const dbHealthy = await checkDatabase();
  const redisHealthy = await checkRedis();
  
  return {
    status: dbHealthy && redisHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'healthy' : 'unhealthy',
      redis: redisHealthy ? 'healthy' : 'unhealthy'
    }
  };
});
```

---

## Backup & Recovery

### Database Backups

**Automated Backups:**
- RDS automatic backups (7-day retention)
- Manual snapshots before major changes
- Export to S3 for long-term storage

**Backup Script:**
```bash
#!/bin/bash
# backup-db.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="bountyexpo_backup_$DATE.sql.gz"

# Dump database
pg_dump -h $DB_HOST -U $DB_USER -d bountyexpo | gzip > $BACKUP_FILE

# Upload to S3
aws s3 cp $BACKUP_FILE s3://bountyexpo-backups/database/

# Clean up old backups (keep 30 days)
find /backups -name "bountyexpo_backup_*.sql.gz" -mtime +30 -delete
```

### Disaster Recovery

**Recovery Time Objective (RTO):** 1 hour  
**Recovery Point Objective (RPO):** 15 minutes

**Recovery Steps:**
1. Restore database from latest snapshot
2. Deploy API containers from last known good image
3. Update DNS if needed
4. Verify health checks
5. Resume traffic

---

## Scaling Strategy

### Horizontal Scaling

**API Servers:**
- Auto-scaling based on CPU/memory
- Min: 2 instances
- Max: 10 instances
- Scale up: CPU > 70% for 2 minutes
- Scale down: CPU < 30% for 5 minutes

**Database:**
- Start with single instance
- Add read replicas as traffic grows
- Consider Aurora Serverless for auto-scaling

### Vertical Scaling

**When to scale up:**
- Consistent high CPU/memory usage
- Query performance degradation
- Connection pool exhaustion

### Caching Strategy

- Implement Redis caching (already done)
- Use CDN for static assets
- Client-side caching with React Query

---

## Security Checklist

- [ ] HTTPS enforced (redirect HTTP to HTTPS)
- [ ] Database encryption at rest enabled
- [ ] Database connections use SSL
- [ ] Secrets stored in AWS Secrets Manager / equivalent
- [ ] Security groups restrict access (principle of least privilege)
- [ ] API rate limiting enabled
- [ ] CORS configured correctly
- [ ] Helmet.js security headers enabled
- [ ] SQL injection prevention (using ORM)
- [ ] XSS prevention (input sanitization)
- [ ] CSRF protection enabled
- [ ] Authentication tokens expire appropriately
- [ ] Audit logging enabled
- [ ] Regular security updates applied
- [ ] Penetration testing completed
- [ ] DDoS protection enabled (CloudFlare/AWS Shield)

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

**Symptoms:** API returns 503, logs show connection errors

**Solutions:**
```bash
# Check database status
aws rds describe-db-instances --db-instance-identifier bountyexpo-prod

# Check security group rules
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Test connection from API container
psql -h db-host -U bountyexpo -d bountyexpo
```

#### 2. High API Latency

**Symptoms:** Slow response times, timeouts

**Solutions:**
- Check CloudWatch metrics for CPU/memory
- Review slow query logs
- Verify Redis cache hit rate
- Check database connection pool
- Scale up if needed

#### 3. Failed Deployments

**Symptoms:** ECS service unable to reach steady state

**Solutions:**
```bash
# Check service events
aws ecs describe-services --cluster bountyexpo-prod --services bountyexpo-api

# Check task logs
aws logs tail /ecs/bountyexpo-api --follow

# Rollback to previous task definition
aws ecs update-service \
  --cluster bountyexpo-prod \
  --service bountyexpo-api \
  --task-definition bountyexpo-api:previous-revision
```

#### 4. Mobile App Update Issues

**Symptoms:** Users not receiving OTA updates

**Solutions:**
```bash
# Check update status
eas update:view

# Force republish
eas update --branch production --message "Force update"

# Check app version in Expo dashboard
```

---

## Rollback Procedures

### API Rollback

```bash
# Rollback to previous task definition
aws ecs update-service \
  --cluster bountyexpo-prod \
  --service bountyexpo-api \
  --task-definition bountyexpo-api:previous-version

# Or rollback via Docker image
docker pull your-registry/bountyexpo-api:previous-tag
# Redeploy
```

### Database Rollback

```bash
# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier bountyexpo-prod-restored \
  --db-snapshot-identifier bountyexpo-prod-snapshot-date

# Or restore to point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier bountyexpo-prod \
  --target-db-instance-identifier bountyexpo-prod-restored \
  --restore-time 2024-01-01T12:00:00Z
```

---

## Post-Deployment Checklist

- [ ] Health endpoints return 200 OK
- [ ] Database migrations completed successfully
- [ ] Redis cache is operational
- [ ] Authentication flows work correctly
- [ ] Payment processing functional (test transaction)
- [ ] WebSocket connections establish
- [ ] Mobile app can connect to API
- [ ] Monitoring dashboards show green status
- [ ] Alerts are configured and tested
- [ ] Backups are running on schedule
- [ ] SSL certificates are valid and not expiring soon
- [ ] DNS records point to correct endpoints
- [ ] Load balancer health checks passing
- [ ] Auto-scaling policies configured
- [ ] Documentation updated with production URLs

---

## Support & Escalation

### On-Call Procedures

1. **Incident Detection** - Alerts trigger via PagerDuty/similar
2. **Initial Response** - Acknowledge within 5 minutes
3. **Investigation** - Check logs, metrics, health endpoints
4. **Mitigation** - Apply fix or rollback
5. **Communication** - Update status page, notify stakeholders
6. **Resolution** - Confirm issue resolved
7. **Post-Mortem** - Document incident and lessons learned

### Escalation Matrix

| Severity | Response Time | Escalation |
|----------|--------------|------------|
| P0 (Critical) | 5 minutes | CTO, Engineering Lead |
| P1 (High) | 30 minutes | Engineering Lead |
| P2 (Medium) | 4 hours | On-call engineer |
| P3 (Low) | Next business day | Backlog |

---

**Questions or issues?** Contact: devops@bountyexpo.com
