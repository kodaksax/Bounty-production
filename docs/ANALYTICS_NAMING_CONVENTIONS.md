# Analytics Naming Convention & Standardization Guide

## Overview

This document establishes consistent naming conventions and standards for analytics events in BOUNTYExpo. Following these conventions ensures data quality, makes analytics easier to query, and improves decision-making capabilities.

## Current State

### ✅ What's Working

- **Mixpanel integration** - Events are being tracked
- **Sentry integration** - Error context is captured
- **Type safety** - Events defined in TypeScript
- **Automatic enrichment** - Platform, timestamp, userId added automatically

### ⚠️ Issues to Address

- **Inconsistent naming** - Some events use different patterns
- **Missing funnel events** - Gaps in user journey tracking
- **Property inconsistency** - Same data uses different property names
- **Limited documentation** - No single source of truth for events

## Naming Conventions

### Event Naming Standard

**Format:** `{entity}_{action}` using `snake_case`

#### ✅ Correct Examples

```typescript
// Entity_action pattern
'user_signed_up'
'bounty_created'
'payment_completed'
'message_sent'
'profile_updated'

// Screen views
'screen_viewed' // with screen_name property
```

#### ❌ Incorrect Examples

```typescript
// Don't use camelCase
'userSignedUp'  // ❌

// Don't use PascalCase
'UserSignedUp'  // ❌

// Don't use kebab-case for events
'user-signed-up'  // ❌

// Don't omit entity
'created'  // ❌ - Created what?

// Don't be vague
'action_happened'  // ❌ - What action?
```

### Property Naming Standard

**Format:** `snake_case` for all properties

#### ✅ Correct Property Names

```typescript
{
  // IDs
  user_id: 'usr_123',
  bounty_id: 'bty_456',
  conversation_id: 'conv_789',
  
  // Amounts
  amount_cents: 5000,
  amount_usd: 50.00,
  
  // Metadata
  screen_name: 'BountyDetail',
  payment_method: 'card',
  error_code: 'insufficient_funds',
  
  // Boolean flags
  is_for_honor: true,
  is_first_bounty: false,
  has_location: true,
  
  // Timestamps
  created_at: '2026-01-02T23:00:00Z',
  completed_at: '2026-01-02T23:30:00Z',
  
  // Counts
  message_count: 5,
  participant_count: 2,
  attachment_count: 1,
}
```

#### ❌ Incorrect Property Names

```typescript
{
  userId: 'usr_123',           // ❌ camelCase
  'bounty-id': 'bty_456',      // ❌ kebab-case
  BountyID: 'bty_789',         // ❌ PascalCase
  amt: 50,                      // ❌ abbreviation
  timestamp: Date.now(),        // ❌ inconsistent with other timestamps
}
```

## Complete Event Catalog

### Authentication Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `user_signed_up` | User successfully registers | `email`, `username`, `auth_method` | `referral_code` |
| `user_logged_in` | User successfully logs in | `email`, `auth_method` | `remember_me`, `device_type` |
| `user_logged_out` | User logs out | `session_duration_seconds` | `reason` |
| `email_verified` | Email verification complete | `email` | `verification_method` |
| `password_reset_requested` | User requests password reset | `email` | - |
| `password_reset_completed` | Password successfully reset | `email` | - |

**Example:**
```typescript
analyticsService.trackEvent('user_signed_up', {
  email: 'user@example.com',
  username: 'johndoe',
  auth_method: 'email', // or 'google', 'apple'
  platform: 'ios',
});
```

### Bounty Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `bounty_created` | New bounty posted | `bounty_id`, `amount_cents`, `is_for_honor`, `work_type` | `location`, `due_date`, `description_length` |
| `bounty_viewed` | User opens bounty detail | `bounty_id`, `viewer_role` | `source_screen`, `is_own_bounty` |
| `bounty_edited` | Bounty updated by poster | `bounty_id`, `fields_changed` | - |
| `bounty_accepted` | Hunter accepts bounty | `bounty_id`, `hunter_id`, `amount_cents` | `response_time_seconds` |
| `bounty_completed` | Work marked complete | `bounty_id`, `hunter_id`, `completion_time_seconds` | `rating` |
| `bounty_cancelled` | Bounty cancelled | `bounty_id`, `reason` | `refund_issued` |
| `bounty_archived` | Bounty archived | `bounty_id`, `reason` | - |

