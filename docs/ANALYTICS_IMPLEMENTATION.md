# Analytics and Error Tracking Implementation

This document describes the analytics and error tracking system integrated into BOUNTYExpo.

## Overview

The application now includes comprehensive analytics tracking using Mixpanel and error tracking using Sentry, with structured backend logging via Pino.

## Components

### Client-Side (React Native)

#### 1. Analytics Service (`lib/services/analytics-service.ts`)
- **Mixpanel Integration**: Tracks user events, properties, and timing
- **Event Types**: Covers authentication, bounty actions, payments, messaging, and more
- **Performance Tracking**: Integrated with performance service for timing metrics
- **User Identification**: Automatic user identification and property management

**Key Methods:**
- `initialize(mixpanelToken)`: Initialize analytics
- `identifyUser(userId, properties)`: Identify a user
- `trackEvent(event, properties)`: Track an event
- `trackScreenView(screenName, properties)`: Track screen navigation
- `trackTiming(eventName, duration, properties)`: Track performance metrics
- `updateUserProperties(properties)`: Update user properties
- `incrementUserProperty(property, value)`: Increment counters
- `reset()`: Clear analytics on logout

#### 2. Sentry Error Tracking (`lib/services/sentry-init.ts`)
- **Error Tracking**: Automatic error capture and reporting
- **Performance Tracing**: Distributed tracing for API calls
- **Breadcrumbs**: Context tracking for debugging
- **User Context**: Links errors to specific users
- **Release Tracking**: Version and build information

**Configuration:**
```typescript
import { initializeSentry } from './lib/services/sentry-init';
initializeSentry();
```

#### 3. Performance Monitoring (`lib/services/performance-service.ts`)
- **Measurement API**: Start/end performance measurements
- **Automatic Tracking**: API calls, screen loads, operations
- **Slow Operation Detection**: Alerts for operations > 1 second
- **Integration**: Works with both Analytics and Sentry

**Key Methods:**
- `startMeasurement(name, metric, metadata)`: Start timing
- `endMeasurement(name, metadata)`: End and report timing
- `measureAsync(name, metric, fn, metadata)`: Measure async functions
- `recordApiCall(endpoint, method, statusCode, duration)`: Track API performance

#### 4. React Hook (`hooks/useAnalytics.ts`)
Simplified hook for tracking events in components:

```typescript
import { useAnalytics } from '../hooks/useAnalytics';

function MyComponent() {
  const { trackEvent, trackScreenView } = useAnalytics();
  
  useEffect(() => {
    trackScreenView('MyScreen');
  }, []);
  
  const handleAction = async () => {
    await trackEvent('button_clicked', { button: 'submit' });
  };
}
```

### Backend (Fastify API)

#### 1. Structured Logging (`services/api/src/services/logger.ts`)
- **Pino Logger**: High-performance structured logging
- **Pretty Print**: Human-readable logs in development
- **JSON Logs**: Machine-readable logs in production
- **Sensitive Data Redaction**: Automatic removal of passwords, tokens
- **Module Loggers**: Separate loggers for different modules

**Usage:**
```typescript
import { logger, bountyLogger, paymentLogger } from './services/logger';

logger.info({ userId, action: 'bounty_created' }, 'User created bounty');
paymentLogger.error({ err: error }, 'Payment processing failed');
```

#### 2. Backend Analytics (`services/api/src/services/analytics.ts`)
- **Mixpanel Server SDK**: Track server-side events
- **Sentry Integration**: Error tracking on the backend
- **User Properties**: Server-side user property management
- **Revenue Tracking**: Payment and transaction tracking

**Key Methods:**
- `initialize()`: Initialize backend analytics
- `trackEvent(userId, event, properties)`: Track event
- `setUserProperties(userId, properties)`: Set user properties
- `trackRevenue(userId, amount, properties)`: Track revenue
- `trackError(error, context)`: Track errors
- `flush()`: Flush pending events

#### 3. Analytics Routes (`services/api/src/routes/analytics.ts`)
Admin-only API endpoints for analytics dashboard:

- `GET /admin/analytics/metrics`: Get overview metrics
- `GET /admin/analytics/events`: Get recent event logs
- `GET /admin/analytics/users/:userId`: Get user-specific analytics
- `GET /admin/analytics/export`: Export analytics data

### Admin Dashboard

#### Analytics Dashboard (`app/(admin)/analytics.tsx`)
Visual dashboard displaying:
- User activity metrics (total, active, new users)
- Event metrics (total events, top events)
- Bounty activity (created, accepted, completed)
- Payment activity (transactions, revenue)
- Messaging activity (messages, conversations)
- Error tracking (errors, top error messages)

#### Admin Panel Integration
- Added Analytics link to admin navigation
- Converted Quick Access section to carousel format
- Real-time data refresh capability

## Tracked Events

### Authentication
- `user_signed_up`: User registration
- `user_logged_in`: User login (with method: email, google, apple)
- `user_logged_out`: User logout
- `email_verified`: Email verification completed

### Bounty Actions
- `bounty_created`: New bounty posted (with metadata: work type, amount, location, etc.)
- `bounty_viewed`: Bounty detail viewed
- `bounty_accepted`: Hunter accepts bounty
- `bounty_completed`: Bounty marked complete
- `bounty_cancelled`: Bounty cancelled

### Payment Events
- `payment_initiated`: Payment intent created (with amount, currency)
- `payment_completed`: Payment successfully processed
- `payment_failed`: Payment processing failed (with error details)
- `escrow_funded`: Funds added to escrow
- `escrow_released`: Funds released from escrow

### Messaging Events
- `message_sent`: Message sent (with conversation ID, message length)
- `conversation_started`: New conversation initiated (with participant count, type)
- `conversation_viewed`: Conversation opened

