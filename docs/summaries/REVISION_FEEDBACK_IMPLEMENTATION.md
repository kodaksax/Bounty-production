# Bounty Revision Feedback System - Implementation Summary

## Problem Statement
When a poster requests revisions (rejects payment) on a bounty, there was no modal or system for relaying comments to the hunter or notifying them in-app that the work was reviewed and found unsatisfactory.

## Solution Overview
Implemented a comprehensive revision feedback system with:
1. **Persistent Visual Indicators** - Banner component in hunter's Work in Progress section
2. **In-App Notifications** - Notification service integration for revision requests
3. **Messaging Integration** - System messages sent to conversation
4. **Stepper Regression** - Visual bubble stepper automatically moves back to appropriate stage

## Changes Made

### 1. Backend API Integration (`services/api/src/services/notification-service.ts`)
```typescript
async notifyRevisionRequest(hunterId: string, bountyId: string, bountyTitle: string, feedback: string) {
  return this.createNotification({
    userId: hunterId,
    type: 'completion',
    title: 'Revision Requested',
    body: `The poster requested changes to "${bountyTitle}". Check the feedback and resubmit.`,
    data: { bountyId, feedback, isRevision: true },
  });
}
```

### 2. New UI Components

#### RevisionFeedbackBanner (`components/ui/revision-feedback-banner.tsx`)
- Prominent yellow/amber bordered banner
- Displays poster's feedback in a highlighted box
- Shows action hint with icon
- Dismissible by hunter
- Visual styling:
  - Yellow border and background tint
  - Feedback icon
  - Clear separation of feedback text
  - Action hint at bottom

#### SystemMessage (`components/SystemMessage.tsx`)
- Displays system notifications in chat
- Supports different types: info, warning, revision
- Appears as centered message in conversation
- Distinct styling from user messages

### 3. Updated Components

#### `components/my-posting-expandable.tsx`
**State Management:**
- Added `revisionFeedback` state to track poster's feedback
- Added `showRevisionBanner` state to control banner visibility

**Subscription Logic:**
```typescript
// Subscribe to submission updates
if (!isOwner && submission.status === 'revision_requested') {
  // Store feedback and show banner instead of alert
  setRevisionFeedback(submission.poster_feedback || 'The poster has requested changes to your work.')
  setShowRevisionBanner(true)
  setLocalStageOverride('working_progress')
  setWipExpanded(true)
  setReviewExpanded(false)
  setSubmissionPending(false)
  setHasSubmission(false)
}
```

**UI Integration:**
- RevisionFeedbackBanner shown at top of Work in Progress section
- Banner appears immediately when revision is detected via realtime subscription
- Stepper automatically regresses to "Working Progress" stage
- Review section collapses, WIP section expands

#### `lib/services/completion-service.ts`
**Enhanced `requestRevision` method:**
```typescript
async requestRevision(submissionId: string, feedback: string): Promise<boolean> {
  // Update submission status in database
  // Get bounty conversation
  // Send system message to conversation with revision feedback
  // Message format: "🔄 Revision requested: {feedback}"
}
```

## User Flow

### Poster's Perspective:
1. Hunter submits work for review
2. Poster opens Review Modal
3. Poster clicks "Request Changes"
4. Enters feedback in text area
5. Clicks "Send Feedback"
6. Hunter is notified via:
   - Push notification (if enabled)
   - In-app notification badge
   - System message in conversation
   - Banner in bounty card

### Hunter's Perspective:
1. Receives push notification: "Revision Requested"
2. Opens app, sees notification badge
3. Opens bounty in "My Bounties" (in_progress)
4. Expands bounty card
5. Sees:
   - **Stepper regressed** to "Working Progress" stage (bubble #2)
   - **Prominent yellow banner** at top of WIP section with feedback
   - **System message** in conversation (if they check messages)
6. Can dismiss banner after reading
7. Makes requested changes
8. Re-submits work using same flow

## Visual Hierarchy

```
┌─────────────────────────────────────────┐
│ Bounty Card (collapsed)                 │
│ [Status: in_progress]                   │
└─────────────────────────────────────────┘
                 ▼ (tap to expand)
┌─────────────────────────────────────────┐
│ ◉──────○──────○──────○  (Stepper)      │
│  Apply  Working  Review  Payout         │
│                                         │
│ ┌─────────────────────────────────────┐│
│ │ 🔔 REVISION REQUESTED               ││
│ │                                     ││
│ │ Poster Feedback:                    ││
│ │ ┌─────────────────────────────────┐││
│ │ │ "The logo needs to be centered  │││
│ │ │  and the background color       │││
│ │ │  should be darker."             │││
│ │ └─────────────────────────────────┘││
│ │                                     ││
│ │ ℹ️  Address the feedback and        ││
│ │    resubmit your work when ready.  ││
│ └─────────────────────────────────────┘│
│                                         │
│ [Attachments]                           │
│ [Ready to Submit Button]                │
└─────────────────────────────────────────┘
```

## Technical Details

### Realtime Updates
- Uses Supabase realtime subscriptions to `completion_submissions` table
- Instant notification when status changes to `revision_requested`
- No polling required - event-driven architecture

### State Synchronization
- Component state automatically updates via subscription
- Stepper position calculated from local state override
- Banner visibility controlled independently (can be dismissed)
- No page refresh needed

### Data Flow
```
Poster → Review Modal → requestRevision()
                            ↓
                    Supabase Update
                            ↓
                    Realtime Event
                            ↓
                   Hunter's Component
                            ↓
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                  ↓
    State Update    Stepper Regress    Show Banner
```

## Benefits

1. **No More Missed Revisions**: Persistent banner ensures hunter sees feedback
2. **Clear Communication**: Poster's exact feedback displayed prominently
3. **Visual Progress**: Stepper shows regression clearly
4. **Multiple Touchpoints**: Notifications + banner + messaging = comprehensive coverage
5. **User-Friendly**: Dismissible banner doesn't block workflow
6. **Realtime**: Instant updates via Supabase subscriptions

## Testing Checklist

- [ ] Poster can request revisions with feedback
- [ ] Hunter receives notification
- [ ] Banner appears in hunter's WIP section
- [ ] Feedback text displays correctly
- [ ] Banner is dismissible
- [ ] Stepper regresses to correct stage
- [ ] System message appears in conversation
- [ ] Hunter can resubmit after addressing feedback
- [ ] Works on both iOS and Android
- [ ] Handles long feedback text gracefully
- [ ] Multiple revision requests work correctly

## Future Enhancements

1. Track revision count and display it
2. Add revision history viewer
3. Show side-by-side comparison of original and revised submission
4. Add "Mark as Addressed" checkbox for each feedback point
5. Implement revision deadline tracking
6. Add poster notification when hunter resubmits after revision