**Example:**
```typescript
analyticsService.trackEvent('bounty_created', {
  bounty_id: 'bty_abc123',
  amount_cents: 5000,
  is_for_honor: false,
  work_type: 'photography',
  location: 'San Francisco, CA',
  description_length: 250,
  has_due_date: true,
});
```

### Payment Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `payment_initiated` | Payment intent created | `amount_cents`, `currency`, `payment_type` | `bounty_id` |
| `payment_method_added` | New payment method saved | `payment_method_type` | `is_default` |
| `payment_method_removed` | Payment method deleted | `payment_method_id` | - |
| `payment_completed` | Payment successful | `payment_intent_id`, `amount_cents`, `currency` | `bounty_id`, `payment_method_type` |
| `payment_failed` | Payment failed | `payment_intent_id`, `error_code`, `error_message` | `bounty_id`, `retry_count` |
| `payment_refunded` | Refund issued | `payment_intent_id`, `amount_cents`, `reason` | `bounty_id` |
| `escrow_funded` | Funds added to escrow | `bounty_id`, `amount_cents` | `source` |
| `escrow_released` | Funds released from escrow | `bounty_id`, `amount_cents`, `recipient_id` | - |

**Example:**
```typescript
analyticsService.trackEvent('payment_completed', {
  payment_intent_id: 'pi_xyz789',
  amount_cents: 5000,
  currency: 'usd',
  bounty_id: 'bty_abc123',
  payment_method_type: 'card',
  processing_time_ms: 234,
});
```

### Messaging Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `conversation_started` | New conversation created | `conversation_id`, `participant_count`, `conversation_type` | `bounty_id`, `initiated_by` |
| `conversation_viewed` | User opens conversation | `conversation_id` | `unread_count` |
| `message_sent` | Message sent | `conversation_id`, `message_length` | `has_attachment`, `attachment_type` |
| `message_read` | Message marked as read | `conversation_id`, `message_id` | `time_to_read_seconds` |
| `attachment_uploaded` | File attached to message | `conversation_id`, `file_type`, `file_size_bytes` | - |

**Example:**
```typescript
analyticsService.trackEvent('message_sent', {
  conversation_id: 'conv_123',
  message_length: 42,
  has_attachment: true,
  attachment_type: 'image',
});
```

### Profile Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `profile_viewed` | User views a profile | `profile_user_id`, `viewer_user_id` | `is_own_profile`, `source_screen` |
| `profile_updated` | Profile edited | `fields_changed` | `avatar_updated` |
| `avatar_uploaded` | Profile photo changed | `file_size_bytes` | - |
| `bio_updated` | About section updated | `bio_length` | - |

**Example:**
```typescript
analyticsService.trackEvent('profile_updated', {
  fields_changed: ['username', 'bio'],
  avatar_updated: false,
  bio_length: 120,
});
```

### Search & Discovery Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `search_performed` | Search executed | `query`, `result_count` | `filters_applied`, `search_type` |
| `filter_applied` | Filters changed | `filter_type`, `filter_value` | `result_count` |
| `search_result_clicked` | Search result opened | `bounty_id`, `result_position` | `query` |

**Example:**
```typescript
analyticsService.trackEvent('search_performed', {
  query: 'photography',
  result_count: 12,
  filters_applied: ['location', 'price_range'],
  search_type: 'keyword',
});
```

### Screen Navigation Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `screen_viewed` | Screen loaded | `screen_name` | `previous_screen`, `navigation_method` |

**Example:**
```typescript
analyticsService.trackScreenView('BountyDetail', {
  bounty_id: 'bty_123',
  previous_screen: 'PostingsList',
  navigation_method: 'tap',
});
```

### Error Events

| Event Name | When to Fire | Required Properties | Optional Properties |
|------------|--------------|---------------------|---------------------|
| `error_occurred` | Non-fatal error | `error_type`, `error_message` | `screen_name`, `action_attempted` |
| `api_error` | API call failed | `endpoint`, `status_code`, `error_message` | `retry_count` |

**Example:**
```typescript
analyticsService.trackEvent('error_occurred', {
  error_type: 'validation',
  error_message: 'Invalid email format',
  screen_name: 'SignUp',
  action_attempted: 'register',
});
```

## User Funnels

### Bounty Creation Funnel

