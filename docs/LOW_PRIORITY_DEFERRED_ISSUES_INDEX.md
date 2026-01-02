# Low Priority Deferred Issues - Index

## Overview

This document serves as an index for four low-priority deferred issues that have been documented for future implementation. These items provide value but are not critical for current operations.

## Purpose

These issues are **deferred by design** - they represent preventive measures, minor optimizations, and quality improvements that should be implemented only when:

1. There is clear signal from production metrics indicating the need
2. Team has available bandwidth after higher-priority work
3. The specific issue is causing measurable user or operational pain

## Issues Documented

### 1. Document Async Ordering ✅ Complete

**Location:** [docs/ASYNC_ORDERING_GUIDE.md](./ASYNC_ORDERING_GUIDE.md)

**Value:** Prevents future bugs from parallelizing profile → Stripe operations  
**Impact:** Protects against regression during refactoring  
**Current State:** Code works correctly, now documented  
**When Needed:** Before onboarding new engineers  
**ROI:** Low - preventive documentation  

**Summary:**
Comprehensive documentation explaining why profile creation must happen before Stripe operations (customer/Connect account creation). Includes real-world examples from the codebase, common pitfalls, best practices, and testing strategies.

**Key Topics:**
- Why sequential ordering matters
- Race condition prevention
- Correct vs incorrect patterns
- Real examples from codebase
- Testing strategies
- Migration guide for new engineers

---

### 2. Optimize Stripe Customer Creation 📋 Planned

**Location:** [docs/STRIPE_CUSTOMER_OPTIMIZATION_GUIDE.md](./STRIPE_CUSTOMER_OPTIMIZATION_GUIDE.md)

**Value:** Creates Stripe customer at signup (not first payment)  
**Impact:** Slightly faster first payment (saves 200-300ms), better data consistency  
**Current State:** Deferred creation works but adds latency to first transaction  
**When Needed:** If first-payment latency becomes user complaint  
**ROI:** Low - minor UX improvement  

**Summary:**
Detailed implementation plan for moving Stripe customer creation from first payment (lazy) to signup (eager). Includes current vs optimized flow diagrams, performance analysis, phased implementation plan, testing strategy, and rollback procedures.

**Key Topics:**
- Current lazy creation pattern
- Optimized eager creation approach
- Performance comparison
- Step-by-step implementation plan
- Feature flag strategy
- Success metrics and monitoring

---

### 3. Enhance Rate Limiting 📋 Documented

**Location:** [docs/RATE_LIMITING_ENHANCEMENT_GUIDE.md](./RATE_LIMITING_ENHANCEMENT_GUIDE.md)

**Value:** Backend-coordinated rate limiting + CAPTCHA after failures  
**Impact:** Better brute-force protection  
**Current State:** Client-side rate limiting + Supabase built-in protection  
**When Needed:** If seeing credential stuffing attacks  
**ROI:** Low - defense in depth (already have basic protection)  

**Summary:**
Comprehensive guide to current rate limiting implementation and future enhancements. Documents the existing multi-layered defense system and provides implementation sketches for Redis-coordinated rate limiting, CAPTCHA integration, progressive limits, and account blocking.

**Key Topics:**
- Current multi-layer protection
- Enhancement options (Redis, CAPTCHA, progressive limits)
- When to implement each enhancement
- Architecture diagrams
- Implementation code sketches
- Monitoring and testing strategies

---

### 4. Standardize Analytics 📋 Documented

**Location:** [docs/ANALYTICS_NAMING_CONVENTIONS.md](./ANALYTICS_NAMING_CONVENTIONS.md)

**Value:** Consistent event naming, complete funnel tracking  
**Impact:** Better product analytics, easier to query data  
**Current State:** Analytics working but inconsistent naming  
**When Needed:** When analytics becomes key decision driver  
**ROI:** Low - data quality improvement  

**Summary:**
Establishes naming conventions and standards for all analytics events in BOUNTYExpo. Provides complete event catalog with required/optional properties, user funnel definitions, property value standards, and query examples.

**Key Topics:**
- Naming conventions (snake_case, entity_action pattern)
- Complete event catalog by category
- User funnel definitions
- Property naming and value standards
- Implementation guidelines
- Mixpanel query examples

---

## Recommendation

**Primary Focus:** Redis idempotency before multi-instance deployment

The problem statement correctly identifies that Redis-based idempotency is more critical than these four items. That work should be completed before investing time in these deferred issues.

