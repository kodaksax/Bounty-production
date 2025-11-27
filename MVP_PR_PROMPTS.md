# 🎯 BOUNTYExpo MVP - PR Prompts & Task Breakdown

**Quick Reference Guide for Creating Pull Requests**

This document provides copy-paste-ready PR descriptions and task breakdowns for each MVP work item.

---

## 🔴 Priority 1: App Store Requirements

### PR #1: Privacy Policy and Terms of Service

**Branch:** `feat/privacy-policy-terms`

**Tasks:**
1. Draft Privacy Policy covering data collection, third parties, user rights (GDPR/CCPA)
2. Draft Terms of Service covering conduct, payments, disputes, liability
3. Host on GitHub Pages or Vercel
4. Add links to Settings screen
5. Add acceptance checkbox in onboarding

**API Changes:** None

**Time:** 3-5 days

---

### PR #2: Content Moderation System

**Branch:** `feat/content-moderation`

**Database Schema:**
```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY,
  reporter_id UUID REFERENCES users(id),
  content_type TEXT, -- 'bounty', 'user', 'message'
  content_id UUID,
  reason TEXT, -- 'spam', 'harassment', 'inappropriate', 'fraud'
  details TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE blocked_users (
  blocker_id UUID REFERENCES users(id),
  blocked_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);
```

**API Endpoints:**
- `POST /api/reports` - Submit report
- `GET /api/admin/reports` - List reports (admin only)
- `POST /api/users/:id/block` - Block user

**Time:** 5-7 days

---

### PR #3: Age Verification

**Branch:** `feat/age-verification`

**Database:** Add `age_verified` boolean to users table

**Changes:**
- Add 18+ checkbox to sign-up
- Optional birthdate field
- Gate payment features on age verification
- Update Terms with 18+ requirement

**Time:** 2-3 days

---

### PR #4: App Store Assets

**Branch:** `feat/app-store-assets`

**Deliverables:**
- 6.5" iPhone screenshots (6-10)
- 5.5" iPhone screenshots (6-10)
- App description (max 4000 chars)
- Keywords (max 100 chars)
- 1024x1024 app icon

**Time:** 3-4 days

---

## 🟡 Priority 2: Core Functionality

### PR #5: Bounty Acceptance Flow

**Branch:** `feat/bounty-acceptance`

**Database Schema:**
```sql
CREATE TABLE bounty_applications (
  id UUID PRIMARY KEY,
  bounty_id UUID REFERENCES bounties(id),
  hunter_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  cover_letter TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(bounty_id, hunter_id)
);
```

**API Endpoints:**
- `POST /api/bounties/:id/apply`
- `GET /api/bounties/:id/applications`
- `POST /api/bounties/:id/applications/:appId/accept`
- `POST /api/bounties/:id/applications/:appId/reject`

**Screens:**
- Enhanced bounty detail
- Application form
- Applicant list (poster view)

**Time:** 5-7 days

---

### PR #6: Escrow Payment Flow

**Branch:** `feat/escrow-payments`

**Stripe Integration:**
- PaymentIntent (manual capture) for escrow
- Transfers API for fund release
- Refunds API for cancellations
- Connect Express for hunter onboarding

**Flow:**
1. **Escrow on acceptance:** Create PaymentIntent, hold funds
2. **Release on completion:** Capture PaymentIntent, Transfer to hunter (minus 10% fee)
3. **Refund on cancellation:** Cancel or refund PaymentIntent

**Time:** 7-10 days

---

### PR #7: In-Progress Bounty Management

**Branch:** `feat/in-progress-management`

**Screens:**
- Work-in-progress view
- Completion submission form
- Poster review/approval screen
- Payout confirmation

**API Endpoints:**
- `POST /api/bounties/:id/updates` - Progress update
- `POST /api/bounties/:id/complete` - Submit completion
- `POST /api/bounties/:id/approve` - Approve completion

**Time:** 4-5 days

---

### PR #8: Real-Time Messaging

**Branch:** `feat/realtime-messaging`

**Database:**
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  sender_id UUID REFERENCES users(id),
  text TEXT,
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  bounty_id UUID REFERENCES bounties(id),
  is_group BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Backend:**
- WebSocket server with JWT auth
- Room management for conversations
- Message broadcasting

**Frontend:**
- WebSocket client with reconnection
- Message persistence
- Typing indicators

**Time:** 5-6 days

---

### PR #9: Notifications System

**Branch:** `feat/notifications`

