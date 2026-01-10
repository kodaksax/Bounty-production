# Dispute Resolution System Flow Diagrams

## Overview Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DISPUTE RESOLUTION SYSTEM                          │
└─────────────────────────────────────────────────────────────────────────┘

  User Flow                    Admin Flow                  Automation
  ─────────                    ──────────                  ──────────
      │                            │                            │
      ▼                            ▼                            ▼
  ┌─────────┐                 ┌─────────┐                 ┌─────────┐
  │ Create  │────────────────▶│ Review  │◀────────────────│  Cron   │
  │ Dispute │                 │ Queue   │                 │  Jobs   │
  └────┬────┘                 └────┬────┘                 └────┬────┘
       │                           │                           │
       ▼                           ▼                           ▼
  ┌─────────┐                 ┌─────────┐                 ┌─────────┐
  │  Add    │                 │ Evidence│                 │  Auto   │
  │Evidence │                 │ Review  │                 │  Close  │
  └────┬────┘                 └────┬────┘                 └─────────┘
       │                           │                           
       ▼                           ▼                           ▼
  ┌─────────┐                 ┌─────────┐                 ┌─────────┐
  │ Comment │                 │ Make    │                 │Escalate │
  │         │                 │Decision │                 │         │
  └────┬────┘                 └────┬────┘                 └─────────┘
       │                           │                           
       ▼                           ▼                           
  ┌─────────┐                 ┌─────────┐                 
  │ Appeal  │                 │ Resolve │                 
  │(Optional)                 │  &Pay   │                 
  └─────────┘                 └─────────┘                 
```

## Detailed User Dispute Creation Flow

```
START
  │
  ▼
┌─────────────────────────────┐
│ User contests cancellation  │
│ (from cancellation screen)  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Navigate to Dispute Create  │
│ /dispute/create?            │
│   cancellationId=xxx        │
│   bountyId=yyy              │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Fill Dispute Form           │
│ • Enter reason (required)   │
│ • Add evidence (optional)   │
│   - Text descriptions       │
│   - URLs/Links              │
│   - Images (future)         │
│   - Documents (future)      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Validate Input              │
│ • Reason ≥ 20 characters    │
│ • Evidence properly formatted│
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Confirm Dispute             │
│ "This will notify all       │
│  involved parties"          │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ disputeService.createDispute│
│ • Creates DB record         │
│ • Updates cancellation      │
│ • Sets auto_close_at        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Upload Evidence             │
│ disputeService.uploadEvidence
│ • Each evidence item saved  │
│ • Updates last_activity_at  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Send Notifications          │
│ • Notify poster             │
│ • Notify hunter             │
│ • Notify admin team         │
│ Type: dispute_created       │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Log Audit Event             │
│ action: 'created'           │
│ actor: user_id              │
│ actor_type: 'user'          │
└──────────┬──────────────────┘
           │
           ▼
         SUCCESS
    (Navigate back)
```

## Admin Resolution Flow

```
START (Admin Dashboard)
  │
  ▼
