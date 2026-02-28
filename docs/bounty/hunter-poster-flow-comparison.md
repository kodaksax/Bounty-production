# Hunter vs Poster Flow Comparison

## Side-by-Side Flow Comparison

```
┌─────────────────────────────────────┬─────────────────────────────────────┐
│         POSTER FLOW                 │         HUNTER FLOW                 │
├─────────────────────────────────────┼─────────────────────────────────────┤
│                                     │                                     │
│  1️⃣  APPLY & WORK                   │  1️⃣  APPLY FOR WORK                 │
│     ├─ Pre-acceptance panel         │     ├─ Waiting room panel           │
│     ├─ "Awaiting a hunter"          │     ├─ "Waiting for selection"      │
│     ├─ View requests                │     ├─ Application pending          │
│     └─ Select hunter                │     └─ Auto-advance when selected   │
│                                     │                                     │
├─────────────────────────────────────┼─────────────────────────────────────┤
│                                     │                                     │
│  2️⃣  WORKING PROGRESS                │  2️⃣  WORK IN PROGRESS               │
│     ├─ Monitor hunter work          │     ├─ Perform bounty work          │
│     ├─ Quick message hunter         │     ├─ Quick message poster         │
│     ├─ View description             │     ├─ View description             │
│     ├─ Location/timeline info       │     ├─ Location/timeline info       │
│     └─ Next → Review & Verify       │     └─ Next → Review & Verify       │
│                                     │                                     │
├─────────────────────────────────────┼─────────────────────────────────────┤
│                                     │                                     │
│  3️⃣  REVIEW & VERIFY                 │  3️⃣  REVIEW & VERIFY                │
│     ├─ View submitted proof         │     ├─ Attach proof items           │
│     ├─ Quick message hunter         │     ├─ Quick message poster         │
│     ├─ Rate the work (1-5 stars)    │     ├─ Request review               │
│     ├─ Add comment (optional)       │     ├─ Wait for poster approval     │
│     └─ Proceed to Payout            │     └─ Advance to Payout (waiting)  │
│                                     │                                     │
├─────────────────────────────────────┼─────────────────────────────────────┤
│                                     │                                     │
│  4️⃣  PAYOUT                          │  4️⃣  PAYOUT                         │
│     ├─ Confirm payout release       │     ├─ Payout pending (waiting)     │
│     ├─ Toggle confirmation           │     ├─ Payout released (success)    │
│     ├─ Release funds button         │     ├─ View payout amount           │
│     ├─ Honor badge (if applicable)  │     ├─ Honor badge (if applicable)  │
│     ├─ Mark complete & archive      │     ├─ Current balance display      │
│     └─ Transaction logged           │     ├─ Archive button               │
│                                     │     └─ Delete button                │
│                                     │                                     │
└─────────────────────────────────────┴─────────────────────────────────────┘
```

## Shared Components

### Timeline Component
Both flows use identical 4-stage timeline:
```
┌────────┬────────┬────────┬────────┐
│ Stage1 │ Stage2 │ Stage3 │ Stage4 │
├────────┼────────┼────────┼────────┤
│  Icon  │  Icon  │  Icon  │  Icon  │
│ Label  │ Label  │ Label  │ Label  │
└────────┴────────┴────────┴────────┘

States:
  • Completed: Emerald bg, checkmark
  • Active: Emerald border, highlighted
  • Locked: Faded, not tappable
```

### Bounty Card
Both flows display bounty info consistently:
```
┌────────────────────────────────────┐
│  👤  Bounty Title                  │
│      Posted 2h ago                 │
│                          $50.00    │
└────────────────────────────────────┘
```

### Status Badges
Both flows use same badge patterns:
```
Poster: [⏳ Awaiting Hunter] [✓ In Progress] [✓ Completed]
Hunter: [⏳ Pending] [✓ Selected] [⏳ Payout Pending] [✓ Paid]
```

## Key Differences

### Stage 1: Initial State
- **Poster:** Waiting for applications (passive)
- **Hunter:** Application submitted (active wait)

### Stage 2: Work Phase
- **Poster:** Monitoring role (observer)
- **Hunter:** Performing role (doer)

### Stage 3: Verification
- **Poster:** Reviews and rates work
- **Hunter:** Submits proof and requests review

### Stage 4: Payment
- **Poster:** Releases payment (decision maker)
- **Hunter:** Receives payment (recipient)

## Complementary Actions