**Database:**
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type TEXT,
  title TEXT,
  body TEXT,
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Types:**
- Bounty application received
- Application accepted/rejected
- Bounty completed
- Payment released
- New message
- Profile follow

**Features:**
- In-app notifications with bell icon
- Expo Push Notifications
- Mark as read functionality

**Time:** 4-5 days

---

## 🟢 Priority 3: Quality & Polish

### PR #10: Error Handling

**Branch:** `feat/error-handling`

**Improvements:**
- Offline mode graceful degradation
- User-friendly form validation
- Payment failure handling
- 404 screens
- Rate limiting
- Duplicate submission prevention

**Time:** 3-4 days

---

### PR #11: Loading & Empty States

**Branch:** `feat/loading-empty-states`

**Additions:**
- Skeleton loaders for lists
- Empty state designs with CTAs
- Loading spinners for async actions
- Pull-to-refresh

**Time:** 2-3 days

---

### PR #12: Search & Filtering

**Branch:** `feat/search-filtering`

**Features:**
- Bounty search by keywords, location, amount
- User search by name, skills
- Sort options (date, amount, distance)
- Backend full-text search API

**Time:** 4-5 days

---

### PR #13: Onboarding Flow

**Branch:** `feat/onboarding`

**Screens:**
- Welcome carousel (4 screens)
- Profile setup wizard
- Skip functionality
- Show only on first launch

**Time:** 3-4 days

---

### PR #14: Analytics & Monitoring

**Branch:** `feat/analytics`

**Integrations:**
- Expo Analytics or Mixpanel
- Sentry for error tracking
- Track key events (sign-ups, bounties, payments)
- Backend structured logging

**Time:** 2-3 days

---

## 🔵 Priority 4: Testing

### PR #15: Automated Testing

**Branch:** `feat/automated-tests`

**Coverage:**
- Unit tests for services
- API endpoint integration tests
- Payment flow tests (mock Stripe)
- Target: 70%+ code coverage

**Time:** 5-7 days

---

## 📊 Timeline Summary

| Priority | Item Count | Total Days | Weeks |
|----------|------------|------------|-------|
| P1: App Store Req | 4 | 13-19 | 2-3 |
| P2: Core Functionality | 5 | 25-33 | 4-5 |
| P3: Quality & Polish | 5 | 14-19 | 2-3 |
| P4: Testing | 1 | 5-7 | 1 |
| **TOTAL** | **15 PRs** | **57-78 days** | **9-12 weeks** |

**With 2-3 devs in parallel: 6-8 weeks**

---

## 🚀 Recommended Sprint Plan

### Sprint 1 (Weeks 1-2): App Store Requirements
- PR #1: Privacy Policy
- PR #2: Content Moderation
- PR #3: Age Verification
- PR #4: App Store Assets

### Sprint 2 (Weeks 3-4): Core Bounty Flow
- PR #5: Bounty Acceptance
- PR #6: Escrow Payments
- PR #7: In-Progress Management

### Sprint 3 (Week 5): Messaging & Notifications
- PR #8: Real-Time Messaging
- PR #9: Notifications System

### Sprint 4 (Week 6): Polish
- PR #10: Error Handling
- PR #11: Loading States
- PR #12: Search & Filtering
- PR #13: Onboarding

### Sprint 5 (Week 7): Testing & QA
- PR #14: Analytics
- PR #15: Automated Tests
- Manual testing
- Bug fixes

### Sprint 6 (Week 8): Submission
- Final testing
- Production build
- App Store submission

---

## ✅ PR Template

```markdown
## 🎯 Objective
[One-line description]

## 📝 Changes Made
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## 🗄️ Database Changes
[SQL or "None"]

## 🔌 API Endpoints
[List or "None"]

## 📄 Files Added/Modified
- `path/to/file1.ts` - Description
- `path/to/file2.tsx` - Description

## ✅ Testing
- [ ] Test case 1
- [ ] Test case 2
- [ ] Edge case handling

## 📸 Screenshots
[For UI changes]

## 🔗 Related Issues
Closes #XXX
```

---

This document provides actionable PR templates for the entire MVP roadmap. Use these as starting points and customize as needed! 🚀

---

## 🤖 GitHub Copilot Agent Prompts

The following prompts are designed for GitHub Copilot agent to automate code review, bug fixing, routing validation, and residual MVP work completion.

---

### 🔍 PR #A1: Flow Review & Bug Detection

**Prompt for Copilot:**

