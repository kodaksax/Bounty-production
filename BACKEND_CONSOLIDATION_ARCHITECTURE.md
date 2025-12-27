# Backend Consolidation Architecture

## Executive Summary

This document outlines the consolidated backend architecture for BOUNTYExpo, consolidating three separate backend services into a single, unified, scalable service that improves network reliability, maintainability, and performance.

## Current State Problems

### Multiple Backend Services
1. **api/server.js** (Legacy Express - 1651 lines)
   - Handles: Auth, profiles, bounties, bounty requests, reports
   - Database: MySQL/SQLite with manual connection management
   - Issues: Duplicate auth logic, inconsistent error handling, no structured logging

2. **services/api/src/index.ts** (Modern Fastify - 944 lines)
   - Handles: Payments, wallet, messaging, analytics, risk management, notifications
   - Database: PostgreSQL with Drizzle ORM
   - Issues: Separate from core endpoints, different tech stack

3. **server/index.js** (Payment Express - 1459 lines)
   - Handles: Stripe payments, Connect, webhooks, Apple Pay, wallet
   - Database: Supabase
   - Issues: Duplicates payment logic from Fastify service, separate process

### Key Issues
- **Code Duplication**: ~40% duplication in auth, payment, and wallet logic
- **Inconsistent Patterns**: Three different auth implementations, two database patterns
- **Network Inefficiency**: Multiple servers, multiple ports, increased latency
- **Maintenance Burden**: Changes require updates in multiple places
- **Scalability Challenges**: No unified configuration or monitoring
- **Security Gaps**: Inconsistent rate limiting and input validation

## Proposed Unified Architecture

### Single Fastify Service (Enhanced)

```
┌─────────────────────────────────────────────────────────┐
│            Unified BOUNTYExpo Backend API               │
│                    (Fastify Core)                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Global Middleware Layer                  │ │
│  │  • Request Logging (Pino)                       │ │
│  │  • CORS Configuration                           │ │
│  │  • Rate Limiting (Global & Per-Route)          │ │
│  │  • Request ID Generation                       │ │
│  │  • Error Handler                               │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Authentication Layer                     │ │
│  │  • Supabase JWT Verification                   │ │
│  │  • Token Validation & Refresh                  │ │
│  │  • User Context Injection                      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Route Modules (Feature-Based)            │ │
│  │                                                  │ │
│  │  Core:                                          │ │
│  │    /auth/*        - Authentication & Sessions   │ │
│  │    /profiles/*    - User Profiles & Settings    │ │
│  │    /bounties/*    - Bounty CRUD & Transitions  │ │
│  │    /requests/*    - Bounty Applications         │ │
│  │                                                  │ │
│  │  Financial:                                     │ │
│  │    /payments/*    - Payment Intent & Methods    │ │
│  │    /wallet/*      - Wallet & Transactions       │ │
│  │    /connect/*     - Stripe Connect              │ │
│  │    /webhooks/*    - Payment Webhooks            │ │
│  │    /apple-pay/*   - Apple Pay Integration      │ │
│  │                                                  │ │
│  │  Messaging:                                     │ │
│  │    /conversations/* - Chat & Messages          │ │
│  │    /ws/messages   - WebSocket Messaging        │ │
│  │                                                  │ │
│  │  Advanced:                                      │ │
│  │    /analytics/*   - Usage Analytics             │ │
│  │    /notifications/* - Push Notifications        │ │
│  │    /search/*      - Search Functionality        │ │
│  │    /admin/*       - Admin Operations            │ │
│  │    /risk/*        - Risk Management             │ │
│  │                                                  │ │
│  │  Monitoring:                                    │ │
│  │    /health        - Health Checks               │ │
│  │    /metrics       - Service Metrics             │ │
│  │    /debug         - Debug Information           │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Service Layer                            │ │
│  │  • BountyService                                │ │
│  │  • WalletService                                │ │
│  │  • PaymentService (Consolidated)                │ │
│  │  • NotificationService                          │ │
│  │  • MessagingService                             │ │
│  │  • AnalyticsService                             │ │
│  │  • RiskManagementService                        │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Data Access Layer                        │ │
│  │  • Supabase Client (Admin & User contexts)      │ │
│  │  • Database Connection Pool (Postgres)          │ │
│  │  • Drizzle ORM                                  │ │
│  │  • Query Builders & Helpers                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Background Workers                       │ │
│  │  • Outbox Pattern Worker                        │ │
│  │  • Risk Assessment Cron                         │ │
│  │  • Stale Bounty Detection                       │ │
│  │  • Analytics Aggregation                        │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘

         ↓                    ↓                    ↓
    
  Supabase Auth      PostgreSQL DB        External APIs
  (User Mgmt)         (App Data)         (Stripe, Mixpanel)
```

## Implementation Phases

### Phase 1: Foundation & Core Services (High Priority)
**Goal**: Establish unified service foundation with core endpoints

**Tasks**:
1. Create unified configuration management system
   - Environment variable consolidation
   - Feature flags
   - Runtime configuration updates

