# Analytics & Monitoring Setup Guide

## Overview
This guide covers setting up and verifying analytics (Mixpanel) and error monitoring (Sentry) for BOUNTY in production.

## 🎯 Key Metrics to Track

### User Acquisition
- App downloads/installs
- Sign-ups (email, Google, Apple)
- Onboarding completion rate
- Time to first action

### Core Engagement
- Daily Active Users (DAU)
- Weekly Active Users (WAU)
- Monthly Active Users (MAU)
- Session duration
- Session frequency

### Bounty Metrics
- Bounties created
- Bounty acceptance rate
- Bounty completion rate
- Time from creation to acceptance
- Time from acceptance to completion

### Revenue Metrics
- Payment success rate
- Average bounty value
- Transaction volume
- Failed payments (investigate reasons)

### User Behavior
- Feature usage (which screens/features)
- Search queries
- Profile completion rate
- Chat messages sent
- Notifications opened

### Health Metrics
- Crash-free sessions
- API error rate
- Page load times
- Payment processing time

## 📊 Mixpanel Setup

### Prerequisites
- Mixpanel account (free tier available)
- Project created in Mixpanel dashboard
- Project token obtained

### Configuration

#### 1. Get Mixpanel Token
1. Log in to https://mixpanel.com
2. Create new project or select existing: "BOUNTY Production"
3. Settings → Project Settings → Token
4. Copy the Project Token

#### 2. Set Environment Variable
Add to `.env.production`:
```bash
MIXPANEL_TOKEN="your_production_mixpanel_token"
EXPO_PUBLIC_MIXPANEL_TOKEN="your_production_mixpanel_token"
```

#### 3. Verify Integration
Already configured in `app/_layout.tsx`:
```typescript
import Mixpanel from 'mixpanel-react-native';

// Initialize Mixpanel
const initMixpanel = async () => {
  const token = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
  if (token) {
    await Mixpanel.init(token);
  }
};
```

### Event Tracking

#### Current Events (Already Implemented)

**User Events:**
- `user_signup` - User creates account
- `user_signin` - User logs in
- `profile_completed` - User completes profile
- `onboarding_completed` - User finishes onboarding

**Bounty Events:**
- `bounty_created` - New bounty posted
- `bounty_viewed` - User views bounty detail
- `bounty_accepted` - Hunter accepts bounty
- `bounty_completed` - Bounty marked complete
- `bounty_cancelled` - Bounty cancelled

**Messaging Events:**
- `message_sent` - User sends message
- `conversation_created` - New conversation started

**Payment Events:**
- `payment_initiated` - User starts payment flow
- `payment_succeeded` - Payment processed successfully
- `payment_failed` - Payment failed
- `funds_escrowed` - Money held in escrow
- `funds_released` - Escrow released to hunter

**Search Events:**
- `search_performed` - User searches bounties
- `filter_applied` - User filters results

#### Example: Tracking Custom Event
```typescript
import Mixpanel from 'mixpanel-react-native';

// Track event
Mixpanel.track('bounty_created', {
  bounty_id: bounty.id,
  amount: bounty.amount,
  has_location: !!bounty.location,
  is_for_honor: bounty.isForHonor || false,
  user_id: user.id,
});

// Set user properties
Mixpanel.identify(user.id);
Mixpanel.getPeople().set({
  '$email': user.email,
  '$name': user.username,
  'signup_date': user.created_at,
  'bounties_created': user.bounties_count,
});

// Increment counter property
Mixpanel.getPeople().increment('bounties_created', 1);
```

### Verification Checklist

#### Pre-Launch
- [ ] Mixpanel token set in production environment
- [ ] Mixpanel initialized in app (_layout.tsx)
- [ ] Test events fire in development
- [ ] Events appear in Mixpanel dashboard (Live View)

#### Post-Launch (First 24 Hours)
- [ ] User signup events appearing
- [ ] Bounty creation events appearing
- [ ] Payment events tracking correctly
- [ ] User properties being set
- [ ] No errors in Mixpanel implementation

### Key Reports to Set Up

1. **User Funnel:**
   - App Install → Signup → Profile Complete → First Bounty Created
   - Track drop-off at each stage

2. **Bounty Funnel:**
   - Created → Viewed → Accepted → Completed
   - Identify where bounties get stuck

3. **Retention Cohort:**
   - Daily retention by signup cohort
   - Weekly/monthly retention

4. **Revenue Tracking:**
   - Transaction volume over time
   - Average transaction value
   - Payment success rate

### Mixpanel Best Practices

1. **Keep event names consistent:**
   - Use snake_case: `bounty_created`
   - Be descriptive but concise

2. **Include relevant properties:**
   - Event-specific data (bounty_id, amount)
   - User context (user_id, user_type)
   - Session info (device, platform)

3. **Set user properties:**
   - Demographics (age, location)
   - Behavior (total_bounties_created)
   - Status (subscription_tier, verified)

