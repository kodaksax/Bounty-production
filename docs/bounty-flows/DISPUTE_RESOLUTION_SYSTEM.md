# Comprehensive Dispute Resolution System Documentation

## Overview

The comprehensive dispute resolution system provides a complete workflow for handling disputes when bounty completion or cancellation is contested by either party. This system includes user-facing dispute creation, evidence upload, admin mediation tools, automated resolution logic, and appeal mechanisms.

## Architecture

### Database Schema

The dispute system uses 7 core tables with full RLS (Row-Level Security) policies:

1. **bounty_cancellations** - Tracks cancellation requests that can lead to disputes
2. **bounty_disputes** - Core dispute tracking with automation fields
3. **dispute_resolutions** - Detailed resolution records with fund allocation decisions
4. **dispute_comments** - Mediation discussion (public and internal admin notes)
5. **dispute_evidence** - Separate evidence management with metadata
6. **dispute_appeals** - Appeal workflow for contested resolutions
7. **dispute_audit_log** - Complete audit trail of all actions

### Data Flow

```
Bounty Cancellation Request
    ↓
User Contests → Dispute Created
    ↓
Evidence Upload + Comments
    ↓
Admin Review (Timeline + Evidence + Suggestions)
    ↓
Resolution Decision (Release/Refund/Split)
    ↓
Funds Distributed via Escrow Service
    ↓
Optional: Appeal → Re-review
```

## User-Facing Features

### 1. Dispute Creation (`app/dispute/create.tsx`)

**Purpose:** Allow users to create disputes when they disagree with a cancellation decision.

**Features:**
- Rich text reason input
- Evidence attachment system (text, links, images, documents)
- Real-time evidence management
- Validation and confirmation dialogs

**Usage:**
```tsx
// Navigate to dispute creation
router.push({
  pathname: '/dispute/create',
  params: {
    cancellationId: 'uuid',
    bountyId: 'uuid'
  }
});
```

**Integration Points:**
- Uses `disputeService.createDispute()` for dispute creation
- Uses `disputeService.uploadEvidence()` for evidence upload
- Sends notifications to all involved parties

### 2. Evidence Types Supported

| Type | Description | Use Case |
|------|-------------|----------|
| **Text** | Written descriptions | Explain context, timeline of events |
| **Link** | URLs to external resources | Link to files, communication threads |
| **Image** | Screenshots, photos | Show completion proof, communication |
| **Document** | File uploads | Contracts, agreements, detailed reports |

### 3. Timeline View

Disputes include a comprehensive activity timeline showing:
- Dispute creation
- Evidence additions
- Status changes
- Comments added
- Admin actions
- Resolution decisions

## Admin Tools

### 1. Dispute Queue (`app/(admin)/disputes/index.tsx`)

**Features:**
- Stats overview (total, open, under review, resolved)
- Filter tabs by status
- Search and sort capabilities
- Quick actions (mark under review)
- Auto-refresh

**Existing Implementation:**
The admin queue is already fully functional with:
- Real-time dispute list
- Status indicators with color coding
- Evidence count display
- Quick navigation to detail view

### 2. Dispute Detail Screen (`app/(admin)/disputes/[id].tsx`)

**Enhanced Features:**
- Complete dispute information
- Evidence review interface
- Comment/mediation system
- Resolution decision form
- Audit trail display
- Suggested resolution from AI

**Key Components:**

#### Evidence Review
```tsx
// Automatically loaded from dispute_evidence table
const evidence = await disputeService.getDisputeEvidence(disputeId);
// Shows type, description, content with appropriate icons
```

#### Resolution Decision Form
Admin can choose between:
- **Release**: Full payment to hunter
- **Refund**: Full refund to poster  
- **Split**: Custom amount distribution
- **Other**: Custom resolution

#### Mediation Comments
```tsx
// Add internal admin notes
await disputeService.addComment(disputeId, adminId, comment, true);

// Add public comments visible to parties
await disputeService.addComment(disputeId, adminId, comment, false);
```

### 3. Resolution Enforcement

When an admin makes a resolution decision:

```typescript
await disputeService.makeResolutionDecision(
  disputeId,
  adminId,
  {
    outcome: 'split',
    amountToHunter: 30000, // $300.00 in cents
    amountToPoster: 20000, // $200.00
    rationale: 'Work partially completed, fair split based on evidence',
    metadata: { reviewedBy: 'admin', confidence: 0.8 }
  }
);
```

This:
1. Creates a dispute_resolutions record
2. Updates dispute status to 'resolved'
3. Logs the decision in audit trail
4. Sends notifications to all parties
5. **Triggers escrow release** (integration with wallet service)

## Service Layer API

### DisputeService Methods

#### Core Dispute Management

```typescript
// Create a dispute
const dispute = await disputeService.createDispute(
  cancellationId: string,
  initiatorId: string,
  reason: string,
  evidence?: DisputeEvidence[]
);

// Get dispute by ID
const dispute = await disputeService.getDisputeById(disputeId);

// Update status
await disputeService.updateDisputeStatus(disputeId, 'under_review');

// Resolve dispute
await disputeService.resolveDispute(disputeId, resolution, adminId);
```

#### Evidence Management

```typescript
// Upload evidence
await disputeService.uploadEvidence(disputeId, userId, {
  type: 'image',
  content: 'https://cdn.example.com/proof.jpg',
  description: 'Screenshot of completed work',
  mimeType: 'image/jpeg',
  fileSize: 245678
});

// Get all evidence
const evidence = await disputeService.getDisputeEvidence(disputeId);
```

#### Comments & Mediation

```typescript
// Add comment
await disputeService.addComment(disputeId, userId, comment, isInternal);

// Get comments (public only or including internal)
const comments = await disputeService.getDisputeComments(disputeId, includeInternal);
```

#### Resolution Decisions

```typescript
// Make resolution decision with fund distribution
await disputeService.makeResolutionDecision(disputeId, adminId, {
  outcome: 'release' | 'refund' | 'split' | 'other',
  amountToHunter?: number,
  amountToPoster?: number,
  rationale: string,
  metadata?: Record<string, any>
});

// Get resolution details
const resolution = await disputeService.getResolution(disputeId);
```

#### Appeals

```typescript
// Create an appeal
await disputeService.createAppeal(disputeId, appellantId, reason);

// Get appeals for a dispute
const appeals = await disputeService.getAppeals(disputeId);
```

#### Audit & History

```typescript
// Get complete audit log
const auditLog = await disputeService.getAuditLog(disputeId);

// Manual audit logging
await disputeService.logAuditEvent(
  disputeId,
  'custom_action',
  actorId,
  'admin',
  { details: 'Additional context' }
);
```

## Automation Features

### 1. Auto-Close Stale Disputes

**Trigger:** Disputes with no activity for 7 days (based on last_activity_at)
**Action:** Automatically close with system-generated resolution
**Implementation:**

```typescript
// Run periodically via cron job
const closedCount = await disputeService.autoCloseStaleDisputes();
```

**Database Support:**
- `auto_close_at` field automatically set on dispute creation and updated on activity
- `last_activity_at` updated by triggers when evidence or comments are added
- Trigger recalculates `auto_close_at` when `last_activity_at` changes
- Index on `auto_close_at` for efficient querying
- Disputes auto-close 7 days after last activity, not 7 days after creation

### 2. Escalation System

**Trigger:** Disputes unresolved for 14 days
**Action:** Mark as escalated for priority review
**Implementation:**

```typescript
// Run daily via cron job
const escalatedCount = await disputeService.escalateUnresolvedDisputes();
```

**Result:**
- Sets `escalated = true` and `escalated_at` timestamp
- Sends high-priority notifications to admin team
- Appears at top of admin dispute queue

### 3. Suggested Resolution AI

**Purpose:** Provide data-driven resolution suggestions to admins

**Algorithm:**
1. Count evidence by party (hunter vs poster)
2. Weight evidence by type (image > document > text > link)
3. Analyze comment sentiment (future enhancement)
4. Calculate confidence score
5. Suggest: release, refund, or split

**Usage:**