**These items can wait for signal from production metrics:**

```
Priority Order (by urgency):

1. Redis Idempotency ⚡ HIGH
   └─> Required for multi-instance deployment
   
2. Async Ordering Docs ✅ COMPLETE
   └─> Read before onboarding new engineers
   
3-6. Monitor metrics first, implement only if needed:
   ├─> Rate Limiting Enhancement
   ├─> Stripe Customer Optimization  
   ├─> Analytics Standardization
   └─> (Other low-priority items)
```

## When to Revisit

### 1. Async Ordering Documentation
**Trigger:** Onboarding new backend engineers

**Action:** Have new team members read the guide as part of onboarding. This prevents accidental introduction of race conditions.

### 2. Stripe Customer Optimization
**Trigger:** Any of:
- First payment latency > 1500ms (p95)
- User complaints about payment slowness
- Analytics show payment abandonment at confirmation step

**Action:** Implement the optimization following the documented plan

### 3. Rate Limiting Enhancement
**Trigger:** Any of:
- Seeing credential stuffing attacks in logs
- Deploying multiple API instances (need Redis)
- Rate limit false positives causing user complaints
- Security audit recommends additional protection

**Action:** Implement relevant enhancements (Redis, CAPTCHA, progressive limits)

### 4. Analytics Standardization
**Trigger:** Any of:
- Analytics data driving key product decisions
- Difficulty querying or analyzing current events
- Building dashboards/reports
- A/B testing initiatives

**Action:** Implement conventions for new events, gradually migrate old events

## Implementation Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│           Should I Implement This Deferred Issue?            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                Is Redis Idempotency complete?
                         │
                    ┌────┴────┐
                    NO       YES
                    │         │
                    ▼         ▼
            Work on Redis    Is there a production
            first             metric/signal?
                              │
                         ┌────┴────┐
                        NO        YES
                         │         │
                         ▼         ▼
                   Keep monitoring   Is it causing
                   Wait for signal    user pain?
                                      │
                                 ┌────┴────┐
                                NO        YES
                                 │         │
                                 ▼         ▼
                          Is there       Implement
                          bandwidth?     the fix
                               │
                          ┌────┴────┐
                        NO         YES
                         │          │
                         ▼          ▼
                    Defer to    Consider
                    next        implementing
                    cycle
```

## Monitoring Checklist

To determine when these issues should be addressed:

### Weekly Metrics Review
- [ ] Check first payment latency (p95, p99)
- [ ] Review rate limit violation rates
- [ ] Check authentication failure patterns
- [ ] Monitor analytics query performance

### Monthly Metrics Review
- [ ] Analyze payment conversion funnel
- [ ] Review Stripe API performance
- [ ] Check for unusual authentication patterns
- [ ] Assess analytics data quality

### Quarterly Review
- [ ] Evaluate whether deferred items are needed
- [ ] Check if triggers have been met
- [ ] Assess team bandwidth
- [ ] Prioritize against new features

## Documentation Maintenance

These documents should be updated when:

1. **Code changes** affect the documented implementations
2. **New patterns** emerge that should be documented
3. **Metrics** indicate a documented issue is now relevant
4. **Team learns** better approaches to the documented problems

## Related Documentation

### Architecture
- [Backend Consolidation Architecture](../BACKEND_CONSOLIDATION_ARCHITECTURE.md)
- [Auth Profile Architecture](../AUTH_PROFILE_ARCHITECTURE.md)
- [Stripe Connect Architecture](../services/api/STRIPE_CONNECT_ARCHITECTURE.md)

### Security
- [Security Features Implementation](../SECURITY_FEATURES_IMPLEMENTATION.md)
- [Payment Security Compliance](../PAYMENT_SECURITY_COMPLIANCE.md)

### Operations
- [Analytics Implementation](../ANALYTICS_IMPLEMENTATION.md)
- [Performance Optimization](../PERFORMANCE.md)

## Conclusion

These four items have been thoroughly documented and are ready for implementation when needed. However, they should remain **low priority** until:

1. Production metrics indicate they are needed
2. Higher priority work (like Redis idempotency) is complete
3. Team has bandwidth for quality-of-life improvements

**Current Recommendation:** Focus on Redis idempotency for multi-instance deployment. Monitor metrics for signals that these deferred issues need attention.

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-01-02  
**Status:** Complete Documentation, Deferred Implementation ✅  
**Next Review:** Q2 2026
