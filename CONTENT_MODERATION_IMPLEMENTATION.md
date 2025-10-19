# Content Moderation and Reporting System

## Overview
This document describes the comprehensive content moderation and reporting system implemented for BOUNTYExpo. The system enables users to report inappropriate content and block other users, while providing administrators with tools to review and act on reports.

## Features Implemented

### 1. Report Submission
Users can report three types of content:
- **Bounties**: Report inappropriate or fraudulent job postings
- **User Profiles**: Report suspicious or offensive profiles
- **Messages**: Report inappropriate messages in chat

#### Report Categories
- **Spam**: Unsolicited or repetitive content
- **Harassment**: Bullying or threatening behavior
- **Inappropriate**: Content that violates community guidelines
- **Fraud**: Scams or deceptive practices

### 2. User Blocking
Users can block and unblock other users:
- Blocked users cannot contact the blocker
- Block status is persisted in database
- Visual feedback in UI (Block/Unblock button)
- Prevents self-blocking

### 3. Admin Moderation Panel
Administrators have access to:
- **Reports Dashboard**: View and filter all reports
- **Status Management**: Update report status (pending/reviewed/resolved/dismissed)
- **Blocked Users**: View and manage block relationships

## Database Schema

### Reports Table
```sql
CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_type text NOT NULL, -- 'bounty', 'profile', 'message'
    content_id text NOT NULL,
    reason text NOT NULL, -- 'spam', 'harassment', 'inappropriate', 'fraud'
    details text,
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_content_type ON reports(content_type);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_created_at ON reports(created_at);
```

### Blocked Users Table
```sql
CREATE TABLE blocked_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id),
    CONSTRAINT no_self_block CHECK (blocker_id != blocked_id)
);

-- Indexes for quick lookups
CREATE INDEX idx_blocked_users_blocker_id ON blocked_users(blocker_id);
CREATE INDEX idx_blocked_users_blocked_id ON blocked_users(blocked_id);
```

## API Endpoints

### POST /api/reports
Create a new report.

**Request Body:**
```json
{
  "user_id": "uuid",
  "content_type": "bounty|profile|message",
  "content_id": "string",
  "reason": "spam|harassment|inappropriate|fraud",
  "details": "optional additional context"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "content_type": "bounty",
  "content_id": "123",
  "reason": "spam",
  "details": "...",
  "status": "pending",
  "created_at": "2025-10-19T19:00:00.000Z",
  "updated_at": "2025-10-19T19:00:00.000Z"
}
```

### GET /api/reports
Retrieve reports with optional filtering.

**Query Parameters:**
- `status`: Filter by status (pending/reviewed/resolved/dismissed)
- `content_type`: Filter by content type (bounty/profile/message)

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "content_type": "bounty",
    "content_id": "123",
    "reason": "fraud",
    "details": "...",
    "status": "pending",
    "created_at": "2025-10-19T19:00:00.000Z",
    "updated_at": "2025-10-19T19:00:00.000Z"
  }
]
```

### PATCH /api/reports/:id
Update report status (admin only).

**Request Body:**
```json
{
  "status": "reviewed|resolved|dismissed"
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "reviewed",
  "updated_at": "2025-10-19T19:30:00.000Z"
}
```

## Services

### report-service.ts
Handles report operations with Supabase integration:
- `reportBounty(bountyId, reason, details)`: Report a bounty
- `reportUser(userId, reason, details)`: Report a user profile
- `reportMessage(messageId, reason, details)`: Report a message
- `getAllReports(filters)`: Fetch reports with filtering
- `updateReportStatus(reportId, status)`: Update report status

### blocking-service.ts
Manages user blocking functionality:
- `blockUser(blockedId)`: Block a user
- `unblockUser(blockedId)`: Unblock a user
- `isUserBlocked(userId)`: Check if a user is blocked
- `getBlockedUsers()`: Get list of blocked users

## UI Components

### ReportModal
A reusable modal component for submitting reports.

**Props:**
- `visible`: Boolean to control modal visibility
- `onClose`: Callback when modal is closed
- `contentType`: Type of content being reported (bounty/profile/message)
- `contentId`: ID of the content being reported
- `contentTitle`: Optional display name for the content

**Features:**
- Category selection with radio buttons
- Optional details text input
- Validation before submission
- Loading states
- Error handling
- Success confirmation

**Usage:**
```tsx
<ReportModal
  visible={showReportModal}
  onClose={() => setShowReportModal(false)}
  contentType="bounty"
  contentId="123"
  contentTitle="Lawn Mowing Job"