```typescript
const suggestion = await disputeService.calculateSuggestedResolution(disputeId);
// Returns:
// {
//   suggestedOutcome: 'release' | 'refund' | 'split',
//   confidence: 0.0 - 1.0,
//   reasoning: 'Human-readable explanation'
// }
```

**Display in Admin UI:**
The suggestion appears as an info card in the resolution form, helping admins make faster, more consistent decisions.

### 4. Fraud Detection Pattern Tracking

**Monitored Patterns:**
- High volume of disputes from single user
- Repeated disputes with similar evidence
- Fast dispute creation after cancellation
- Pattern of appeals on resolved disputes

**Future Enhancement:**
Integration with existing `transaction_patterns` table in risk management system.

## Escrow Integration

### Fund Release Flow

When a dispute is resolved:

1. **Resolution Decision Made:**
   ```typescript
   makeResolutionDecision(disputeId, adminId, {
     outcome: 'split',
     amountToHunter: 30000,
     amountToPoster: 20000
   })
   ```

2. **Wallet Transactions Created:**
   - Transaction type: 'release' for hunter amount
   - Transaction type: 'refund' for poster amount
   - Links to `bounty_id` and `dispute_id`

3. **Bounty Status Updated:**
   - Status changes based on outcome
   - Payment processed via Stripe if configured

4. **Notifications Sent:**
   - All parties notified of resolution
   - Transaction receipts generated

### Transaction Security

- All fund movements logged in `wallet_transactions` table
- Dispute resolution ID linked for audit trail
- Stripe Transfer IDs stored for reconciliation
- Platform fees calculated and deducted

## Notification System Integration

The dispute system sends notifications at key events:

| Event | Recipients | Type |
|-------|-----------|------|
| Dispute Created | Poster, Hunter | `dispute_created` |
| Evidence Added | Admin team | `dispute_updated` |
| Status Changed | All parties | `dispute_status_changed` |
| Dispute Resolved | All parties | `dispute_resolved` |
| Appeal Created | Admin team | `dispute_appealed` |
| Auto-Closed | Initiator | `dispute_auto_closed` |

**Implementation:**
```typescript
// Automatically sent by service layer
// Uses existing notification infrastructure
await sendNotification(userId, type, title, body, data);
```

## Testing Strategy

### Unit Tests

Test each service method independently:

```typescript
describe('DisputeService', () => {
  it('should create dispute with evidence', async () => {
    const dispute = await disputeService.createDispute(/*...*/);
    expect(dispute).toBeDefined();
    expect(dispute.status).toBe('open');
  });

  it('should calculate suggested resolution', async () => {
    const suggestion = await disputeService.calculateSuggestedResolution(disputeId);
    expect(suggestion.confidence).toBeGreaterThan(0);
  });
});
```

### Integration Tests

Test complete flows:

```typescript
describe('Dispute Resolution Flow', () => {
  it('should handle complete dispute lifecycle', async () => {
    // 1. Create cancellation
    const cancellation = await createTestCancellation();
    
    // 2. Create dispute
    const dispute = await disputeService.createDispute(/*...*/);
    
    // 3. Add evidence
    await disputeService.uploadEvidence(/*...*/);
    
    // 4. Admin resolves
    await disputeService.makeResolutionDecision(/*...*/);
    
    // 5. Verify funds distributed
    const transactions = await getWalletTransactions(bountyId);
    expect(transactions).toHaveLength(2);
  });
});
```

### Manual Testing Scenarios

1. **Basic Dispute Flow:**
   - User creates dispute with text evidence
   - Admin marks under review
   - Admin resolves with refund
   - Verify notification sent

2. **Split Payment:**
   - Create dispute with evidence from both parties
   - Admin chooses split outcome
   - Verify both parties receive correct amounts

3. **Appeal Flow:**
   - User appeals resolved dispute
   - Admin reviews appeal
   - New resolution issued

4. **Auto-Close:**
   - Create dispute
   - Wait 7+ days (or manually trigger)
   - Verify auto-closed with system message

## Security Considerations

### Row-Level Security (RLS)