2. Consolidate authentication middleware
   - Single Supabase JWT verification
   - Consistent token handling
   - Unified user context injection

3. Merge database connection patterns
   - Single PostgreSQL connection pool
   - Unified Supabase client initialization
   - Connection health monitoring

4. Consolidate core routes
   - Auth endpoints (sign-up, sign-in, password reset)
   - Profile endpoints (CRUD operations)
   - Bounty endpoints (CRUD + transitions)
   - Bounty request endpoints

5. Unify error handling
   - Global error handler with consistent format
   - Error categorization (client/server/validation)
   - Structured error logging

**Success Metrics**:
- Single backend process serving all core endpoints
- <100ms average response time for core endpoints
- Zero authentication inconsistencies
- 100% test coverage for auth flow

### Phase 2: Payment & Financial Services (High Priority)
**Goal**: Consolidate all payment-related functionality

**Tasks**:
1. Create unified PaymentService
   - Merge payment intent creation logic
   - Consolidate payment method management
   - Unified 3D Secure handling

2. Create unified WalletService
   - Merge wallet balance operations
   - Consolidate transaction history
   - Unified escrow logic

3. Consolidate Stripe Connect
   - Single onboarding flow
   - Unified account verification
   - Consolidated transfer logic

4. Merge webhook handling
   - Single webhook endpoint
   - Event deduplication
   - Idempotent processing

5. Consolidate Apple Pay
   - Unified payment intent flow
   - Consistent confirmation handling

**Success Metrics**:
- Zero payment logic duplication
- <500ms p95 payment intent creation
- 100% webhook delivery success
- Atomic wallet transactions

### Phase 3: Real-time & Messaging (Medium Priority)
**Goal**: Ensure WebSocket and messaging services are properly integrated

**Tasks**:
1. Verify WebSocket integration
   - Messaging service
   - Real-time events
   - Presence tracking

2. Optimize connection handling
   - Connection pooling
   - Reconnection logic
   - Message queuing

3. Add monitoring
   - Active connection count
   - Message delivery rate
   - Connection errors

**Success Metrics**:
- <100ms message delivery (p95)
- >99.9% message delivery success
- Support for 10,000+ concurrent connections

### Phase 4: Advanced Features (Medium Priority)
**Goal**: Integrate analytics, notifications, and admin features

**Tasks**:
1. Integrate analytics service
   - Event tracking
   - Aggregation jobs
   - Reporting endpoints

2. Consolidate notification service
   - Push notification handling
   - Email notifications
   - In-app notifications

3. Integrate admin features
   - Content moderation
   - User management
   - System configuration

4. Integrate risk management
   - Risk scoring
   - Fraud detection
   - Automated remediation

**Success Metrics**:
- Real-time analytics updates
- <1s notification delivery
- Comprehensive admin dashboard

### Phase 5: Optimization & Monitoring (Lower Priority)
**Goal**: Enhance performance and observability

**Tasks**:
1. Add comprehensive metrics
   - Request latency histograms
   - Error rates by endpoint
   - Database query performance
   - External API latency

2. Implement distributed tracing
   - Request ID propagation
   - Span creation for key operations
   - Trace sampling

3. Add performance monitoring
   - Response time SLAs
   - Database connection pool utilization
   - Memory usage tracking

4. Implement caching strategy
   - Redis integration for frequently accessed data
   - Cache invalidation patterns
   - Cache hit rate monitoring

**Success Metrics**:
- <200ms p95 response time for all endpoints
- <1% error rate
- >95% cache hit rate for profiles
- Full request tracing

### Phase 6: Security Hardening (Ongoing)
**Goal**: Ensure comprehensive security across all endpoints

**Tasks**:
1. Audit rate limiting
   - Per-user rate limits
   - Per-endpoint rate limits
   - Adaptive rate limiting for suspicious patterns

2. Input validation consolidation
   - Unified Zod schemas
   - SQL injection prevention
   - XSS prevention

3. Security headers
   - HSTS
   - CSP
   - X-Frame-Options

4. Secrets management
   - Environment variable validation
   - Secret rotation procedures
   - Audit logging

**Success Metrics**:
- Zero SQL injection vulnerabilities
- Zero XSS vulnerabilities
- All endpoints rate-limited
- Security headers on all responses

## Technical Benefits

### Network Reliability
1. **Single Point of Access**
   - One backend server instead of three
   - Simplified load balancing
   - Easier to scale horizontally

2. **Connection Pooling**
   - Efficient database connection reuse
   - Reduced connection overhead
   - Better resource utilization

3. **Consistent Error Handling**
   - Predictable error responses
   - Better client-side error recovery
   - Improved debugging

### Performance Improvements
1. **Reduced Latency**
   - Fewer network hops between services
   - Shared connection pools
   - Optimized data access patterns

2. **Better Resource Utilization**
   - Single process = less memory overhead
   - Shared caches
   - Efficient worker threads

3. **Scalability**
   - Horizontal scaling simplified
   - Better load distribution
   - Easier capacity planning

### Maintainability
1. **Code Consolidation**
   - ~30% reduction in backend code
   - Single authentication pattern
   - Unified logging and monitoring