4. **Don't over-track:**
   - Track meaningful actions only
   - Avoid tracking every tap/scroll
   - Focus on business-critical events

## 🔍 Sentry Error Tracking

### Prerequisites
- Sentry account (free tier available)
- Organization and project created
- DSN (Data Source Name) obtained

### Configuration

#### 1. Get Sentry DSN
1. Log in to https://sentry.io
2. Create organization and project: "BOUNTY Production"
3. Select platform: React Native
4. Copy the DSN

#### 2. Set Environment Variables
Add to `.env.production`:
```bash
SENTRY_DSN="your_production_sentry_dsn"
EXPO_PUBLIC_SENTRY_DSN="your_production_sentry_dsn"
```

#### 3. Verify Configuration in app.json
Already configured:
```json
{
  "expo": {
    "plugins": [
      [
        "@sentry/react-native/expo",
        {
          "url": "https://sentry.io/",
          "project": "react-native",
          "organization": "bounty-4e"  // ⚠️ REPLACE with your Sentry organization slug
        }
      ]
    ]
  }
}
```

**Note:** The organization value "bounty-4e" is an example. Replace with your actual Sentry organization slug.

#### 4. Update Organization/Project
Edit `app.json` with your actual Sentry org/project:
```json
{
  "expo": {
    "plugins": [
      [
        "@sentry/react-native/expo",
        {
          "url": "https://sentry.io/",
          "project": "your-project-slug",
          "organization": "your-org-slug"
        }
      ]
    ]
  }
}
```

### Error Tracking Implementation

#### Automatic Error Capture
Sentry automatically captures:
- Unhandled exceptions
- Promise rejections
- Native crashes (iOS/Android)

#### Manual Error Logging
```typescript
import * as Sentry from '@sentry/react-native';

// Log error
try {
  await riskyOperation();
} catch (error) {
  console.error('[Component] Operation failed:', error);
  Sentry.captureException(error);
}

// Add context
Sentry.setContext('bounty', {
  id: bounty.id,
  amount: bounty.amount,
  status: bounty.status,
});

// Add tags for filtering
Sentry.setTag('feature', 'payment');
Sentry.setTag('user_type', 'poster');

// Add breadcrumbs for debugging
Sentry.addBreadcrumb({
  category: 'bounty',
  message: 'User attempted to create bounty',
  level: 'info',
  data: {
    amount: 50,
    location: 'San Francisco',
  },
});
```

#### User Identification
```typescript
Sentry.setUser({
  id: user.id,
  email: user.email,
  username: user.username,
});
```

### Verification Checklist

#### Pre-Launch
- [ ] Sentry DSN set in production environment
- [ ] Sentry plugin configured in app.json
- [ ] Test error capture in development
- [ ] Errors appear in Sentry dashboard

#### Post-Launch (First Week)
- [ ] Monitoring crash-free rate
- [ ] No critical errors unresolved
- [ ] Error alerts configured
- [ ] Team receiving error notifications

### Alert Configuration

#### Recommended Alerts

1. **Critical Error Alert:**
   - Trigger: Any error with level "fatal"
   - Action: Immediate Slack/email notification
   - Recipient: On-call engineer

2. **Error Spike Alert:**
   - Trigger: Error rate increases 2x in 5 minutes
   - Action: Email/Slack notification
   - Recipient: Dev team

3. **New Issue Alert:**
   - Trigger: First occurrence of new error
   - Action: Email notification
   - Recipient: Dev lead

4. **Payment Failure Alert:**
   - Trigger: Error tagged with "payment"
   - Action: Immediate notification
   - Recipient: Dev + finance team

#### Setting Up Alerts
1. Sentry Dashboard → Alerts
2. Create Alert Rule
3. Set conditions (error frequency, new issues, etc.)
4. Configure integrations (Slack, email, PagerDuty)
5. Test alert

### Error Triage Process

#### Priority Levels

**P0 - Critical (Fix Immediately)**
- App crashes on launch
- Payment processing fails
- Data loss/corruption
- Security vulnerability

**P1 - High (Fix within 24 hours)**
- Major feature broken
- Significant UX impact
- Affecting >5% of users

**P2 - Medium (Fix within week)**
- Minor feature issues
- Workaround available
- Affecting <5% of users

**P3 - Low (Fix in next release)**
- Edge cases
- Cosmetic issues
- Rare occurrences

#### Triage Workflow
1. **New error detected** → Sentry creates issue
2. **Alert sent** → Team member reviews
3. **Assign priority** → Based on impact/frequency
4. **Assign owner** → Developer investigates
5. **Fix and deploy** → Hotfix or next release
6. **Resolve issue** → Mark resolved in Sentry
7. **Monitor** → Verify fix in production

### Sentry Best Practices

1. **Group errors intelligently:**
   - Use fingerprinting for related errors
   - Merge duplicate issues
   - Ignore known non-critical errors

