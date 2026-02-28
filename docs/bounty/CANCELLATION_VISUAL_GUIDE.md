# Bounty Cancellation System - Visual Flow Diagrams

## 1. Cancellation Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CANCELLATION REQUEST FLOW                     │
└─────────────────────────────────────────────────────────────────┘

┌──────────┐          ┌──────────┐          ┌──────────┐
│  Poster  │          │  Hunter  │          │  System  │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                      │
     │  1. Request Cancel  │                      │
     │────────────────────────────────────────────>
     │                     │                      │
     │                     │   2. Update Status   │
     │                     │      to "cancellation_requested"
     │                     │      │
     │                     │   3. Calculate       │
     │                     │      Recommended     │
     │                     │      Refund %        │
     │                     │<─────────────────────│
     │                     │                      │
     │    4. Notify Hunter │                      │
     │<────────────────────────────────────────────
     │                     │                      │
     │                     │  5. Review Request   │
     │                     │<─────────────────────│
     │                     │                      │
     │      6a. Accept     │                      │
     │                     │─────────────────────>│
     │                     │                      │
     │                     │   7. Update Status   │
     │                     │      to "cancelled"  │
     │                     │      │
     │                     │   8. Process Refund  │
     │                     │      (via Wallet)    │
     │                     │      │
     │   9. Notify Poster  │                      │
     │<────────────────────────────────────────────
     │                     │                      │
     │      OR             │                      │
     │                     │                      │
     │      6b. Reject     │                      │
     │                     │─────────────────────>│
     │                     │                      │
     │                     │  10. Revert Status   │
     │                     │      to "in_progress"│
     │                     │      │
     │  11. Notify Poster  │                      │
     │<────────────────────────────────────────────
     │                     │                      │
     │      OR             │                      │
     │                     │                      │
     │     6c. Create      │                      │
     │        Dispute      │                      │
     │                     │─────────────────────>│
     │                     │                      │
     │                     │  12. Start Dispute   │
     │                     │      Process         │
     │                     │      (see below)     │
     └─────────────────────┴──────────────────────┘
```

## 2. Refund Calculation Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    REFUND CALCULATION MATRIX                     │
└─────────────────────────────────────────────────────────────────┘

Bounty Status    │ Has Accepted Hunter │ Refund %  │ Rationale
─────────────────┼────────────────────┼───────────┼─────────────────
OPEN             │ No                  │ 100%      │ No work started
OPEN             │ Yes (edge case)     │ 100%      │ Still open
IN_PROGRESS      │ No                  │ 100%      │ No commitment
IN_PROGRESS      │ Yes                 │ 50%       │ Work may have started
COMPLETED        │ Yes                 │ 0%        │ Work delivered
ARCHIVED         │ Any                 │ 50%       │ Default fallback

Example Calculations:
- Bounty: $100, Status: OPEN → Refund: $100
- Bounty: $100, Status: IN_PROGRESS (with hunter) → Refund: $50
- Bounty: $100, Status: COMPLETED → Refund: $0
```

## 3. Dispute Resolution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISPUTE RESOLUTION FLOW                       │
└─────────────────────────────────────────────────────────────────┘

┌──────────┐          ┌──────────┐          ┌──────────┐
│  Party A │          │  Party B │          │  Admin   │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                      │
     │  1. Create Dispute  │                      │
     │    with Reason      │                      │
     │────────────────────────────────────────────>
     │                     │                      │
     │                     │   2. Update          │
     │                     │      Cancellation    │
     │                     │      to "disputed"   │
     │                     │      │
     │                     │   3. Notify Party B  │
     │                     │<─────────────────────│
     │                     │                      │
     │  4. Add Evidence    │                      │
     │────────────────────────────────────────────>
     │                     │                      │
     │                     │  5. Add Counter      │
     │                     │     Evidence         │
     │                     │─────────────────────>│
     │                     │                      │
     │                     │                      │
     │                     │   6. Review Evidence │
     │                     │   Set to             │
     │                     │   "under_review"     │
     │                     │      │
     │                     │   7. Make Decision   │
     │                     │      │
     │                     │   8. Resolve Dispute │
     │                     │      with Resolution │
     │                     │      │
     │  9. Notify Both     │                      │
     │<────────────────────┼──────────────────────│
     │                     │<─────────────────────│
     │                     │                      │
     └─────────────────────┴──────────────────────┘

