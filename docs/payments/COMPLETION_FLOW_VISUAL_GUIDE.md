# Bounty Completion Flow - Visual Guide

## Overview
This diagram shows the complete flow from bounty acceptance through completion and payout.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BOUNTY COMPLETION FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐
│   OPEN      │  Status: open
│   Bounty    │  Hunter: Not assigned
└──────┬──────┘
       │
       │ Poster accepts hunter's request
       │ (handled by existing accept flow)
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ IN_PROGRESS                                                                  │
│ Status: in_progress                                                          │
│ Hunter: Assigned (accepted_by field)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
       │
       │ HUNTER ACTIONS                          POSTER ACTIONS
       │                                         │
       ▼                                         ▼
┌────────────────────┐                   ┌──────────────────────┐
│ 1. Work in         │                   │ Monitor progress     │
│    Progress        │◄──────────────────┤ via conversation     │
│                    │    Chat/Discuss   │                      │
└──────┬─────────────┘                   └──────────────────────┘
       │
       │ markReady(bountyId, hunterId)
       │ ✓ Persists ready record
       │ ✓ Triggers UI lock
       │ ✓ Calls onRefresh()
       │
       ▼
┌────────────────────┐                   ┌──────────────────────┐
│ 2. Ready to Submit │                   │ See "Hunter Ready"   │
│    (locked)        │───────────────────►│ badge                │
│                    │   subscribeReady   │                      │
└──────┬─────────────┘                   └──────────────────────┘
       │
       │ submitCompletion({
       │   bounty_id,
       │   hunter_id,
       │   message,
       │   proof_items
       │ })
       │ ✓ Creates submission (status: pending)
       │ ✓ Blocks duplicate submissions
       │ ✓ Calls onRefresh()
       │
       ▼
┌────────────────────┐                   ┌──────────────────────┐
│ 3. Waiting for     │                   │ See "Review          │
│    Review          │◄──────────────────┤ Submission" button   │
│    (locked)        │ subscribeSubmission│                      │
└────────────────────┘                   └──────┬───────────────┘
                                                 │
                          ┌──────────────────────┤
                          │                      │
                          ▼                      ▼
                   ┌──────────────┐      ┌──────────────────┐
                   │ REQUEST      │      │ APPROVE          │
                   │ REVISION     │      │ SUBMISSION       │
                   └──────┬───────┘      └─────┬────────────┘
                          │                    │
                          │ requestRevision    │ approveSubmission
                          │ (submissionId,     │ (bountyId, options)
                          │  feedback)         │ ✓ Approves submission
                          │ ✓ Sets status:     │ ✓ Updates bounty status
                          │   revision_requested  ✓ Escrow released
                          │ ✓ Calls onComplete()  ✓ Shows rating form
                          │                    │ ✓ Calls onComplete()
                          │                    │
                          ▼                    ▼
                   ┌──────────────┐      ┌──────────────────┐
                   │ Hunter flows │      │ COMPLETED        │
                   │ back to WIP  │      │ Status: completed│
                   │ with feedback│      └─────┬────────────┘
                   └──────┬───────┘            │
                          │                    │
                          │ Fix & resubmit     │
                          │                    ▼
                          │              ┌──────────────────┐
                          └──────────────►│ 4. PAYOUT        │
                                         │ ✓ Funds released  │
                                         │ ✓ Rating submitted│
                                         │ ✓ Honor card or   │
                                         │   receipt shown   │
                                         └──────────────────┘
```

## State Transitions

### Bounty Status Flow
```
open ──[accept]──► in_progress ──[approve]──► completed ──[archive]──► archived
                        │
                        └──[revision]──► (stays in_progress)
```

### Submission Status Flow
```
(none) ──[submit]──► pending ──┬──[approve]──► approved
                                │
                                └──[request_revision]──► revision_requested
                                                               │
                                                               └──[resubmit]──► pending
```

## Data Flow

### 1. Hunter Marks Ready
```
UI (MyPostingExpandable)
  │
  ├─► completionService.markReady(bountyId, hunterId)
  │     │
  │     └─► Supabase: INSERT INTO completion_ready
  │
  └─► onRefresh() → PostingsScreen.refreshAll()
        │
        └─► Refreshes both lists
```

### 2. Hunter Submits Completion
```
UI (MyPostingExpandable)
  │
  ├─► completionService.submitCompletion({...})
  │     │
  │     ├─► Check for duplicates
  │     │
  │     └─► Supabase: INSERT INTO completion_submissions
  │           (status: pending)
  │
  └─► onRefresh() → PostingsScreen.refreshAll()
```

### 3. Poster Approves
```
UI (PosterReviewModal)
  │
  ├─► completionService.approveSubmission(bountyId)
  │     │
  │     ├─► getSubmission(bountyId)
  │     │
  │     ├─► approveCompletion(submissionId)
  │     │     │
  │     │     └─► Supabase: UPDATE completion_submissions
  │     │           SET status = 'approved'
  │     │
  │     └─► bountyService.update(bountyId, {status: 'completed'})
  │           │
  │           └─► Supabase: UPDATE bounties SET status = 'completed'
  │
  ├─► releaseFunds(bountyId, hunterId, description)
  │     │
  │     └─► Wallet: Release escrow to hunter
  │
  ├─► Show rating form
  │
  └─► onComplete()
        │
        └─► MyPostingExpandable.onRefresh()
              │
              └─► PostingsScreen.refreshAll()