2. **Add context to errors:**
   - User ID, session ID
   - App state at time of error
   - Breadcrumbs leading to error

3. **Monitor release health:**
   - Set up releases in Sentry
   - Track crash-free sessions per release
   - Compare release performance

4. **Use source maps:**
   - Upload source maps for readable stack traces
   - EAS Build handles this automatically

## 📈 Performance Monitoring

### Key Performance Metrics

1. **App Launch Time:**
   - Time to interactive
   - Target: <3 seconds

2. **API Response Time:**
   - P50, P95, P99 latency
   - Target: <500ms for P95

3. **Screen Load Time:**
   - Time to render
   - Target: <1 second

4. **Payment Processing Time:**
   - Stripe API call duration
   - Target: <2 seconds

### Monitoring Tools

#### Expo Insights (Built-in)
```typescript
import { Insights } from 'expo-insights';

// Track performance
Insights.trackEvent('screen_load', {
  screen: 'PostingsScreen',
  duration: loadTime,
});
```

#### React Native Performance Monitor
Already available in dev mode:
- Shake device → Show Perf Monitor
- View FPS, JS thread usage, UI thread usage

#### Sentry Performance Monitoring
```typescript
import * as Sentry from '@sentry/react-native';

// Create transaction
const transaction = Sentry.startTransaction({
  name: 'Create Bounty Flow',
  op: 'bounty.create',
});

try {
  // Perform operations
  await createBounty(data);
  
  transaction.setStatus('ok');
} catch (error) {
  transaction.setStatus('error');
  throw error;
} finally {
  transaction.finish();
}
```

## 🚨 Alert Setup

### Critical Alerts (Immediate Response)

1. **App Crash Rate >1%:**
   ```
   Condition: Crash-free sessions < 99% in 5 minutes
   Action: Page on-call engineer
   ```

2. **Payment Failures >5%:**
   ```
   Condition: Payment error rate > 5% in 10 minutes
   Action: Notify dev + finance team
   ```

3. **API Downtime:**
   ```
   Condition: API error rate > 50% in 5 minutes
   Action: Page on-call engineer
   ```

### Warning Alerts (Monitor Closely)

1. **Increased Error Rate:**
   ```
   Condition: Error rate 2x baseline in 15 minutes
   Action: Slack notification
   ```

2. **Slow API Response:**
   ```
   Condition: P95 latency > 2 seconds
   Action: Email notification
   ```

3. **Low Retention:**
   ```
   Condition: Day 1 retention < 40%
   Action: Weekly report
   ```

### Integration Options

- **Slack:** Real-time team notifications
- **Email:** Non-urgent alerts
- **PagerDuty:** Critical incidents, on-call rotation
- **Discord:** Alternative to Slack

## 📊 Dashboards to Create

### 1. Real-Time Health Dashboard
**Purpose:** Monitor app health in real-time

**Metrics:**
- Active users now
- Requests per minute
- Error rate
- Crash-free sessions
- API response time

**Tools:** Mixpanel Live View + Sentry Issues

### 2. Business Metrics Dashboard
**Purpose:** Track business KPIs

**Metrics:**
- DAU/MAU
- Bounties created/completed
- Transaction volume
- Revenue
- User retention

**Tools:** Mixpanel Insights + Custom reports

### 3. Technical Health Dashboard
**Purpose:** Monitor technical performance

**Metrics:**
- Error rate by feature
- API latency
- Build success rate
- Test coverage
- Deployment frequency

**Tools:** Sentry + GitHub Actions + Custom

### 4. User Funnel Dashboard
**Purpose:** Track user journey

**Metrics:**
- Signup funnel conversion
- Bounty creation funnel
- Payment completion rate
- Feature adoption

**Tools:** Mixpanel Funnels

## ✅ Pre-Launch Verification

### Mixpanel Checklist
- [ ] Production project created
- [ ] Token set in production .env
- [ ] Events firing correctly in test
- [ ] User identification working
- [ ] Key funnels configured
- [ ] Team has dashboard access

### Sentry Checklist
- [ ] Production project created
- [ ] DSN set in production .env
- [ ] Plugin configured in app.json
- [ ] Error capture tested
- [ ] Alerts configured
- [ ] Team has access
- [ ] On-call rotation set up

### Monitoring Checklist
- [ ] Key metrics defined
- [ ] Dashboards created
- [ ] Alerts configured
- [ ] Team trained on tools
- [ ] Runbook created for incidents
- [ ] Post-launch monitoring plan ready

## 📚 Resources

- [Mixpanel Documentation](https://docs.mixpanel.com/)
- [Sentry React Native Guide](https://docs.sentry.io/platforms/react-native/)
- [Expo Analytics Best Practices](https://docs.expo.dev/guides/using-analytics/)
- [App Performance Optimization](https://reactnative.dev/docs/performance)

---

**Ready for launch?** Ensure all monitoring and analytics are properly configured before releasing to production!