Dispute Status Progression:
OPEN → UNDER_REVIEW → RESOLVED/CLOSED
```

## 4. Database Schema Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENTITY RELATIONSHIPS                          │
└─────────────────────────────────────────────────────────────────┘

┌───────────┐
│  Bounty   │
│           │
│ id        │◄────────┐
│ status    │         │
│ amount    │         │
│ poster_id │         │
│ accepted_by│        │
└─────┬─────┘         │
      │               │
      │1:N            │FK
      │               │
      ▼               │
┌─────────────────┐   │
│  Cancellations  │   │
│                 │   │
│ id              │   │
│ bounty_id       ├───┘
│ requester_id    │
│ requester_type  │
│ reason          │
│ status          │
│ refund_%        │
└────────┬────────┘
         │1:N
         │
         ▼
┌─────────────────┐
│    Disputes     │
│                 │
│ id              │
│ cancellation_id │
│ bounty_id       │
│ initiator_id    │
│ evidence_json   │
│ status          │
│ resolution      │
└─────────────────┘

┌───────────┐
│ Profiles  │
│           │
│ id        │◄────────────────┐
│ username  │                 │
│ withdrawal_count │          │FK
│ cancellation_count│         │
└───────────┘                 │
                              │
                   Referenced by all
                   user_id fields
```

## 5. Wallet Integration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    WALLET REFUND FLOW                            │
└─────────────────────────────────────────────────────────────────┘

Scenario: Bounty Cancelled with Refund

1. INITIAL STATE (when bounty accepted)
   ┌──────────────────────────────────────┐
   │ Poster Wallet: $100                  │
   │ Escrow: $100 (locked)                │
   │ Hunter Wallet: $0                    │
   └──────────────────────────────────────┘

2. CANCELLATION ACCEPTED (50% refund)
   ┌──────────────────────────────────────┐
   │ Find Escrow Transaction              │
   │ ├─ bounty_id: match                  │
   │ ├─ type: "escrow"                    │
   │ ├─ status: "funded"                  │
   │ └─ amount: $100                      │
   │                                      │
   │ Calculate Refund                     │
   │ ├─ refund_% = 50%                    │
   │ └─ refund_amount = $50               │
   │                                      │
   │ Update Escrow Transaction            │
   │ └─ status: "released"                │
   │                                      │
   │ Create Refund Transaction            │
   │ ├─ type: "refund"                    │
   │ ├─ amount: +$50                      │
   │ └─ details: "50% refund"             │
   │                                      │
   │ Update Poster Balance                │
   │ └─ balance += $50                    │
   └──────────────────────────────────────┘

3. FINAL STATE
   ┌──────────────────────────────────────┐
   │ Poster Wallet: $50 (refunded)        │
   │ Escrow: $0 (released)                │
   │ Hunter Wallet: $0 (no payment)       │
   │ Lost to fees: $50 (platform cost)    │
   └──────────────────────────────────────┘

