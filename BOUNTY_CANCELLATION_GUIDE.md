# Bounty Cancellation & Deletion Guide

## Overview
This document outlines the mechanics and implementation guidelines for handling premature bounty cancellations from both the poster and hunter perspectives. It covers the current implementation and provides recommendations for future enhancements.

## Current Implementation

### Status Lifecycle
Bounties in the system can have the following statuses:
- `open` - Newly posted, accepting applications
- `in_progress` - Accepted by a hunter, work ongoing
- `completed` - Work finished and payment released
- `archived` - Moved to archives, visible in archives screen and history
- `deleted` - Removed from active view, only visible in history

### Hunter Actions (In-Progress Tab)

#### Archive Button
**Location:** Hunter's payout screen (`/app/in-progress/[bountyId]/hunter/payout.tsx`)

**Behavior:**
- Available when bounty status is `completed` (payout has been released)
- Updates bounty status to `archived`
- Removes bounty from "In Progress" tab
- Bounty becomes visible in:
  - Archives screen
  - History screen
- **Use Case:** Hunter wants to clean up completed work from active view while preserving access

**Implementation:**
```typescript
const handleArchive = async () => {
  // Update bounty status to archived
  const updated = await bountyService.update(routeBountyId, {
    status: 'archived',
  });
  // Navigate back to main screen
  router.replace('/tabs/bounty-app');
};
```

#### Delete Button
**Location:** Hunter's payout screen (`/app/in-progress/[bountyId]/hunter/payout.tsx`)

**Behavior:**
- Available when bounty status is `completed`
- Updates bounty status to `deleted`
- Removes bounty from "In Progress" tab
- Bounty becomes visible ONLY in:
  - History screen (NOT in archives)
- **Use Case:** Hunter wants to permanently remove a bounty from their active and archived views

**Implementation:**
```typescript
const handleDelete = async () => {
  // Update bounty status to deleted
  const updated = await bountyService.update(routeBountyId, {
    status: 'deleted',
  });
  // Navigate back to main screen
  router.replace('/tabs/bounty-app');
};
```

### Poster Actions (My Postings Tab)

#### Delete Button
**Location:** Poster's payout screen (`/app/postings/[bountyId]/payout.tsx`)

**Behavior:**
- Available when bounty is in `in_progress` status
- Updates bounty status to `deleted`
- Removes bounty from "My Postings" tab
- Bounty becomes visible ONLY in:
  - History screen (NOT in archives)
- **Use Case:** Poster wants to remove a bounty from their postings

**Implementation:**
```typescript
const handleDeleteBounty = async () => {
  // Update bounty status to deleted
  const updated = await bountyService.update(Number(bountyId), {
    status: 'deleted',
  });
  // Navigate back to main screen
  router.replace('/tabs/bounty-app');
};
```

## Premature Cancellation Mechanics

### Problem Scenarios

#### Scenario 1: Poster Cancels Before Completion
**Situation:** Bounty is in `in_progress` status with escrowed funds, but poster wants to cancel.

**Current Limitations:**
- No explicit "cancel" functionality during in-progress state
- Funds are locked in escrow
- Hunter may have already started work

**Recommended Solution:**
1. **Add Cancellation Request Flow:**
   - Poster can request cancellation with a reason
   - System notifies hunter of cancellation request
   - Hunter can accept or dispute

2. **Escrow Handling:**
   - If hunter accepts: refund poster, release escrow
   - If hunter disputes: enter dispute resolution flow
   - Automatic acceptance after 48 hours of no response

3. **Implementation Steps:**
   ```typescript
   // Add new status: 'cancellation_requested'
   // Update database.types.ts
   status: "open" | "in_progress" | "completed" | "archived" | "deleted" | "cancellation_requested"
   
   // Add cancellation service
   async requestCancellation(bountyId: string, reason: string, requestedBy: 'poster' | 'hunter') {
     // 1. Update bounty status to 'cancellation_requested'
     // 2. Store cancellation reason and requester
     // 3. Send notification to other party
     // 4. Set auto-accept timer (48 hours)
   }
   
   // Add response handlers
   async acceptCancellation(bountyId: string) {
     // 1. Release escrow funds back to poster
     // 2. Update bounty status to 'cancelled'
     // 3. Log transaction
   }
   
   async disputeCancellation(bountyId: string, disputeReason: string) {
     // 1. Create dispute record
     // 2. Notify admin/dispute resolution system
     // 3. Freeze escrow until resolution
   }
   ```