```

### 4. Poster Requests Revision
```
UI (PosterReviewModal)
  │
  └─► completionService.requestRevision(submissionId, feedback)
        │
        └─► Supabase: UPDATE completion_submissions
              SET status = 'revision_requested',
                  poster_feedback = feedback
              │
              └─► subscribeSubmission() detects change
                    │
                    └─► Hunter's UI shows alert and flows back to WIP
```

## Real-time Updates

### Subscription Mechanism
```
Component Mount
  │
  └─► completionService.subscribeReady(bountyId, callback)
  │     │
  │     ├─► If Supabase configured:
  │     │     └─► Set up realtime subscription
  │     │
  │     └─► Else:
  │           └─► Poll every 3 seconds
  │
  └─► completionService.subscribeSubmission(bountyId, callback)
        │
        └─► Same pattern (realtime or poll)

Component Unmount
  │
  └─► Call unsubscribe functions
```

## Database Schema

### completion_ready
```sql
CREATE TABLE completion_ready (
  bounty_id uuid PRIMARY KEY,
  hunter_id uuid NOT NULL,
  ready_at timestamptz DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_completion_ready_bounty_id 
  ON completion_ready(bounty_id, ready_at DESC);
```

### completion_submissions
```sql
CREATE TABLE completion_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL,
  hunter_id uuid NOT NULL,
  message text,
  proof_items jsonb,  -- Array of {id, type, name, size, url}
  status text CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected')),
  poster_feedback text,
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  revision_count integer DEFAULT 0
);

-- Indexes for fast lookups
CREATE INDEX idx_completion_submissions_bounty_id 
  ON completion_submissions(bounty_id, submitted_at DESC);

CREATE INDEX idx_completion_submissions_hunter_id 
  ON completion_submissions(hunter_id, submitted_at DESC);
```

## UI Components

### Component Hierarchy
```
PostingsScreen
  │
  ├─► Tab: "In Progress" (hunter view)
  │     │
  │     └─► FlatList
  │           │
  │           └─► MyPostingRow (variant='hunter')
  │                 │
  │                 └─► MyPostingExpandable
  │                       │
  │                       ├─► Work in Progress section
  │                       ├─► Review & Verify section
  │                       └─► Payout section
  │
  └─► Tab: "My Postings" (poster view)
        │
        └─► FlatList
              │
              └─► MyPostingRow (variant='owner')
                    │
                    └─► MyPostingExpandable
                          │
                          ├─► Work in Progress section
                          ├─► PosterReviewModal (when opened)
                          └─► Payout section
```

### Props Flow
```
PostingsScreen
  │
  ├─► refreshAll = useCallback(() => Promise.all([
  │       loadMyBounties(),
  │       loadInProgress()
  │     ]), [loadMyBounties, loadInProgress])
  │
  └─► MyPostingRow
        │ onRefresh={refreshAll}
        │
        └─► MyPostingExpandable
              │ onRefresh={onRefresh}
              │
              ├─► Calls onRefresh() after markReady
              ├─► Calls onRefresh() after submitCompletion
              └─► PosterReviewModal
                    │ onComplete={() => { onRefresh?.() }}
                    │
                    └─► Calls onComplete() after approve/revision
```

## Error Handling

### Graceful Degradation
```
1. Supabase Unavailable
   └─► Fall back to API endpoints
   
2. Realtime Subscriptions Fail
   └─► Fall back to polling (3s interval)
   
3. Rating Submission Fails
   └─► Complete anyway (bounty already approved)
         Show error but call onComplete()
   
4. Duplicate Submission
   └─► Detect and block with helpful message
         Return existing pending submission
   
5. Network Errors
   └─► Show user-friendly error
         Allow retry
         Don't break UI state
```

## Performance Considerations

### Optimizations
- **Indexes**: Fast lookups on bounty_id and hunter_id
- **Polling**: Only when realtime unavailable (3s interval)
- **Unsubscribe**: Proper cleanup on unmount
- **Parallel Refresh**: Both lists refresh with Promise.all
- **Optimistic UI**: Updates shown immediately, synced later

### Future Improvements
- Debounce refresh calls
- Cache submission data client-side
- Implement exponential backoff for polling
- Add pagination for large submission histories

---

## Quick Reference

### Key Methods
```typescript
// Hunter Actions
await completionService.markReady(bountyId, hunterId)
await completionService.submitCompletion({bounty_id, hunter_id, message, proof_items})

// Poster Actions
await completionService.approveSubmission(bountyId, options)
await completionService.requestRevision(submissionId, feedback)
await completionService.submitRating({bounty_id, from_user_id, to_user_id, rating, comment})

// Data Fetching
await completionService.getReady(bountyId)
await completionService.getSubmission(bountyId)

// Subscriptions
const unsubReady = completionService.subscribeReady(bountyId, callback)
const unsubSubmission = completionService.subscribeSubmission(bountyId, callback)
// Later: unsubReady(), unsubSubmission()
```

### Key Props
```typescript
// MyPostingExpandable
onRefresh?: () => void  // Refresh parent lists after actions

// PosterReviewModal
onComplete: () => void  // Notify parent of completion/revision
```