All tables have RLS enabled with policies:

```sql
-- Users can only view disputes they're involved in
CREATE POLICY "Users see own disputes" ON bounty_disputes
  FOR SELECT USING (
    initiator_id = auth.uid() OR
    EXISTS (SELECT 1 FROM bounties WHERE id = bounty_id AND (poster_id = auth.uid() OR hunter_id = auth.uid()))
  );

-- Only admins can make resolutions
CREATE POLICY "Admins create resolutions" ON dispute_resolutions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

### Input Validation

- Evidence content sanitized before storage
- File uploads virus-scanned
- URLs validated for XSS
- Comment length limits enforced

### Audit Trail

Every action logged:
- Who performed the action
- When it occurred
- What changed
- Previous and new values

## Performance Optimization

### Database Indexes

All high-traffic queries optimized:

```sql
-- Fast dispute lookups by status
CREATE INDEX idx_bounty_disputes_status_created_at 
  ON bounty_disputes(status, created_at DESC);

-- Fast evidence retrieval
CREATE INDEX idx_dispute_evidence_dispute_id 
  ON dispute_evidence(dispute_id, created_at DESC);

-- Efficient auto-close queries
CREATE INDEX idx_bounty_disputes_auto_close 
  ON bounty_disputes(auto_close_at) 
  WHERE status IN ('open', 'under_review');
```

### Caching Strategy

- Dispute counts cached for 5 minutes
- Evidence metadata cached until dispute updated
- Audit logs cached after resolution

## Deployment Checklist

- [ ] Run database migration: `20260109_comprehensive_dispute_system.sql`
- [ ] Verify RLS policies applied
- [ ] Test admin account has proper role
- [ ] Configure cron jobs for automation:
  - Auto-close: Daily at 2 AM
  - Escalation: Daily at 3 AM
- [ ] Set up monitoring alerts for:
  - High dispute volume (> 10/day)
  - Long resolution times (> 7 days)
  - Failed auto-close jobs
- [ ] Configure Stripe webhooks for fund releases
- [ ] Test notification delivery
- [ ] Review audit log retention policy

## API Endpoints (Future Enhancement)

For external integrations or mobile API:

```
POST   /api/disputes                    - Create dispute
GET    /api/disputes/:id                - Get dispute details
POST   /api/disputes/:id/evidence       - Upload evidence
POST   /api/disputes/:id/comments       - Add comment
POST   /api/disputes/:id/resolve        - Admin resolution
POST   /api/disputes/:id/appeal         - Create appeal
GET    /api/disputes/:id/audit-log      - Get audit trail
GET    /api/admin/disputes              - List disputes (admin)
GET    /api/admin/disputes/stats        - Dispute statistics
POST   /api/cron/disputes/auto-close    - Trigger auto-close
POST   /api/cron/disputes/escalate      - Trigger escalation
```

## Troubleshooting

### Common Issues

**Issue:** Dispute not appearing in admin queue
**Solution:** Check dispute status and RLS policies. Verify admin role.

**Issue:** Evidence upload fails
**Solution:** Check file size limits and storage bucket permissions.

**Issue:** Auto-close not running
**Solution:** Verify cron job configured and check `auto_close_at` field.

**Issue:** Notifications not sent
**Solution:** Check notification service configuration and user preferences.

## Future Enhancements

1. **ML-Based Resolution Suggestions:**
   - Train model on historical resolutions
   - Improve confidence scoring
   - Pattern recognition for fraud

2. **Video Evidence Support:**
   - Upload video files
   - Thumbnail generation
   - In-app playback

3. **Multi-Language Support:**
   - Translate dispute content
   - Admin can review in any language

4. **Public Dispute Resolution Library:**
   - Anonymized case studies
   - Help users understand fair outcomes

5. **Mediation Chat:**
   - Real-time chat between parties
   - Admin moderator
   - Resolve disputes faster

## Conclusion

The comprehensive dispute resolution system provides a robust, scalable solution for handling bounty disputes with fairness, transparency, and efficiency. All core components are implemented and ready for deployment, with clear paths for future enhancements based on user feedback and analytics.