#### Scenario 2: Hunter Wants to Withdraw
**Situation:** Hunter accepted bounty but wants to withdraw before completion.

**Current Limitations:**
- Hunter can withdraw application only when status is `open`
- No withdrawal mechanism during `in_progress`
- Escrow remains locked

**Recommended Solution:**
1. **Add Hunter Withdrawal Flow:**
   - Hunter can request withdrawal with reason
   - System notifies poster
   - Escrow automatically released to poster
   - Bounty returns to `open` status

2. **Reputation Impact:**
   - Track withdrawal count in hunter profile
   - Display reliability score
   - Implement withdrawal penalties after threshold

3. **Implementation Steps:**
   ```typescript
   // Add withdrawal service method
   async hunterWithdrawal(bountyId: string, hunterId: string, reason: string) {
     // 1. Verify hunter is accepted for this bounty
     // 2. Release escrow back to poster
     // 3. Update bounty status to 'open'
     // 4. Clear accepted_by field
     // 5. Record withdrawal in hunter's profile
     // 6. Send notification to poster
     // 7. Log transaction
   }
   ```

### Financial Considerations

#### Escrow Management
**Current State:**
- Funds are escrowed when bounty is accepted
- Released when poster marks as complete
- No automatic refund mechanism

**Recommended Enhancements:**
1. **Cancellation Fee Structure:**
   ```typescript
   interface CancellationPolicy {
     // If cancelled within 1 hour: free
     // If cancelled after hunter starts work: partial payment to hunter
     // If cancelled near completion: full payment to hunter
     
     timeSinceAcceptance: number; // milliseconds
     workProgress?: number; // 0-100 percentage
     
     calculateRefund(): {
       posterRefund: number;
       hunterCompensation: number;
       platformFee: number;
     }
   }
   ```

2. **Partial Payment Options:**
   - Allow poster to offer partial payment to hunter on cancellation
   - Hunter can accept or negotiate
   - System holds funds until agreement

#### Dispute Resolution
**Recommended Flow:**
1. **Automatic Dispute Creation:**
   - Triggered when cancellation is disputed
   - Creates dispute record with evidence
   - Locks funds in escrow

2. **Evidence Collection:**
   - Both parties can submit evidence
   - System tracks submission timestamps
   - Photos, messages, work samples

3. **Resolution Paths:**
   - **Mediation:** Human review by platform admin
   - **Automated:** ML-based decision for clear cases
   - **Community:** Jury of verified users (future)

## Database Schema Updates

### Required Table Changes

```sql
-- Add new status values
ALTER TYPE bounty_status ADD VALUE 'cancelled';
ALTER TYPE bounty_status ADD VALUE 'cancellation_requested';

-- Add cancellation tracking table
CREATE TABLE bounty_cancellations (
  id SERIAL PRIMARY KEY,
  bounty_id INTEGER REFERENCES bounties(id),
  requested_by VARCHAR(50) NOT NULL, -- 'poster' or 'hunter'
  requester_id UUID NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL, -- 'pending', 'accepted', 'disputed', 'resolved'
  requested_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolution_notes TEXT
);

-- Add dispute tracking table
CREATE TABLE bounty_disputes (
  id SERIAL PRIMARY KEY,
  bounty_id INTEGER REFERENCES bounties(id),
  cancellation_id INTEGER REFERENCES bounty_cancellations(id),
  disputer_id UUID NOT NULL,
  dispute_reason TEXT NOT NULL,
  evidence_json TEXT, -- JSON array of evidence items
  status VARCHAR(20) NOT NULL, -- 'open', 'reviewing', 'resolved'
  resolution VARCHAR(20), -- 'poster_wins', 'hunter_wins', 'split'
  resolution_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Add withdrawal tracking to profiles
ALTER TABLE profiles ADD COLUMN withdrawal_count INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN last_withdrawal_at TIMESTAMP;
```

## UI/UX Recommendations

### Cancellation Request Screen
**Components needed:**
1. **Reason selection dropdown:**
   - "Changed requirements"
   - "Found alternative solution"
   - "Budget constraints"
   - "Other" (free text)

2. **Compensation offer slider:**
   - For poster cancellations
   - Suggest fair amounts based on time elapsed

3. **Confirmation modal:**
   - Show escrow impact
   - Explain process timeline
   - Reputation impact warning

### Notification System
**Required notifications:**
1. Cancellation requested
2. Cancellation accepted/disputed
3. Auto-accept countdown reminders
4. Dispute created
5. Dispute resolved

## Testing Scenarios

