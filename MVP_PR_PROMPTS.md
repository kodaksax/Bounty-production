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