```
@copilot Please perform a comprehensive code review of the BOUNTYExpo app focusing on:

1. **Authentication Flow Review:**
   - Review `app/auth/sign-in-form.tsx`, `app/auth/sign-up-form.tsx`, `app/auth/reset-password.tsx`
   - Verify authentication state management in `providers/` and `hooks/`
   - Ensure proper token handling and session persistence
   - Check for race conditions in auth state transitions
   - Verify error handling for failed auth attempts

2. **Bounty Lifecycle Flow Review:**
   - Trace bounty creation flow in `app/screens/CreateBounty/`
   - Review bounty listing in `app/tabs/postings-screen.tsx`
   - Check bounty detail modal and acceptance flow
   - Verify status transitions (open → in_progress → completed → paid)
   - Look for edge cases in bounty state management

3. **Payment Flow Review:**
   - Review wallet integration in `app/tabs/wallet-screen.tsx`
   - Check Stripe integration in `api/` and `lib/services/`
   - Verify escrow creation and release logic
   - Look for payment error handling gaps
   - Check for proper loading states during payment processing

4. **Messaging Flow Review:**
   - Review `app/tabs/messenger-screen.tsx` and `app/tabs/chat-detail-screen.tsx`
   - Check WebSocket connection handling
   - Verify message delivery and read receipts
   - Look for memory leaks in conversation subscriptions

5. **Profile Flow Review:**
   - Review `app/tabs/profile-screen.tsx` and `app/profile/` directory
   - Check avatar upload and image handling
   - Verify follow/unfollow functionality
   - Check profile edit and save operations

**Expected Deliverables:**
- List of bugs found with file paths and line numbers
- Severity classification (Critical/High/Medium/Low)
- Suggested fixes for each bug
- PR with fixes for any critical issues
```

**Branch:** `fix/flow-review-bugs`

**Time:** 2-3 days

---

### 🗺️ PR #A2: Routing Audit & Dead End Prevention

**Prompt for Copilot:**