Track the complete bounty creation journey:

```typescript
// Step 1: Started
analyticsService.trackEvent('bounty_creation_started', {
  source_screen: 'Dashboard',
});

// Step 2: Form filled
analyticsService.trackEvent('bounty_form_completed', {
  fields_filled: ['title', 'description', 'amount'],
  time_to_complete_seconds: 45,
});

// Step 3: Review
analyticsService.trackEvent('bounty_preview_viewed', {
  amount_cents: 5000,
});

// Step 4: Success
analyticsService.trackEvent('bounty_created', {
  bounty_id: 'bty_123',
  // ... other properties
});

// Alternative: Abandoned
analyticsService.trackEvent('bounty_creation_abandoned', {
  last_step: 'form_filling',
  fields_completed: ['title'],
});
```

### Payment Funnel

Track payment flow completion:

```typescript
// Step 1: Initiated
analyticsService.trackEvent('payment_initiated', {
  amount_cents: 5000,
  payment_type: 'bounty_acceptance',
});

// Step 2: Method selected
analyticsService.trackEvent('payment_method_selected', {
  payment_method_type: 'card',
  is_saved_method: true,
});

// Step 3: Confirmation viewed
analyticsService.trackEvent('payment_confirmation_viewed', {
  amount_cents: 5000,
});

// Step 4: Success
analyticsService.trackEvent('payment_completed', {
  payment_intent_id: 'pi_123',
  // ... other properties
});

// Alternative: Failed
analyticsService.trackEvent('payment_failed', {
  error_code: 'card_declined',
  // ... other properties
});
```

### User Onboarding Funnel

```typescript
// Step 1: Sign up
analyticsService.trackEvent('user_signed_up', { /* ... */ });

// Step 2: Email verified
analyticsService.trackEvent('email_verified', { /* ... */ });

// Step 3: Profile completed
analyticsService.trackEvent('profile_completed', {
  fields_completed: ['username', 'bio', 'avatar'],
});

// Step 4: First bounty viewed
analyticsService.trackEvent('bounty_viewed', {
  is_first_view: true,
  // ... other properties
});

// Step 5: First bounty created or accepted
analyticsService.trackEvent('first_bounty_action', {
  action_type: 'created', // or 'accepted'
});
```

## Property Value Standards

### Common Values

#### Auth Method
```typescript
type AuthMethod = 'email' | 'google' | 'apple';
```

#### Work Type
```typescript
type WorkType = 
  | 'photography'
  | 'writing'
  | 'design'
  | 'delivery'
  | 'tutoring'
  | 'handyman'
  | 'other';
```

#### Payment Type
```typescript
type PaymentType = 
  | 'bounty_acceptance'    // Escrow funding
  | 'bounty_completion'    // Escrow release
  | 'wallet_deposit'       // Adding funds
  | 'wallet_withdrawal';   // Cashing out
```

#### Viewer Role
```typescript
type ViewerRole = 
  | 'poster'    // User who created the bounty
  | 'hunter'    // User who accepted/applied
  | 'visitor';  // Other users browsing
```

### Amount Formatting

Always use cents for consistency:

```typescript
// ✅ Correct
{
  amount_cents: 5000,        // $50.00
  amount_currency: 'usd',
}

// ❌ Incorrect
{
  amount: 50,                // Ambiguous - dollars or cents?
  amount: 50.00,             // Floating point can cause issues
}
```

### Timestamp Formatting

Always use ISO 8601 format:

```typescript
// ✅ Correct
{
  created_at: '2026-01-02T23:00:00.000Z',
  completed_at: '2026-01-02T23:30:00.000Z',
}

// ❌ Incorrect
{
  created_at: Date.now(),           // Unix timestamp (harder to read)
  created_at: '01/02/2026',         // Ambiguous format
}
```

## Implementation Guidelines

### Using the Analytics Service

```typescript
import { analyticsService } from '@/lib/services/analytics-service';

// In a component or service
async function handleBountyCreation(bountyData: BountyInput) {
  try {
    const bounty = await bountyService.create(bountyData);
    
    // Track success
    await analyticsService.trackEvent('bounty_created', {
      bounty_id: bounty.id,
      amount_cents: bounty.amountCents,
      is_for_honor: bounty.isForHonor,
      work_type: bounty.workType,
      has_location: !!bounty.location,
      has_due_date: !!bounty.dueDate,
      description_length: bounty.description.length,
    });
    
    // Increment user counter
    await analyticsService.incrementUserProperty('bounties_created');
    
    return bounty;
  } catch (error) {
    // Track failure
    await analyticsService.trackEvent('bounty_creation_failed', {
      error_code: error.code,
      error_message: error.message,
    });
    
    throw error;
  }
}
```