2. **Easier Updates**
   - Changes in one place
   - Consistent deployment process
   - Simplified testing

3. **Better Developer Experience**
   - Single codebase to understand
   - Consistent patterns
   - Easier onboarding

## Migration Strategy

### Backward Compatibility
- Keep legacy endpoints during transition
- Add deprecation warnings
- Gradual client migration

### Testing Strategy
1. **Unit Tests**: All service methods
2. **Integration Tests**: End-to-end flows
3. **Load Tests**: Performance benchmarks
4. **Security Tests**: Vulnerability scans

### Rollout Plan
1. Deploy consolidated service alongside existing services
2. Gradually migrate traffic via feature flags
3. Monitor metrics and error rates
4. Complete migration when metrics stable
5. Decommission old services

## Configuration Management

### Environment Variables
```env
# Service Configuration
PORT=3001
HOST=0.0.0.0
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/bountyexpo
DB_POOL_MIN=2
DB_POOL_MAX=10

# Supabase
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
SUPABASE_ANON_KEY=xxx

# Stripe
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CONNECT_CLIENT_ID=ca_xxx

# External Services
MIXPANEL_TOKEN=xxx
SENTRY_DSN=xxx

# Feature Flags
ENABLE_ANALYTICS=true
ENABLE_RISK_MANAGEMENT=true
ENABLE_NOTIFICATIONS=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
PAYMENT_RATE_LIMIT_MAX=10
```

### Runtime Configuration
- Feature flags for gradual rollouts
- A/B testing support
- Emergency kill switches

## Monitoring & Observability

### Key Metrics
1. **Request Metrics**
   - Request rate (req/s)
   - Response time (p50, p95, p99)
   - Error rate by endpoint

2. **Business Metrics**
   - Bounties created/hour
   - Payments processed/hour
   - Active users

3. **Infrastructure Metrics**
   - CPU usage
   - Memory usage
   - Database connection pool utilization

### Alerts
1. **Critical**
   - Error rate >5%
   - Response time p95 >1s
   - Database connection failures

2. **Warning**
   - Error rate >1%
   - Response time p95 >500ms
   - High memory usage (>80%)

3. **Info**
   - Deployment completed
   - Configuration changed
   - Scheduled job completed

## Security Considerations

### Authentication
- JWT token validation on all protected routes
- Token expiry and refresh handling
- Rate limiting on auth endpoints

### Authorization
- Role-based access control (RBAC)
- Resource ownership verification
- Admin privilege checks

### Data Protection
- Input sanitization on all endpoints
- SQL injection prevention via parameterized queries
- XSS prevention via Content Security Policy

### Audit Logging
- Authentication events
- Authorization failures
- Payment transactions
- Admin actions

## Disaster Recovery

### Backup Strategy
- Automated database backups (hourly)
- Transaction log archival
- Configuration backups

### Recovery Procedures
1. Database restoration from backup
2. Service restart with health checks
3. Traffic gradual ramp-up
4. Monitoring for anomalies

### High Availability
- Multi-zone deployment
- Auto-scaling policies
- Health check endpoints
- Graceful degradation

## Success Criteria

### Phase 1 Complete When:
- [ ] Single backend serving core endpoints
- [ ] Zero authentication inconsistencies
- [ ] All tests passing
- [ ] Documentation updated

### Phase 2 Complete When:
- [ ] All payment endpoints consolidated
- [ ] Zero payment logic duplication
- [ ] Webhook processing reliable
- [ ] Performance benchmarks met

### Full Consolidation Complete When:
- [ ] All three original services decommissioned
- [ ] >99.9% uptime for 30 days
- [ ] <200ms p95 response time
- [ ] Zero critical security vulnerabilities
- [ ] Complete monitoring and alerting
- [ ] Team trained on new architecture

## Timeline

- **Phase 1**: 2-3 days
- **Phase 2**: 2-3 days
- **Phase 3**: 1-2 days
- **Phase 4**: 1-2 days
- **Phase 5**: 1-2 days
- **Phase 6**: Ongoing

**Total Estimated Time**: 7-12 days for complete consolidation

## Risks & Mitigation

### Risk: Data Loss During Migration
**Mitigation**: 
- Thorough testing in staging environment
- Database backups before cutover
- Gradual traffic migration
- Rollback plan

### Risk: Performance Degradation
**Mitigation**:
- Load testing before production
- Performance benchmarks
- Monitoring and alerting
- Auto-scaling configuration

### Risk: Breaking Changes for Clients
**Mitigation**:
- Maintain backward compatibility
- Versioned API endpoints
- Deprecation warnings
- Client migration guide

### Risk: Security Vulnerabilities
**Mitigation**:
- Security audit before launch
- Input validation on all endpoints
- Rate limiting
- Regular security scans

## Conclusion

This consolidated architecture will significantly improve BOUNTYExpo's backend reliability, performance, and maintainability. By consolidating three separate services into one unified Fastify service, we eliminate code duplication, improve network efficiency, and create a more maintainable and scalable foundation for future growth.
