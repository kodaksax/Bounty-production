# Bounty Acceptance Flow - Testing Guide

## Overview
This guide describes how to manually test the bounty acceptance flow and work in progress management features.

## Features Implemented

### 1. **Request Acceptance & Status Updates**
When a Poster accepts a Hunter's request:
- ✅ Bounty status changes to `in_progress`
- ✅ The accepted hunter is stored in `bounty.accepted_by`
- ✅ All competing requests for that bounty are automatically deleted
- ✅ A conversation is created/linked for the Poster-Hunter pair
- ✅ Escrow transaction is created (for paid bounties)
- ✅ Initial welcome message is sent to the conversation

### 2. **Progress Stepper Component**
- ✅ Reusable `Stepper` component displays progress bubbles
- ✅ Shows 4 stages: Apply & Work → Working Progress → Review & Verify → Payout
- ✅ Active stage is highlighted in green
- ✅ Completed stages are shown in darker green
- ✅ Updates based on bounty status

### 3. **Work in Progress Section**
Animated collapsible section that appears when bounty status is `in_progress`.

**Poster View:**
- ✅ **Message Bar**: Quick messaging input to send messages to the hunter
- ✅ **Attachments Panel**: Displays files attached during bounty posting
- ✅ **Rating Widget**: 1-5 star rating draft (stored locally, not published until completion)

**Hunter View:**
- ✅ **Instructions**: Informational text guiding the hunter to complete work
- ✅ **Attachments Panel**: Shows bounty attachments for reference
- ✅ **Next Button**: Navigates to the review-and-verify step

### 4. **UI Components**
New reusable components in `components/ui/`:
- `stepper.tsx` - Progress timeline with bubbles
- `animated-section.tsx` - Collapsible section with animation
- `message-bar.tsx` - Message input with send button
- `attachments-list.tsx` - File list display
- `rating-stars.tsx` - Star rating widget

### 5. **Data Model Extensions**
New types in `lib/types.ts`:
- `Request` - Bounty request with status
- `Attachment` - File metadata for bounties

## Testing Instructions

### Prerequisites
1. At least 2 user accounts (Poster and Hunter)
2. Database with bounties table
3. Running API server with bounty-requests endpoints

### Test Scenario 1: Accept a Request (Happy Path)

**Setup:**
1. Login as Poster (User A)
2. Create a bounty with attachments (optional but recommended for full test)
3. Note the bounty ID

**As Hunter (User B):**
1. Navigate to Postings screen
2. Find the bounty created by User A
3. Apply to the bounty
4. Navigate to "In Progress" tab
5. Verify the bounty appears with "pending" status
6. Note: The expanded view should show "Your application is pending..."

**As Poster (User A):**
1. Navigate to Postings → "Requests" tab
2. Find User B's request
3. Tap "Accept" on User B's request
4. Confirm sufficient balance (for paid bounties)
5. Accept the request

**Expected Results:**
- ✅ Alert shown: "Request Accepted" with escrow and conversation info
- ✅ Request disappears from "Requests" tab
- ✅ Bounty moves to "My Postings" tab with status `in_progress`
- ✅ First progress bubble is filled (Apply & Work → Working Progress)
- ✅ "Work in progress" section appears when expanded
- ✅ Message bar is visible
- ✅ Attachments panel shows files (if any were added)
- ✅ Rating widget shows 5 empty stars

**As Hunter (User B):**
1. Navigate to "In Progress" tab
2. Find the accepted bounty
3. Expand the bounty card

**Expected Results:**
- ✅ First progress bubble is filled
- ✅ "Work in progress" section appears
- ✅ Instructions text: "Begin work on the bounty; once complete press the next button."
- ✅ Attachments panel shows files
- ✅ "Next" button is visible
- ✅ Tapping "Next" navigates to review-and-verify screen

### Test Scenario 2: Competing Requests Cleanup

**Setup:**
1. Login as Poster (User A)
2. Create a bounty
3. Have 3 different hunters (User B, C, D) apply to the same bounty

**Test:**
1. As Poster, navigate to "Requests" tab
2. Verify all 3 requests are visible
3. Accept User B's request

**Expected Results:**
- ✅ User B's request is accepted
- ✅ User C and D's requests disappear from the Requests tab immediately
- ✅ Bounty status changes to `in_progress`

**As User C or D:**
1. Navigate to "In Progress" tab

**Expected Results:**
- ✅ The bounty no longer appears (their request was deleted)

### Test Scenario 3: Reject a Request

**Setup:**
1. Create a bounty with 2 applicants

**Test:**
1. As Poster, navigate to "Requests" tab
2. Tap "Reject" on one request
3. Confirm rejection