```
@copilot Please perform a complete routing audit of the BOUNTYExpo app to ensure all navigation paths work correctly and no routes lead to dead ends:

1. **Map All Routes:**
   - Document all routes in `app/` directory using Expo Router file-based routing
   - Identify all navigation calls (router.push, router.replace, router.back, Link components)
   - Create a route map showing all possible navigation paths

2. **Verify Route Accessibility:**
   Check that these screens are reachable from appropriate entry points:
   - `app/index.tsx` - Root/Splash
   - `app/auth/*` - Sign in, Sign up, Reset password
   - `app/onboarding/*` - Onboarding carousel
   - `app/tabs/*` - Main app tabs (bounty, postings, messenger, wallet, profile, search)
   - `app/(admin)/*` - Admin screens
   - `app/in-progress/*` - In-progress bounty views
   - `app/postings/*` - Posting details
   - `app/profile/*` - Profile views and edit

3. **Check for Dead Ends:**
   - Find screens with no back navigation
   - Find screens with broken navigation links
   - Find screens that can be reached but have no exit
   - Verify all modal dismissals work correctly
   - Check for orphaned routes that are defined but unreachable

4. **Validate Deep Linking:**
   - Check `app.json` for deep link configuration
   - Verify notification deep links work
   - Test universal link handling

5. **Fix Navigation Issues:**
   For each dead end or broken route found:
   - Add proper back navigation
   - Fix broken router.push/replace calls
   - Add fallback navigation handlers
   - Ensure all modals have close buttons

**Files to Audit:**
- `app/_layout.tsx` - Root layout
- `app/tabs/_layout.tsx` - Tab navigation (if exists)
- `app/(admin)/_layout.tsx` - Admin layout
- All screen files in `app/` subdirectories
- `components/` for navigation-related components

**Expected Deliverables:**
- Complete route map document
- List of dead ends found
- PR fixing all navigation issues
```

**Branch:** `fix/routing-dead-ends`

**Time:** 1-2 days

---

### ✨ PR #A3: App Polish & UX Improvements

**Prompt for Copilot:**

```
@copilot Please review and improve the overall app polish and user experience:

1. **Loading State Audit:**
   - Ensure all async operations show loading indicators
   - Add skeleton loaders where missing
   - Implement proper loading state management
   - Add shimmer effects for better perceived performance
   - Files to check: All screen files, service calls, form submissions

2. **Empty State Improvements:**
   - Review all list screens for empty states
   - Ensure empty states have helpful messaging and CTAs
   - Add illustrations or icons to empty states
   - Make empty states actionable (e.g., "Create your first bounty")

3. **Error State Polish:**
   - Review error handling in `lib/utils/error-handler.ts` or similar
   - Ensure all API calls have error catching
   - Add user-friendly error messages (avoid technical jargon)
   - Implement retry functionality for failed requests
   - Add offline state handling

4. **Animation & Transitions:**
   - Add smooth transitions between screens
   - Implement micro-animations for interactions
   - Add haptic feedback for key actions
   - Ensure animations respect reduced motion preferences

5. **Form UX Improvements:**
   - Review all forms for proper validation feedback
   - Add inline validation where missing
   - Improve keyboard handling (next field focus, dismiss on submit)
   - Add proper input types and autocomplete hints
   - Files: `app/auth/*.tsx`, `app/screens/CreateBounty/`, form components

6. **Accessibility Improvements:**
   - Add missing accessibility labels
   - Ensure proper contrast ratios
   - Check touch target sizes (minimum 44x44)
   - Add screen reader support where missing
   - Test with VoiceOver/TalkBack considerations

7. **Performance Quick Wins:**
   - Identify and memo-ize expensive renders
   - Optimize list rendering (FlatList optimizations)
   - Check for memory leaks in subscriptions/listeners
   - Lazy load heavy components

**Expected Deliverables:**
- List of UX issues found with severity
- PR with polish improvements
- Before/after screenshots for UI changes
```

**Branch:** `polish/ux-improvements`

**Time:** 3-4 days

---

### 🔧 PR #A4: Residual MVP Work - Age Verification Persistence

**Prompt for Copilot:**

```
@copilot The 18+ age verification checkbox exists in sign-up but the value isn't persisted. Please implement:

1. **Database Changes:**
   Add to users table or profiles table in Supabase:
   ```sql
   ALTER TABLE profiles ADD COLUMN age_verified BOOLEAN DEFAULT FALSE;
   ALTER TABLE profiles ADD COLUMN age_verified_at TIMESTAMP;
   ```

2. **Sign-Up Form Updates:**
   - File: `app/auth/sign-up-form.tsx`
   - Capture the "I confirm I am 18 years or older" checkbox state
   - Pass `age_verified: true` and `age_verified_at: new Date().toISOString()` to the sign-up API

3. **Backend/API Updates:**
   - Update user creation API to accept and store age_verified fields
   - Add validation to ensure age_verified is true for account creation

4. **Type Updates:**
   - Update user/profile types in `lib/types.ts` or `types/`
   - Add age_verified and age_verified_at fields

5. **Profile Display:**
   - Optionally show "Age Verified ✓" badge on profile
   - Use this for gating payment features if not verified

**Expected Deliverables:**
- Database migration SQL
- Updated sign-up form
- Updated API endpoint
- Updated types
- Test the full flow
```

**Branch:** `feat/age-verification-persistence`

**Time:** 0.5-1 day

---

### 🔧 PR #A5: Residual MVP Work - External Policy URLs

**Prompt for Copilot:**

```
@copilot The Privacy Policy and Terms of Service need external URLs for App Store Connect. Please implement:

1. **Create Static HTML Pages:**
   Create in `docs/` or new `public/` directory:
   - `privacy-policy.html` - Copy content from in-app Legal section
   - `terms-of-service.html` - Copy content from in-app Legal section
   - Add BOUNTYExpo branding and responsive styling

2. **GitHub Pages Setup:**
   - Create `.github/workflows/pages.yml` for GitHub Pages deployment
   - Or create simple `index.html` that links to both documents

3. **Update App References:**
   - In Settings/Legal section, add "View on Web" links
   - Update `app.json` with privacy policy URL field

4. **Verify Content:**
   - Ensure policies match Apple/Google requirements
   - Include: data collection, third-party services, user rights, contact info
   - Add effective date

**Expected URLs (after deployment):**
- https://kodaksax.github.io/bountyexpo/privacy-policy
- https://kodaksax.github.io/bountyexpo/terms-of-service

**Expected Deliverables:**
- HTML files for both policies
- GitHub Pages workflow
- Updated app references
```

**Branch:** `feat/external-policy-urls`

**Time:** 0.5 day

---

### 🔧 PR #A6: Residual MVP Work - Content Moderation Admin Panel

**Prompt for Copilot:**

```
@copilot Build a content moderation admin panel to review user reports:

1. **Create Reports Admin Screen:**
   - File: `app/(admin)/reports.tsx`
   - List all pending reports from `reports` table
   - Show: reporter, reported content type, reason, timestamp
   - Add filter by status (pending, reviewed, dismissed, actioned)

2. **Report Detail View:**
   - Show full report details
   - Preview the reported content (bounty/user/message)
   - Show reporter's history (number of reports made)
   - Show reported user's history (times reported)

3. **Moderation Actions:**
   - Dismiss report (false positive)
   - Warn user (send notification)
   - Remove content (soft delete)
   - Suspend user (temporary ban)
   - Ban user (permanent)
   - Add notes for audit trail

4. **Backend Endpoints:**
   - `GET /api/admin/reports` - List reports with pagination
   - `GET /api/admin/reports/:id` - Report details
   - `POST /api/admin/reports/:id/action` - Take moderation action
   - Add proper admin authentication

5. **Database Tables (if not exists):**
   ```sql
   CREATE TABLE moderation_actions (
     id UUID PRIMARY KEY,
     report_id UUID REFERENCES reports(id),
     admin_id UUID REFERENCES users(id),
     action TEXT, -- 'dismiss', 'warn', 'remove', 'suspend', 'ban'
     notes TEXT,
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

6. **Notifications:**
   - Notify user when action taken against them
   - Notify reporter when their report is resolved

**Expected Deliverables:**
- Admin reports screen
- Report detail modal
- Backend endpoints
- Database migrations
- Notification triggers
```

**Branch:** `feat/content-moderation-admin`

**Time:** 2-3 days

---

### 🔧 PR #A7: Residual MVP Work - App Store Assets

**Prompt for Copilot:**

```
@copilot Help prepare App Store submission assets:

1. **App Store Screenshots:**
   Review the app and identify the 6 best screens to showcase:
   - Onboarding/Welcome screen
   - Bounty feed/discovery
   - Bounty creation
   - Messaging
   - Profile
   - Wallet/Payments

2. **Screenshot Requirements:**
   - 6.7" Super Retina (1290 x 2796) - iPhone 15 Pro Max
   - 6.5" Super Retina (1242 x 2688) - iPhone 11 Pro Max
   - 5.5" Retina (1242 x 2208) - iPhone 8 Plus
   - Optional: iPad Pro 12.9" (2048 x 2732)

3. **App Description Draft:**
   Create `docs/app-store-description.md`:
   ```markdown
   # BOUNTYExpo
   
   **Subtitle:** Connect. Complete. Get Paid.
   
   **Description:** (max 4000 chars)
   Find and post small jobs in your community...
   
   **Keywords:** (max 100 chars, comma-separated)
   bounty, gigs, tasks, local jobs, freelance...
   
   **What's New:** (for updates)
   - Initial release
   ```

4. **App Icon Verification:**
   - Verify `assets/icon.png` is 1024x1024
   - Check icon meets Apple guidelines (no transparency, no text)

5. **Privacy Questionnaire Prep:**
   Document what data the app collects:
   - Contact info (email)
   - Identifiers (user ID)
   - Usage data (analytics)
   - Financial info (payment methods)
   - User content (bounties, messages)

**Expected Deliverables:**
- Screenshot identification guide
- App Store description document
- Privacy questionnaire answers
- Verification of icon requirements
```

**Branch:** `docs/app-store-assets`

**Time:** 1-2 days

---

### 🔧 PR #A8: Complete Escrow Payment Flows

**Prompt for Copilot:**

```
@copilot Review and complete the escrow payment implementation:

1. **Escrow Flow Audit:**
   Review existing implementation in:
   - `lib/services/payment-service.ts` or similar
   - `api/` payment endpoints
   - `components/` payment-related components
   - Wallet screen integration

2. **Implement Missing Pieces:**
   
   **On Bounty Acceptance (if not done):**
   ```typescript
   // Create PaymentIntent with manual capture
   const paymentIntent = await stripe.paymentIntents.create({
     amount: bountyAmount * 100, // cents
     currency: 'usd',
     capture_method: 'manual',
     metadata: { bounty_id, poster_id, hunter_id }
   });
   ```

   **On Completion Approval:**
   ```typescript
   // Capture the held funds
   await stripe.paymentIntents.capture(paymentIntentId);
   
   // Transfer to hunter (minus platform fee)
   const platformFee = amount * 0.10; // 10%
   await stripe.transfers.create({
     amount: (amount - platformFee) * 100,
     currency: 'usd',
     destination: hunterStripeAccountId
   });
   ```

   **On Cancellation/Dispute:**
   ```typescript
   // Cancel the PaymentIntent to release the hold
   await stripe.paymentIntents.cancel(paymentIntentId);
   ```

3. **UI Updates:**
   - Show escrow status on bounty detail
   - Show payment progress (held → released)
   - Add release funds button for poster
   - Show earnings in hunter wallet

4. **Edge Cases:**
   - Payment method declined
   - Insufficient funds
   - Stripe account not connected
   - Partial refunds for disputes

**Expected Deliverables:**
- Completed escrow flow
- UI updates showing payment status
- Error handling for all edge cases
- End-to-end test documentation
```

**Branch:** `feat/complete-escrow-flows`

**Time:** 2-3 days

---

### 🔧 PR #A9: Automated Testing Suite

**Prompt for Copilot:**

```
@copilot Create an automated testing suite for the MVP:

1. **Testing Setup:**
   - Configure Jest for React Native
   - Set up React Native Testing Library
   - Create test utilities and mocks

2. **Unit Tests (Target: 70% coverage for services):**
   
   **Auth Services:**
   - `lib/services/auth-service.ts` (or equivalent)
   - Test: login, signup, logout, password reset
   - Mock Supabase client

   **Payment Services:**
   - Test: create payment, escrow, release, refund
   - Mock Stripe API

   **Bounty Services:**
   - Test: create, update, apply, accept, complete
   - Mock database calls

3. **Component Tests:**
   - Test key form components render correctly
   - Test form validation
   - Test button interactions
   - Files: Sign-in form, Sign-up form, Create Bounty steps

4. **Integration Tests:**
   - Test complete auth flow
   - Test bounty creation flow
   - Test navigation flows

5. **Test File Structure:**
   ```
   tests/
   ├── unit/
   │   ├── services/
   │   │   ├── auth-service.test.ts
   │   │   ├── payment-service.test.ts
   │   │   └── bounty-service.test.ts
   │   └── utils/
   │       └── validators.test.ts
   ├── components/
   │   ├── SignInForm.test.tsx
   │   └── CreateBountyForm.test.tsx
   └── integration/
       └── auth-flow.test.tsx
   ```

6. **CI Integration:**
   - Add GitHub Actions workflow for tests
   - Run tests on PR
   - Report coverage

**Expected Deliverables:**
- Jest configuration
- Test utilities and mocks
- Unit tests for services (70%+ coverage)
- Component tests for key forms
- GitHub Actions workflow
```

**Branch:** `test/automated-testing-suite`

**Time:** 3-5 days

---

## 📋 Quick Reference: Copilot Agent Commands

| Task | Prompt Start |
|------|--------------|
| Full Flow Review | `@copilot Please perform a comprehensive code review of the BOUNTYExpo app...` |
| Routing Audit | `@copilot Please perform a complete routing audit...` |
| UX Polish | `@copilot Please review and improve the overall app polish...` |
| Age Verification | `@copilot The 18+ age verification checkbox exists but isn't persisted...` |
| External Policies | `@copilot The Privacy Policy and Terms need external URLs...` |
| Content Moderation | `@copilot Build a content moderation admin panel...` |
| App Store Assets | `@copilot Help prepare App Store submission assets...` |
| Escrow Completion | `@copilot Review and complete the escrow payment implementation...` |
| Automated Tests | `@copilot Create an automated testing suite for the MVP...` |

---

## 🎯 Recommended Execution Order

1. **PR #A1: Flow Review** - Find bugs first (2-3 days)
2. **PR #A2: Routing Audit** - Fix dead ends (1-2 days)
3. **PR #A3: UX Polish** - Improve experience (3-4 days)
4. **PR #A4-A5: Quick Wins** - Age verification + Policies (1 day)
5. **PR #A6: Moderation** - Admin panel (2-3 days)
6. **PR #A7: App Store Assets** - Prepare submission (1-2 days)
7. **PR #A8: Escrow** - Complete payments (2-3 days)
8. **PR #A9: Testing** - Automated tests (3-5 days)

**Total: 16-23 days with 1-2 developers**

---

## ✅ Success Criteria

After completing all Copilot agent PRs:

- [ ] All user flows work end-to-end without errors
- [ ] No navigation dead ends
- [ ] All screens have loading, empty, and error states
- [ ] Age verification persisted to database
- [ ] Policies accessible via external URLs
- [ ] Content moderation queue in admin
- [ ] App Store assets ready
- [ ] Escrow payments fully functional
- [ ] 70%+ test coverage on critical paths
- [ ] Ready for App Store submission

---