```
POSTER ACTION              ↔️              HUNTER ACTION
═══════════════════════════════════════════════════════

Post Bounty                              Browse Bounties
View Requests             ↔️              Apply to Bounty
Select Hunter             ↔️              Get Selected Notification
Monitor Work              ↔️              Perform Work
Receive Proof             ↔️              Submit Proof
Review & Rate             ↔️              Wait for Review
Release Payout            ↔️              Receive Payout
Archive Bounty            ↔️              Archive Bounty
```

## State Synchronization

### Status Flow
```
BOUNTY STATUS           POSTER STAGE        HUNTER STAGE
───────────────────────────────────────────────────────
open                    Apply & Work        Apply for Work
in_progress             Working Progress    Work in Progress
review_pending          Review & Verify     Review & Verify (waiting)
completed               Payout              Payout (released)
archived                (hidden)            (hidden)
```

### Request Status
```
REQUEST STATUS          POSTER VIEW         HUNTER VIEW
─────────────────────────────────────────────────────────
pending                 In Requests list    Waiting Room
accepted                Working stage       Work stage
rejected                (removed)           Notified + removed
```

## User Journey Example

### Complete Cycle
```
POSTER: Liam                              HUNTER: Sarah
════════════════════════════════════════════════════════

1. Creates "Website Design" bounty
   Amount: $500
   
                                          2. Sees bounty in feed
                                          3. Applies to bounty
                                          
4. Views Sarah's request
5. Accepts Sarah's request
   
                                          6. Gets notification
                                          7. Enters Work in Progress
                                          8. Designs website
                                          9. Attaches proof (screenshots)
                                          10. Requests review
                                          
11. Views submitted screenshots
12. Rates 5 stars
13. Adds positive comment
14. Proceeds to Payout
15. Confirms payout release
16. Releases $500
    
                                          17. Gets notification
                                          18. Sees "Payout Released!"
                                          19. Balance increases +$500
                                          20. Archives bounty
                                          
21. Bounty marked complete
22. Archives bounty
```

## UI/UX Consistency

### Colors
Both flows use identical color scheme:
- Primary: `#10b981` (emerald-500)
- Background: `#1a3d2e` (dark emerald)
- Accent: `#6ee7b7` (light emerald)
- Success: `#10b981` (emerald)
- Warning: `#fbbf24` (amber)
- Error: `#ef4444` (red)
- Honor: `#ec4899` (pink)

### Typography
Both flows use consistent text styles:
- Headers: 20px semibold
- Titles: 18px semibold
- Body: 14px regular
- Labels: 12px uppercase

### Spacing
Both flows maintain consistent spacing:
- Container padding: 16px
- Card padding: 16px
- Section gaps: 20px
- Element gaps: 12px

### Animations
Both flows share subtle animations:
- Stage transitions: slide_from_right
- Button press: scale 0.95
- List items: fade in
- Modals: slide from bottom

## Accessibility Parity

Both flows implement:
- ✅ Minimum touch targets (44x44pt)
- ✅ Screen reader support
- ✅ Color contrast compliance
- ✅ Loading state announcements
- ✅ Error message clarity

## Navigation Patterns

### Poster Navigation
```
Postings Tab
  ↓
My Postings
  ↓
Tap Bounty
  ↓
/postings/[bountyId]
  ↓ (stages within single route)
Dashboard → Review & Verify → Payout
```

### Hunter Navigation
```
Postings Tab
  ↓
In Progress
  ↓
Tap Bounty
  ↓
/in-progress/[bountyId]/hunter
  ↓ (separate routes per stage)
apply → work-in-progress → review-and-verify → payout
```

## Performance Characteristics

Both flows optimize:
- Lazy loading of conversation data
- Memoized route parameters
- Efficient list rendering
- Minimal re-renders on state changes
- Cached bounty data where possible

## Error Handling

Both flows provide:
- Graceful degradation
- Retry buttons
- Clear error messages
- Loading states
- Empty states
- Network status awareness

## Future Alignment

Both flows will benefit from:
- Real-time updates (WebSocket)
- Push notifications
- Enhanced messaging
- File upload progress
- Image previews
- Dispute resolution
- Rating/review system
- Analytics integration

## Conclusion

The hunter and poster flows are **complementary mirrors** of the same bounty lifecycle, providing each party with role-appropriate interfaces while maintaining complete aesthetic and functional parity.

**Key Success Factors:**
✅ Shared design system
✅ Consistent component patterns
✅ Parallel stage structures
✅ Synchronized state management
✅ Complementary user actions
✅ Unified navigation approach