┌─────────────────────────────┐
│ View Dispute Queue          │
│ /admin/disputes             │
│ • Filter by status          │
│ • Sort by date/priority     │
│ • View stats overview       │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Select Dispute              │
│ Navigate to detail view     │
│ /admin/disputes/[id]        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Review Dispute Information  │
│ • Bounty details            │
│ • Cancellation context      │
│ • Dispute reason            │
│ • Timeline/activity         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Review Evidence             │
│ disputeService.              │
│   getDisputeEvidence()      │
│ • View all evidence items   │
│ • Check types/descriptions  │
│ • Assess credibility        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Review Comments             │
│ disputeService.              │
│   getDisputeComments()      │
│ • Read party communications │
│ • View internal admin notes │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Get Suggested Resolution    │
│ disputeService.              │
│   calculateSuggestedResolution()
│ • View AI suggestion        │
│ • Check confidence score    │
│ • Read reasoning            │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Add Internal Notes          │
│ (Optional)                  │
│ disputeService.addComment() │
│   isInternal: true          │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Update Status               │
│ open → under_review         │
│ disputeService.              │
│   updateDisputeStatus()     │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Make Resolution Decision    │
│ Choose outcome:             │
│ ┌────────────────────────┐  │
│ │ • RELEASE (to hunter)  │  │
│ │ • REFUND (to poster)   │  │
│ │ • SPLIT (custom %)     │  │
│ │ • OTHER (custom)       │  │
│ └────────────────────────┘  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Enter Rationale             │
│ • Explain decision          │
│ • Reference evidence        │
│ • Min 50 characters         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Confirm Resolution          │
│ "This action cannot be      │
│  undone (without appeal)"   │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ disputeService.              │
│   makeResolutionDecision()  │
│ • Create resolution record  │
│ • Calculate fund allocation │
│ • Update dispute status     │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Process Fund Distribution   │
│ (Integration with Escrow)   │
│ • Release to hunter         │
│ • Refund to poster          │
│ • Split per decision        │
│ • Create wallet transactions│
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Send Resolution Notifications│
│ • Notify all parties        │
│ • Include outcome           │
│ • Include rationale summary │
│ Type: dispute_resolved      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Log Audit Event             │
│ action: 'resolution_decision'│
│ actor: admin_id             │
│ actor_type: 'admin'         │
│ details: outcome, amounts   │
└──────────┬──────────────────┘
           │
           ▼
        SUCCESS
   (Dispute Resolved)
```

## Appeal Flow

```
START (User views resolved dispute)
  │
  ▼
┌─────────────────────────────┐
│ User disagrees with         │
│ resolution decision         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Click "Appeal Resolution"   │
│ (Only available if status   │
│  is 'resolved')             │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Appeal Form                 │
│ • Enter appeal reason       │
│ • Explain why unfair        │
│ • Provide new evidence      │
│   (optional)                │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Validate Appeal             │
│ • Reason is required        │
│ • Not already appealed      │
│ • Within appeal window      │
│   (e.g., 7 days)            │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ disputeService.createAppeal()│
│ • Create appeal record      │
│ • status: 'pending'         │
│ • Link to dispute           │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Notify Admin Team           │
│ • High priority alert       │
│ • Include appeal reason     │
│ • Link to dispute           │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Log Audit Event             │
│ action: 'appeal_created'    │
│ actor: appellant_id         │
│ actor_type: 'user'          │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Admin Reviews Appeal        │
│ • Re-examine evidence       │
│ • Consider new information  │
│ • Update appeal status      │
│   to 'reviewing'            │
└──────────┬──────────────────┘
           │
           ├──────────────┐
           ▼              ▼
    ┌─────────┐    ┌─────────┐
    │ Accept  │    │ Reject  │
    │ Appeal  │    │ Appeal  │
    └────┬────┘    └────┬────┘
         │              │
         ▼              ▼
  ┌────────────┐  ┌────────────┐
  │ Re-open    │  │ Final      │
  │ Dispute    │  │ Decision   │
  │ Review     │  │ Stands     │
  └────────────┘  └────────────┘
```

## Automation Flow

```
CRON JOB (Daily at 2 AM)
  │
  ├──────────────────────────┐
  │                          │
  ▼                          ▼
┌────────────────┐    ┌────────────────┐
│ AUTO-CLOSE     │    │ ESCALATION     │
│ STALE DISPUTES │    │ SYSTEM         │
└────┬───────────┘    └────┬───────────┘
     │                     │
     ▼                     ▼
