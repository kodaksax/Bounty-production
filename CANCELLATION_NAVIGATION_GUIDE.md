# Bounty Cancellation Navigation Flow - User Guide

## Overview
This document shows how users can navigate to the cancellation and dispute features from their bounty postings and in-progress work.

## Visual Navigation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  POSTINGS SCREEN NAVIGATION                      │
└─────────────────────────────────────────────────────────────────┘

┌────────────────────────┐
│   Postings Screen      │
│   (BottomNav → Posts)  │
└───────────┬────────────┘
            │
            ├─── My Postings Tab
            │    └─── Bounty Cards (Poster View)
            │         │
            │         ├─── Status: OPEN or IN_PROGRESS
            │         │    ├─── [Cancel] Button → /bounty/[id]/cancel
            │         │    │    (Request Cancellation Screen)
            │         │    │
            │         │    └─── Badges:
            │         │         • REVISION REQUESTED
            │         │         • REVIEW NEEDED
            │         │
            │         ├─── Status: CANCELLATION PENDING
            │         │    ├─── [View Request] Button → /bounty/[id]/cancellation-response
            │         │    │    (Review & Accept/Reject Screen)
            │         │    │
            │         │    └─── Badges:
            │         │         • CANCELLATION (orange)
            │         │
            │         └─── Status: CANCELLED (if disputed)
            │              └─── [View Dispute] Button → /bounty/[id]/dispute
            │                   (Dispute Details Screen)
            │
            └─── In Progress Tab
                 └─── Bounty Cards (Hunter View)
                      │
                      ├─── Hunter can see:
                      │    • CANCELLATION badge (if poster requested)
                      │    • DISPUTE badge (if dispute active)
                      │
                      └─── Hunter Actions:
                           • Can withdraw from bounty
                           • Can create counter-dispute if unfair


┌─────────────────────────────────────────────────────────────────┐
│                     BOUNTY CARD ANATOMY                          │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ [STATUS]  [CANCELLATION]  [DISPUTE]  [URGENT]       │  ← Badges
├──────────────────────────────────────────────────────┤
│ Bounty Title                                         │
│ Brief description of the work needed...              │
├──────────────────────────────────────────────────────┤
│ 📍 Location    💻 Work Type                          │
├──────────────────────────────────────────────────────┤
│ ⭐ 4.8 (23)                               $250       │
├──────────────────────────────────────────────────────┤
│ Your posting                                         │
│ [Edit] [Cancel] [View Request] [Share]              │  ← Actions
└──────────────────────────────────────────────────────┘