### Profile Events
- `profile_viewed`: User profile viewed
- `profile_updated`: User profile edited

### Search Events
- `search_performed`: Search executed
- `filter_applied`: Search filters applied

## User Properties

Properties tracked for each user:
- `email`: User email
- `username`: User username
- `bounties_created`: Total bounties posted (incremented)
- `messages_sent`: Total messages sent (incremented)
- `payments_completed`: Total payments made (incremented)

## Configuration

### Environment Variables

Add to `.env` file:

```bash
# Mixpanel Configuration
MIXPANEL_TOKEN="your_mixpanel_project_token"
EXPO_PUBLIC_MIXPANEL_TOKEN="your_mixpanel_project_token"

# Sentry Configuration
SENTRY_DSN="your_sentry_dsn"
EXPO_PUBLIC_SENTRY_DSN="your_sentry_dsn"

# Optional: Enable Sentry debug mode in development
# EXPO_PUBLIC_SENTRY_DEBUG=true
# SENTRY_DEBUG=true

# Log level for backend
LOG_LEVEL="debug"  # or "info", "warn", "error"
```

### Obtaining API Keys

#### Mixpanel
1. Sign up at [mixpanel.com](https://mixpanel.com)
2. Create a new project
3. Copy the Project Token from Project Settings
4. Add to both `MIXPANEL_TOKEN` and `EXPO_PUBLIC_MIXPANEL_TOKEN`

#### Sentry
1. Sign up at [sentry.io](https://sentry.io)
2. Create a new project (select React Native)
3. Copy the DSN from the project settings
4. Add to both `SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_DSN`

## Usage Examples

### Tracking Custom Events

```typescript
import { analyticsService } from '../lib/services/analytics-service';

// Track a simple event
await analyticsService.trackEvent('feature_used', {
  feature: 'advanced_search',
  filters: ['location', 'price'],
});

// Track with performance measurement
import { performanceService } from '../lib/services/performance-service';

performanceService.startMeasurement('search', 'api_call');
const results = await searchBounties(query);
await performanceService.endMeasurement('search', {
  resultCount: results.length,
  query,
});
```

### Backend Event Tracking

```typescript
import { backendAnalytics } from './services/analytics';

// Track server-side event
backendAnalytics.trackEvent(userId, 'api_request', {
  endpoint: '/bounties',
  method: 'GET',
  statusCode: 200,
});

// Track revenue
backendAnalytics.trackRevenue(userId, 50.00, {
  bountyId: '123',
  type: 'bounty_completion',
});
```

### Error Tracking

Errors are automatically captured by Sentry when using the error boundary or when they bubble up. For manual error tracking:

```typescript
import * as Sentry from '@sentry/react-native';

try {
  // risky operation
} catch (error) {
  Sentry.captureException(error, {
    extra: {
      userId,
      action: 'bounty_creation',
    },
  });
}
```

## Performance Considerations

### Client-Side
- Analytics calls are async and non-blocking
- Events are batched and sent in the background
- Failed events are retried automatically
- Minimal performance impact (<10ms per event)

### Backend
- Pino is one of the fastest Node.js loggers
- Async logging prevents blocking request handlers
- Log levels can be adjusted per environment
- Analytics events are fire-and-forget

## Monitoring

### Mixpanel Dashboard
- View real-time events
- Create custom reports
- Track user funnels
- Analyze retention and engagement

### Sentry Dashboard
- Monitor error rates
- Track performance metrics
- View error details and stack traces
- Set up alerts for critical errors

### Admin Analytics Dashboard
- Access via `/admin/analytics` route in the app
- Real-time metrics overview
- Pull-to-refresh for latest data
- Export capabilities for reporting

## Best Practices

1. **Event Naming**: Use snake_case for event names (e.g., `bounty_created`)
2. **Property Naming**: Use snake_case for property names (e.g., `bounty_id`)
3. **Sensitive Data**: Never log passwords, tokens, or PII
4. **Error Context**: Include relevant context when tracking errors
5. **Performance**: Track slow operations for optimization opportunities
6. **User Privacy**: Respect user privacy preferences
7. **Testing**: Use mock data in development to avoid polluting production analytics

## Testing

### Development Mode
Both Mixpanel and Sentry can be disabled in development by not setting the environment variables or setting them to placeholder values.

### Mock Mode
The analytics dashboard includes mock data for testing the UI without requiring real analytics data.

## Troubleshooting

### Analytics not tracking
- Verify environment variables are set correctly
- Check console for initialization errors
- Ensure Mixpanel token is valid
- Check network requests in dev tools

### Sentry not capturing errors
- Verify SENTRY_DSN is set
- Check Sentry debug mode in development
- Ensure errors are being thrown/captured
- Check Sentry project settings

### Backend logs not appearing
- Check LOG_LEVEL environment variable
- Verify logger is imported correctly
- Check console output formatting
- Ensure Fastify logger is configured

## Future Enhancements

- [ ] Real-time analytics integration with Mixpanel API
- [ ] Custom event funnels in admin dashboard
- [ ] User cohort analysis
- [ ] A/B testing framework
- [ ] Performance budgets and alerts
- [ ] Automated error grouping and assignment
- [ ] Integration with notification system for critical errors
- [ ] CSV/Excel export for analytics data
- [ ] Scheduled analytics reports via email

## Resources

- [Mixpanel Documentation](https://docs.mixpanel.com/)
- [Sentry React Native Documentation](https://docs.sentry.io/platforms/react-native/)
- [Pino Logger Documentation](https://getpino.io/)
- [Expo Performance API](https://docs.expo.dev/guides/using-performance-api/)