### Test Case 1: Poster Cancels Early
```typescript
describe('Poster Cancellation - Early Stage', () => {
  it('should refund full amount when cancelled within 1 hour', async () => {
    // Setup: Create bounty, accept, escrow funds
    // Action: Request cancellation within 1 hour
    // Assert: Full refund to poster, no compensation to hunter
  });
});
```

### Test Case 2: Hunter Withdraws After Starting
```typescript
describe('Hunter Withdrawal - Work Started', () => {
  it('should release escrow and track withdrawal', async () => {
    // Setup: Bounty accepted, work started
    // Action: Hunter requests withdrawal
    // Assert: Escrow released, withdrawal recorded, bounty reopened
  });
});
```

### Test Case 3: Cancellation Dispute
```typescript
describe('Cancellation Dispute Flow', () => {
  it('should handle disputed cancellation correctly', async () => {
    // Setup: Cancellation requested
    // Action: Other party disputes
    // Assert: Dispute created, funds locked, notifications sent
  });
});
```

## PR Implementation Prompt

### Feature: Premature Bounty Cancellation System

**Objective:** Implement a complete cancellation and dispute resolution system for bounties that handles both poster and hunter-initiated cancellations with appropriate financial settlements.

**Scope:**
1. Add cancellation request flows for both posters and hunters
2. Implement escrow refund/release mechanisms
3. Create dispute resolution framework
4. Add reputation tracking for withdrawals
5. Build notification system for all cancellation events
6. Update UI with cancellation request screens
7. Add comprehensive tests for all scenarios

**Technical Requirements:**

1. **Database Schema:**
   - Add `cancelled` and `cancellation_requested` to bounty status enum
   - Create `bounty_cancellations` table
   - Create `bounty_disputes` table
   - Add withdrawal tracking columns to `profiles` table

2. **Services:**
   - `cancellation-service.ts` - Handle all cancellation operations
   - `dispute-service.ts` - Manage dispute lifecycle
   - Update `wallet-context.tsx` - Add refund mechanisms
   - Update `bounty-service.ts` - Support new statuses

3. **Components:**
   - `CancellationRequestScreen` - UI for requesting cancellation
   - `CancellationResponseScreen` - Accept/dispute UI
   - `DisputeEvidenceScreen` - Submit evidence
   - `DisputeDetailScreen` - View dispute status
   - Update notification components

4. **Routing:**
   - `/bounty/[id]/cancel` - Cancellation request
   - `/bounty/[id]/cancellation-response` - Respond to request
   - `/bounty/[id]/dispute` - View/manage disputes

5. **Testing:**
   - Unit tests for all service methods
   - Integration tests for full flows
   - E2E tests for critical paths
   - Load tests for notification system

**Success Criteria:**
- [ ] Poster can request cancellation at any stage
- [ ] Hunter can withdraw before work completion
- [ ] Escrow properly refunded based on policy
- [ ] Disputes are created and tracked
- [ ] All parties receive appropriate notifications
- [ ] Reputation impacts are recorded
- [ ] UI is intuitive and provides clear guidance
- [ ] All tests pass with >90% coverage

**Implementation Priority:**
1. **Phase 1 (MVP):** Basic cancellation request and acceptance
2. **Phase 2:** Dispute system and evidence collection
3. **Phase 3:** Automated policies and compensation calculation
4. **Phase 4:** Advanced features (community jury, ML decisions)

**Estimated Effort:** 3-4 weeks for full implementation

---

## Maintenance Notes

### Current Implementation Status
- ✅ Basic archive/delete functionality for hunters
- ✅ Delete functionality for posters
- ✅ Status filtering in archives and history
- ⚠️ No premature cancellation support
- ⚠️ No dispute resolution system
- ⚠️ No withdrawal tracking

### Future Enhancements
1. Implement full cancellation system (see PR prompt above)
2. Add analytics for cancellation patterns
3. Build reputation scoring based on completion/withdrawal rates
4. Implement smart escrow policies with ML
5. Add peer-to-peer negotiation features

### Known Issues
- Deleted bounties currently have no time-based cleanup
- No audit trail for status changes
- Escrow remains locked if both parties abandon the bounty
- No automatic resolution for stale cancellation requests

## Support & Questions

For questions about implementation or to propose changes to these mechanics, please:
1. Review this document thoroughly
2. Check existing issues/PRs for related discussions
3. Open a new issue with the `enhancement` or `question` label
4. Tag relevant team members (@backend, @frontend, @product)

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-XX  
**Author:** Development Team  
**Status:** Living Document - Subject to Updates