Transaction Log:
[
  { type: "escrow", amount: -100, status: "released" },
  { type: "refund", amount: +50, status: "completed" }
]
```

## 6. UI Screen Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER INTERFACE FLOW                           │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│ Bounty Detail    │
│                  │
│ [Cancel Bounty]  │◄─── Poster sees this
└────────┬─────────┘
         │
         │ Click
         ▼
┌──────────────────┐
│ Cancel Request   │  /bounty/[id]/cancel
│ Screen           │
│                  │
│ • Shows policy   │
│ • Calculates %   │
│ • Input reason   │
│                  │
│ [Submit]         │
└────────┬─────────┘
         │
         │ Submit
         ▼
┌──────────────────┐
│ Notification     │
│ Sent to Hunter   │
└────────┬─────────┘
         │
         │ Hunter opens
         ▼
┌──────────────────┐
│ Cancellation     │  /bounty/[id]/cancellation-response
│ Response Screen  │
│                  │
│ • Shows reason   │
│ • Shows refund   │
│ • Input response │
│                  │
│ [Accept/Reject]  │
└────────┬─────────┘
         │
         ├─── Accept ──────► Bounty Cancelled
         │                   Refund Processed
         │
         ├─── Reject ──────► Bounty Continues
         │                   Poster Notified
         │
         └─── Dispute ─────► Create Dispute
                             │
                             ▼
                    ┌──────────────────┐
                    │ Dispute Screen   │  /bounty/[id]/dispute
                    │                  │
                    │ • Input reason   │
                    │ • Add evidence   │
                    │ • View status    │
                    │                  │
                    │ [Submit]         │
                    └──────────────────┘
```

## 7. Status State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                    BOUNTY STATUS TRANSITIONS                     │
└─────────────────────────────────────────────────────────────────┘

        ┌─────┐
        │OPEN │
        └──┬──┘
           │
           ├───► Hunter Accepts ────► IN_PROGRESS
           │
           └───► Poster Cancels ────► CANCELLED
                                      (100% refund)

        ┌─────────────┐
        │IN_PROGRESS  │
        └──────┬──────┘
               │
               ├───► Work Complete ────► COMPLETED
               │
               ├───► Cancel Request ───► CANCELLATION_REQUESTED
               │
               └───► Archive ──────────► ARCHIVED

        ┌────────────────────────┐
        │CANCELLATION_REQUESTED  │
        └───────────┬────────────┘
                    │
                    ├───► Accept ────────► CANCELLED
                    │                      (0-100% refund)
                    │
                    ├───► Reject ────────► IN_PROGRESS
                    │                      (continues)
                    │
                    └───► Dispute ───────► CANCELLED
                                           (status: "disputed")
                                           Opens Dispute

        ┌───────────┐
        │COMPLETED  │ (Terminal state)
        └───────────┘

        ┌───────────┐
        │CANCELLED  │ (Terminal state)
        └───────────┘

        ┌───────────┐
        │ARCHIVED   │ (Terminal state)
        └───────────┘
```

## 8. Notification Matrix

```
┌─────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION EVENTS                           │
└─────────────────────────────────────────────────────────────────┘

Event                        │ Recipient │ Title                  │ Action
────────────────────────────┼───────────┼────────────────────────┼──────────
Cancellation Request Created │ Hunter    │ "Cancellation Request" │ Review
                             │           │                        │
Cancellation Accepted        │ Poster    │ "Cancellation Accepted"│ View Refund
                             │           │                        │
Cancellation Rejected        │ Poster    │ "Cancellation Rejected"│ Continue
                             │           │                        │
Dispute Created              │ Other     │ "Dispute Filed"        │ Respond
                             │ Party     │                        │
                             │           │                        │
Dispute Under Review         │ Both      │ "Dispute Review"       │ Wait
                             │           │                        │
Dispute Resolved             │ Both      │ "Dispute Resolved"     │ View Result
```

## Summary

This visual guide shows:
1. Complete flow from request to resolution
2. Refund calculation logic with examples
3. Dispute resolution process
4. Database relationships
5. Wallet transaction flow
6. UI navigation paths
7. State machine for bounty status
8. Notification triggers

All flows are designed to be:
- **Fair**: Balanced refunds based on actual work
- **Transparent**: Clear audit trail
- **Secure**: Proper authorization checks
- **User-Friendly**: Mobile-first UI