**Expected Results:**
- ✅ Alert shown: "Request Rejected"
- ✅ Request disappears from list
- ✅ Bounty remains "open"
- ✅ Other requests are unaffected

**As Rejected Hunter:**
1. Navigate to "In Progress" tab

**Expected Results:**
- ✅ Bounty no longer appears in the list

### Test Scenario 4: Messaging Integration

**Setup:**
1. Have an accepted bounty (User A as Poster, User B as Hunter)

**As Poster (User A):**
1. Navigate to "My Postings" tab
2. Expand the in-progress bounty
3. Expand "Work in progress" section
4. Type a message in the message bar
5. Tap send

**Expected Results:**
- ✅ Message is sent successfully
- ✅ Loading indicator appears briefly
- ✅ Input field clears after sending
- ✅ No error alert

**As Hunter (User B):**
1. Navigate to Messenger/Chat tab
2. Find the conversation for this bounty

**Expected Results:**
- ✅ Conversation exists
- ✅ Poster's message is visible
- ✅ Can reply from chat

### Test Scenario 5: Rating Draft

**As Poster with in-progress bounty:**
1. Navigate to "My Postings" tab
2. Expand an in-progress bounty
3. Expand "Work in progress" section
4. Tap stars to set rating (e.g., 4 stars)
5. Collapse and re-expand the section

**Expected Results:**
- ✅ Rating is saved locally
- ✅ Rating persists when re-expanding
- ✅ Rating is not published (stays in draft)

## Edge Cases to Test

### Edge Case 1: No Attachments
- Create bounty without attachments
- Accept hunter
- Verify "No attachments" message is shown in Work in Progress section

### Edge Case 2: No Conversation
- If conversation creation fails
- Verify error is logged but acceptance proceeds
- Message bar should show "No conversation found" alert when trying to send

### Edge Case 3: Insufficient Balance
- As Poster with balance < bounty amount
- Try to accept a request for paid bounty
- Verify alert prompts to add money
- Verify request is NOT accepted

### Edge Case 4: Network Failure
- Simulate network failure during acceptance
- Verify error is shown
- Verify state is not corrupted
- Verify retry is possible

## Known Limitations

1. **Rating Draft Persistence**: Rating draft is stored in component state, not persisted across app restarts
2. **Attachment Downloads**: Currently shows files but doesn't support download/preview
3. **Offline Support**: Changes require network connection; no offline queue yet
4. **Real-time Updates**: Other users won't see changes until they refresh

## Component Architecture

```
PostingsScreen
├── MyPostingExpandable (owner view)
│   ├── BountyCard
│   ├── Stepper (progress bubbles)
│   ├── AnimatedSection (Work in progress)
│   │   ├── MessageBar
│   │   ├── AttachmentsList
│   │   └── RatingStars
│   └── Quick Actions
└── MyPostingExpandable (hunter view)
    ├── BountyCard
    ├── Stepper
    ├── AnimatedSection (Work in progress)
    │   ├── Instructions
    │   ├── AttachmentsList
    │   └── Next Button
    └── Quick Actions
```

## Files Changed

### New Files
- `components/ui/stepper.tsx`
- `components/ui/animated-section.tsx`
- `components/ui/message-bar.tsx`
- `components/ui/attachments-list.tsx`
- `components/ui/rating-stars.tsx`

### Modified Files
- `lib/types.ts` (added Request and Attachment types)
- `app/tabs/postings-screen.tsx` (enhanced accept/reject handlers)
- `components/my-posting-expandable.tsx` (integrated Work in Progress section)

## Troubleshooting

### Issue: Work in Progress section doesn't appear
**Solution:** Check bounty status is exactly "in_progress" (case-sensitive)

### Issue: Message sending fails
**Solution:** Verify conversation exists for the bounty, check message-service implementation

### Issue: Competing requests not removed
**Solution:** Check bountyRequestService.delete() is working, verify database foreign keys

### Issue: Progress bubbles not updating
**Solution:** Ensure bounty status is being updated correctly, check Stepper activeIndex calculation

## API Requirements

The following backend endpoints must be implemented:

1. `PATCH /api/bounties/:id` - Update bounty status and accepted_by
2. `DELETE /api/bounty-requests/:id` - Delete a request
3. `GET /api/conversations` - List conversations
4. `POST /api/conversations/:id/messages` - Send message

## Future Enhancements

- [ ] Persist rating draft to secure storage
- [ ] Add attachment preview/download
- [ ] Real-time updates via websockets
- [ ] Offline support with queue
- [ ] Dispute flow for rejected work
- [ ] Completion confirmation with final rating publication