┌────────────────┐    ┌────────────────┐
│ Query Disputes │    │ Query Disputes │
│ WHERE:         │    │ WHERE:         │
│ • status IN    │    │ • status IN    │
│   (open,       │    │   (open,       │
│    under_review│    │    under_review│
│ • auto_close_at│    │ • created_at < │
│   < NOW()      │    │   NOW() - 14d  │
│                │    │ • escalated =  │
│                │    │   false        │
└────┬───────────┘    └────┬───────────┘
     │                     │
     ▼                     ▼
┌────────────────┐    ┌────────────────┐
│ For each       │    │ For each       │
│ stale dispute: │    │ dispute:       │
│                │    │                │
│ UPDATE status  │    │ UPDATE         │
│   = 'closed'   │    │   escalated =  │
│                │    │   true,        │
│ SET resolution │    │   escalated_at │
│   = 'Auto-     │    │   = NOW()      │
│   closed due   │    │                │
│   to inactivity│    │                │
└────┬───────────┘    └────┬───────────┘
     │                     │
     ▼                     ▼
┌────────────────┐    ┌────────────────┐
│ Log Audit      │    │ Log Audit      │
│ action:        │    │ action:        │
│  'auto_closed' │    │  'escalated'   │
│ actor_type:    │    │ actor_type:    │
│  'system'      │    │  'system'      │
└────┬───────────┘    └────┬───────────┘
     │                     │
     ▼                     ▼
┌────────────────┐    ┌────────────────┐
│ Send           │    │ Move to top    │
│ Notifications  │    │ of admin queue │
│ to initiator   │    │ (priority)     │
└────┬───────────┘    └────┬───────────┘
     │                     │
     ▼                     ▼
┌────────────────┐    ┌────────────────┐
│ Return count   │    │ Return count   │
│ of closed      │    │ of escalated   │
│ disputes       │    │ disputes       │
└────────────────┘    └────────────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
              ┌───────────┐
              │ Log       │
              │ Summary   │
              │ & Exit    │
              └───────────┘
```

## Database Interaction Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                           │
│  (React Native App, Admin Dashboard, Cron Jobs)               │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                    SERVICE LAYER                               │
│  disputeService.ts - All business logic                        │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                    SUPABASE CLIENT                             │
│  Authentication, RLS, Real-time                                │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                    DATABASE (PostgreSQL)                       │
│                                                                │
│  Tables:                        Triggers:                      │
│  • bounty_disputes              • update_last_activity         │
│  • dispute_evidence             • log_status_change            │
│  • dispute_comments             • set_auto_close_at            │
│  • dispute_resolutions                                         │
│  • dispute_appeals             Functions:                      │
│  • dispute_audit_log           • log_dispute_audit()           │
│                                                                │
│  RLS Policies:                                                 │
│  • User can view own disputes                                  │
│  • Admin can view all                                          │
│  • Only admin can resolve                                      │
│  • Users can add public comments                               │
│  • Admin can add internal notes                                │
└────────────────────────────────────────────────────────────────┘
```

## Security & Permissions Flow

```
┌─────────────┐
│   REQUEST   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ Supabase Auth Check │
│ • Valid JWT token?  │
│ • User exists?      │
└──────┬──────────────┘
       │
       ├──────── No ─────▶ 401 Unauthorized
       │
       ▼ Yes
┌─────────────────────┐
│ RLS Policy Check    │
│ Based on action:    │
│                     │
│ VIEW DISPUTE:       │
│ ├─ Own dispute?     │
│ ├─ Involved party?  │
│ └─ Admin role?      │
│                     │
│ CREATE DISPUTE:     │
│ ├─ Owns cancellation?│
│ └─ Involved in bounty?│
│                     │
│ RESOLVE DISPUTE:    │
│ └─ Has admin role?  │
│                     │
│ ADD EVIDENCE:       │
│ └─ Party to dispute?│
└──────┬──────────────┘
       │
       ├──────── No ─────▶ 403 Forbidden
       │
       ▼ Yes
┌─────────────────────┐
│ Execute Query       │
│ • Insert/Update/Select
│ • Trigger functions │
│ • Log audit event   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Return Result       │
│ • Success data      │
│ • Or error details  │
└─────────────────────┘
```

## Evidence Upload Flow

```
┌────────────────┐
│ User selects   │
│ evidence type  │
└───────┬────────┘
        │
        ├────────┬────────┬────────┐
        │        │        │        │
        ▼        ▼        ▼        ▼
    ┌─────┐ ┌──────┐ ┌──────┐ ┌─────┐
    │TEXT │ │ LINK │ │IMAGE │ │ DOC │
    └──┬──┘ └───┬──┘ └───┬──┘ └──┬──┘
       │        │        │        │
       ▼        ▼        ▼        ▼
    ┌─────────────────────────────┐
    │ Enter/Pick content          │
    └──────────────┬──────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │ Add description (optional)  │
    └──────────────┬──────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │ Validate input              │
    │ • Content not empty         │
    │ • Valid URL (for links)     │
    │ • File size < 10MB          │
    │ • Allowed mime types        │
    └──────────────┬──────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │ Upload to storage           │
    │ (if file/image)             │
    │ • Get CDN URL               │
    │ • Calculate file size       │
    │ • Extract mime type         │
    └──────────────┬──────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │ disputeService.             │
    │   uploadEvidence()          │
    │ • Insert to                 │
    │   dispute_evidence table    │
    │ • Link to dispute_id        │
    │ • Set uploaded_by           │
    │ • Store metadata            │
    └──────────────┬──────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │ Trigger fires:              │
    │ update_dispute_last_activity│
    │ • Sets last_activity_at     │
    │ • Extends auto_close_at     │
    └──────────────┬──────────────┘
                   │
                   ▼
    ┌─────────────────────────────┐
    │ Log audit event             │
    │ action: 'evidence_added'    │
    └──────────────┬──────────────┘
                   │
                   ▼
             ┌──────────┐
             │ SUCCESS  │
             └──────────┘
```

## State Transitions

```
Dispute Status State Machine:
┌────────┐
│  open  │◀─── Initial state (on creation)
└───┬────┘
    │
    │ Admin marks for review
    ▼
┌─────────────┐
│under_review │
└───┬─────────┘
    │
    ├───────┬─────────────┐
    │       │             │
    ▼       ▼             ▼
┌─────┐ ┌─────────┐ ┌─────────┐
│closed│ │resolved │ │auto     │
└─────┘ └────┬────┘ │closed   │
             │      └─────────┘
             │ User appeals
             ▼
        ┌────────┐
        │reopened│──┐
        └────────┘  │
             ▲      │
             └──────┘
```

## Timeline View Example

```
Dispute #123 Timeline:

  Jan 1, 2:30 PM  │ ● Dispute created by @hunter
                  │   Reason: "Work completed, poster disputes quality"
                  │
  Jan 1, 2:32 PM  │ ● Evidence added by @hunter
                  │   Type: Image - "Screenshot of delivered work"
                  │
  Jan 1, 3:15 PM  │ ● Evidence added by @poster
                  │   Type: Text - "Work did not meet requirements"
                  │
  Jan 2, 9:00 AM  │ ● Status changed: open → under_review
                  │   By: @admin_sarah
                  │
  Jan 2, 9:15 AM  │ ● Comment added by @admin_sarah
                  │   "Reviewing evidence from both parties"
                  │
  Jan 2, 10:30 AM │ ● Resolution decision made
                  │   Outcome: Split (60% hunter, 40% refund)
                  │   Rationale: "Partial completion evident..."
                  │   By: @admin_sarah
                  │
  Jan 2, 10:31 AM │ ● Funds distributed
                  │   $300 → Hunter
                  │   $200 → Poster refund
                  │
  Jan 2, 10:31 AM │ ● Status changed: under_review → resolved
                  │
  Jan 2, 10:32 AM │ ● Notifications sent
                  │   Recipients: @hunter, @poster
```

This comprehensive set of flow diagrams provides visual representation of every major process in the dispute resolution system, from user creation through admin mediation to automated resolution.