/>
```

### Admin Reports Screen
Located at `app/(admin)/reports.tsx`

**Features:**
- Filter tabs (Pending/All/Reviewed/Resolved/Dismissed)
- Report cards with:
  - Content type icon
  - Reason badge with color coding
  - Content ID and details
  - Timestamp
  - Action buttons (Mark Reviewed/Resolve/Dismiss)
- Pull-to-refresh
- Empty states
- Loading states

### Admin Blocked Users Screen
Located at `app/(admin)/blocked-users.tsx`

**Features:**
- List of all block relationships
- Shows blocker and blocked user info
- Timestamp of when block was created
- Remove block action
- Pull-to-refresh
- Empty states

## Integration Points

### 1. Bounty Detail Modal
- Report icon in header
- Opens ReportModal on tap
- Passes bounty ID and title

### 2. User Profile Page
- Three-dot menu with Report and Block options
- Block/Unblock toggles based on current status
- Opens ReportModal for reporting
- Confirmation dialogs for blocking actions

### 3. Chat Detail Screen
- Report option in message long-press menu
- Opens ReportModal with message ID
- Maintains message context

### 4. Admin Dashboard
- Quick links to Reports and Blocked Users screens
- Easy navigation from main admin panel

## User Flows

### Reporting Content
1. User encounters inappropriate content
2. User taps report icon/button
3. ReportModal opens with category selection
4. User selects a reason (required)
5. User optionally adds details
6. User taps "Submit Report"
7. Report is saved to database
8. User receives confirmation

### Blocking a User
1. User views another user's profile
2. User taps three-dot menu
3. User taps "Block"
4. Confirmation dialog appears
5. User confirms
6. Block relationship is created
7. UI updates to show "Unblock" option

### Admin Report Review
1. Admin navigates to Reports screen
2. Admin filters by status (default: Pending)
3. Admin reviews report details
4. Admin takes action:
   - Mark as Reviewed
   - Resolve (take action and close)
   - Dismiss (no action needed)
5. Report status updates
6. Report moves to appropriate filter

## Apple App Store Compliance

This implementation satisfies Apple's App Store Review Guidelines for content moderation:

✅ **2.3.8 - User-Generated Content**
- Provides mechanisms for reporting objectionable content
- Multiple report categories
- Admin moderation tools
- User blocking functionality

✅ **1.2 - User Safety**
- Enables users to protect themselves (blocking)
- Clear reporting process
- Timely review by moderators
- Action tracking and accountability

## Security Considerations

1. **Input Validation**: All API endpoints validate input data
2. **SQL Injection Prevention**: Uses parameterized queries
3. **Authorization**: Should add auth middleware to admin endpoints (TODO)
4. **Rate Limiting**: Consider adding rate limiting for report submissions (TODO)
5. **Cascade Deletes**: Reports and blocks are cleaned up when users are deleted

## Testing Checklist

- [ ] Submit report for bounty
- [ ] Submit report for profile
- [ ] Submit report for message
- [ ] Block user from profile
- [ ] Unblock user from profile
- [ ] View reports in admin panel
- [ ] Filter reports by status
- [ ] Filter reports by content type
- [ ] Update report status
- [ ] View blocked users in admin panel
- [ ] Remove block relationship
- [ ] Verify database constraints (no self-blocking, unique blocks)
- [ ] Verify cascade deletes work correctly
- [ ] Test with invalid data (validation)
- [ ] Test API endpoints directly

## Future Enhancements

1. **Email Notifications**: Notify admins of new reports
2. **Auto-moderation**: Automatic actions based on report patterns
3. **User Reputation**: Track user behavior and flag repeat offenders
4. **Appeal System**: Allow users to appeal moderation decisions
5. **Content Filtering**: Automatically hide reported content pending review
6. **Batch Actions**: Allow admins to act on multiple reports at once
7. **Analytics**: Dashboard showing moderation metrics
8. **IP Blocking**: Block users by IP address for severe violations

## Maintenance Notes

- Reports table will grow over time - consider archiving old resolved reports
- Monitor for abuse of reporting system (spam reports)
- Regularly review dismissed reports to identify patterns
- Keep report categories up to date with community needs
- Ensure admin access is properly restricted in production