### Using the Hook

```typescript
import { useAnalytics } from '@/hooks/useAnalytics';

function BountyDetailScreen({ bountyId }: Props) {
  const { trackEvent, trackScreenView } = useAnalytics();
  
  useEffect(() => {
    // Track screen view
    trackScreenView('BountyDetail', {
      bounty_id: bountyId,
    });
  }, [bountyId]);
  
  const handleAccept = async () => {
    await trackEvent('bounty_accepted', {
      bounty_id: bountyId,
      hunter_id: currentUserId,
      amount_cents: bounty.amountCents,
    });
    
    // ... handle acceptance
  };
  
  return (
    // ... component JSX
  );
}
```

## Query Examples

With consistent naming, analytics queries become easier:

### Mixpanel Query: Bounty Creation Funnel

```javascript
// Track conversion from start to completion
funnel({
  events: [
    { name: 'bounty_creation_started' },
    { name: 'bounty_form_completed' },
    { name: 'bounty_preview_viewed' },
    { name: 'bounty_created' }
  ],
  timeWindow: '30 days'
})
```

### Mixpanel Query: Payment Success Rate

```javascript
// Calculate percentage of successful payments
segmentation({
  events: ['payment_completed', 'payment_failed'],
  property: 'event_name',
  timeWindow: '7 days'
})
```

### Mixpanel Query: Average Bounty Amount

```javascript
// Get average bounty value
average({
  event: 'bounty_created',
  property: 'amount_cents',
  timeWindow: '30 days'
})
```

## Validation Checklist

Before tracking an event, verify:

- [ ] Event name uses `snake_case`
- [ ] Event follows `{entity}_{action}` pattern
- [ ] All required properties are included
- [ ] Property names use `snake_case`
- [ ] Amounts are in cents (not dollars)
- [ ] Timestamps use ISO 8601 format
- [ ] Boolean flags use `is_` or `has_` prefix
- [ ] Property values use standardized enums
- [ ] No PII in property values (use IDs instead)

## Migration Plan

### Phase 1: Document Current State ✅

- [x] Create this standardization guide
- [x] Document all existing events
- [x] Define naming conventions

### Phase 2: Audit Existing Events (In Progress)

- [ ] Review all `trackEvent` calls in codebase
- [ ] Identify non-compliant events
- [ ] Create migration mapping

### Phase 3: Gradual Migration (Future)

- [ ] Update new code to use standards
- [ ] Migrate high-traffic events first
- [ ] Keep both old and new events temporarily
- [ ] Update analytics dashboards

### Phase 4: Deprecation (Future)

- [ ] Remove old event tracking
- [ ] Archive historical data
- [ ] Update documentation

## Testing Analytics

### Local Testing

```typescript
// In development, log analytics calls
if (__DEV__) {
  console.log('[Analytics]', event, properties);
}
```

### Staging Testing

Use Mixpanel's test mode:

```typescript
// .env.staging
EXPO_PUBLIC_MIXPANEL_TOKEN=<test_token>
```

### Production Validation

Monitor for:
- Event volume (events per user)
- Property completeness (% with required properties)
- Error rate (failed tracking calls)

## Related Documentation

- [Analytics Implementation Guide](../ANALYTICS_IMPLEMENTATION.md) - Setup and configuration
- [Performance Service](../lib/services/performance-service.ts) - Timing analytics
- [Error Tracking](../lib/services/sentry-init.ts) - Error analytics

## Conclusion

**Current State:** 🟡 Analytics working but inconsistent  
**Target State:** 🟢 Standardized, queryable, actionable analytics  
**Priority:** ⏳ Low - Improve gradually as product matures

Following these conventions ensures BOUNTYExpo's analytics remain maintainable and valuable as the platform grows. Implement new events according to these standards, and migrate old events when convenient.

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-01-02  
**Status:** Living Document 📝  
**Priority:** Low - Apply to new code, migrate old code gradually