Status Badge Colors:
• OPEN: Green (#10b981)
• IN PROGRESS: Yellow (#fbbf24)
• CANCELLATION PENDING: Orange (#f97316)
• CANCELLED: Red (#ef4444)
• COMPLETED: Blue (#6366f1)

Indicator Badges:
• CANCELLATION: Orange background, shows when request pending
• DISPUTE: Red background, shows when dispute active
• REVISION REQUESTED: Amber background (hunter-facing)


┌─────────────────────────────────────────────────────────────────┐
│                  BUTTON VISIBILITY RULES                         │
└─────────────────────────────────────────────────────────────────┘

Poster (Owner) Buttons:

1. [Edit] Button
   • Visible: When status = OPEN or IN_PROGRESS
   • Hidden: When status = CANCELLED or CANCELLATION_REQUESTED
   • Action: Opens edit modal

2. [Delete] Button
   • Visible: Only when status = OPEN
   • Hidden: All other statuses
   • Action: Deletes the bounty

3. [Cancel] Button ← NEW
   • Visible: When status = OPEN or IN_PROGRESS
   • Hidden: When already cancelled/cancellation pending
   • Color: Orange (#f97316)
   • Action: Navigate to /bounty/[id]/cancel

4. [View Request] Button ← NEW
   • Visible: Only when status = CANCELLATION_REQUESTED
   • Color: Blue (#3b82f6)
   • Action: Navigate to /bounty/[id]/cancellation-response

5. [View Dispute] Button ← NEW
   • Visible: When hasDispute = true
   • Color: Red (#dc2626)
   • Action: Navigate to /bounty/[id]/dispute

6. [Share] Button
   • Always visible
   • Action: Opens native share sheet


┌─────────────────────────────────────────────────────────────────┐
│                    USER JOURNEY EXAMPLES                         │
└─────────────────────────────────────────────────────────────────┘

Example 1: Poster Cancels Open Bounty
─────────────────────────────────────
1. Navigate to Postings → My Postings tab
2. Find bounty with [OPEN] status
3. Tap on card to expand (see progress section)
4. See [Cancel] button in actions row
5. Tap [Cancel] → Navigate to /bounty/[id]/cancel
6. Fill reason, submit request
7. Bounty status changes to [CANCELLATION PENDING]
8. Hunter receives notification
9. [Cancel] button replaced with [View Request]

Example 2: Hunter Views Cancellation Request
────────────────────────────────────────────
1. Navigate to Postings → In Progress tab
2. Find bounty with [CANCELLATION] badge
3. Tap card to expand
4. See notification "Poster has requested cancellation"
5. Tap [View Request] → Navigate to /bounty/[id]/cancellation-response
6. Review reason and proposed refund
7. Choose: [Accept] or [Reject] or [Create Dispute]

Example 3: Poster Cancels In-Progress Work
──────────────────────────────────────────
1. Navigate to Postings → My Postings tab
2. Find bounty with [IN PROGRESS] status
3. Tap on card to expand
4. See [Cancel] button in actions row
5. Tap [Cancel] → Navigate to /bounty/[id]/cancel
6. System calculates 50% refund (work started)
7. Fill reason, submit request
8. Hunter must accept/reject/dispute

Example 4: Creating a Dispute
─────────────────────────────
1. Hunter receives cancellation with unfair terms
2. Navigate to /bounty/[id]/cancellation-response
3. Review request details
4. Tap [Create Dispute] at bottom
5. Navigate to /bounty/[id]/dispute
6. Fill dispute reason
7. Add text evidence
8. Submit for review
9. Both parties see [DISPUTE] badge on card


┌─────────────────────────────────────────────────────────────────┐
│                     MOBILE UI MOCKUP                             │
└─────────────────────────────────────────────────────────────────┘

My Postings Tab:
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │ [IN PROGRESS] [CANCELLATION] │
│ │ Website Redesign         │ │
│ │ Create a modern...       │ │
│ │ 📍 Online   💻 Remote    │ │
│ │ ⭐ 4.5 (12)        $500  │ │
│ │ ─────────────────────── │ │
│ │ Your posting             │ │
│ │ [Edit] [View Request]    │ │  ← View Request appears
│ │       [Share]            │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ [OPEN]                   │ │
│ │ Logo Design              │ │
│ │ Need a creative...       │ │
│ │ 📍 Remote   💻 Online    │ │
│ │ ⭐ 5.0 (8)         $250  │ │
│ │ ─────────────────────── │ │
│ │ Your posting             │ │
│ │ [Edit] [Cancel] [Share]  │ │  ← Cancel available
│ └──────────────────────────┘ │
└──────────────────────────────┘

In Progress Tab (Hunter View):
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │ [IN PROGRESS] [CANCELLATION] │  ← Hunter sees badge
│ │ Website Redesign         │ │
│ │ Create a modern...       │ │
│ │ Poster: John D.          │ │
│ │ Progress: 60%            │ │
│ │ ─────────────────────── │ │
│ │ [View Request] [Message] │ │  ← Can view details
│ └──────────────────────────┘ │
└──────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION NOTES                          │
└─────────────────────────────────────────────────────────────────┘

Files Modified:
1. components/bounty-card.tsx
   • Added onCancel, onViewCancellation, onViewDispute props
   • Added hasCancellationRequest, hasDispute state props
   • Added badges for cancellation and dispute indicators
   • Added conditional button rendering based on status
   • Added new status colors and labels

2. components/my-posting-expandable.tsx
   • Added useRouter hook for navigation
   • Added cancellationService and disputeService imports
   • Added state tracking for cancellation and dispute
   • Added handlers: handleCancelBounty, handleViewCancellation, handleViewDispute
   • Passed new props to BountyCard component
   • Checks for active cancellation/dispute on load

Key Features:
• Real-time status detection
• Badge indicators for pending actions
• Contextual button display based on bounty state
• Seamless navigation to cancellation flows
• Consistent with existing UI patterns
• Mobile-first responsive design


┌─────────────────────────────────────────────────────────────────┐
│                        TESTING GUIDE                             │
└─────────────────────────────────────────────────────────────────┘

Test Scenarios:

1. Verify Cancel Button Appears
   □ Create a bounty
   □ Navigate to My Postings
   □ Confirm [Cancel] button visible on OPEN bounties
   □ Accept a hunter
   □ Confirm [Cancel] button still visible on IN_PROGRESS

2. Verify Navigation to Cancel Screen
   □ Tap [Cancel] button
   □ Confirm navigation to /bounty/[id]/cancel
   □ Verify bounty details displayed correctly
   □ Verify refund calculation shown

3. Verify Cancellation Badge Appears
   □ Submit cancellation request
   □ Return to My Postings
   □ Confirm [CANCELLATION] badge visible
   □ Confirm [View Request] button replaced [Cancel]

4. Hunter Perspective
   □ Switch to hunter account
   □ Navigate to In Progress tab
   □ Confirm [CANCELLATION] badge visible on affected bounty
   □ Tap [View Request]
   □ Verify navigation to response screen

5. Dispute Flow
   □ Reject a cancellation
   □ Create dispute
   □ Return to postings
   □ Confirm [DISPUTE] badge visible
   □ Confirm [View Dispute] button appears

6. Edge Cases
   □ Cancelled bounties don't show [Edit] or [Cancel]
   □ Completed bounties don't show cancellation options
   □ Deleted bounties don't appear in lists


┌─────────────────────────────────────────────────────────────────┐
│                       ACCESSIBILITY                              │
└─────────────────────────────────────────────────────────────────┘

Accessibility Features:
• All buttons have accessible labels
• Status badges use color + text (not color alone)
• Touch targets are minimum 44x44 points
• Proper contrast ratios for all text
• Screen reader friendly navigation
• Clear visual hierarchy

Badge Indicators:
• Include icons + text for clarity
• Multiple visual cues (color + icon + text)
• High contrast for visibility
• Positioned consistently across cards
