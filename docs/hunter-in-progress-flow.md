# Hunter In-Progress Flow

## Overview
The hunter-side In-Progress workflow provides a centralized interface for hunters to manage bounties they've applied to, from application to payout.

## Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Entry Point: /in-progress/[bountyId]/hunter                    │
│                                                                 │
│ Index route determines stage based on:                         │
│  - BountyRequest status (pending, accepted, rejected)         │
│  - Bounty status (open, in_progress, completed)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
              ┌───────────────┴───────────────┐
              │                               │
         PENDING                          ACCEPTED
              │                               │
              ↓                               ↓
    ┌─────────────────┐              ┌────────────────────┐
    │  APPLY STAGE    │              │ Check Bounty Status │
    │  (Waiting Room) │              └─────────┬──────────┘
    └─────────────────┘                        │
                                     ┌─────────┴─────────────┐
                                     │                       │
                              OPEN/IN_PROGRESS          COMPLETED
                                     │                       │
                                     ↓                       ↓
                          ┌──────────────────┐    ┌─────────────────┐
                          │ WORK IN PROGRESS │    │  PAYOUT STAGE   │
                          └────────┬─────────┘    └─────────────────┘
                                   │
                                   ↓
                          ┌──────────────────┐
                          │ REVIEW & VERIFY  │
                          └────────┬─────────┘
                                   │
                                   ↓
                          ┌──────────────────┐
                          │  PAYOUT STAGE    │
                          │  (Waiting State) │
                          └──────────────────┘
```

## Stage Details

### 1. Apply for Work (Waiting Room)
**Route:** `/in-progress/[bountyId]/hunter/apply`

**Purpose:** Shows hunter that their application is pending poster's review.

**Key Features:**
- Status badge: "Application Pending"
- Bounty details display
- 4-stage timeline (Apply stage active)
- Auto-redirects when:
  - Request is accepted → Work in Progress
  - Request is rejected → Back to main screen with notification

**Guards:**
- Only visible if hunter has a pending request
- Redirects if no request exists

---

### 2. Work in Progress
**Route:** `/in-progress/[bountyId]/hunter/work-in-progress`

**Purpose:** Active work stage where hunter performs the bounty task.

**Key Features:**
- Bounty details card (title, amount, posted time)
- 4-stage timeline (Work in Progress stage active)
- Quick messaging to poster
- Context panel with description (expandable)
- Timeline and location info
- "Next" button to advance to Review & Verify

**Guards:**
- Only accessible if request status is "accepted"
- Redirects to Apply if not accepted

---

### 3. Review & Verify
**Route:** `/in-progress/[bountyId]/hunter/review-and-verify`

**Purpose:** Submit proof of completion and request review from poster.

**Key Features:**
- Bounty info card
- 4-stage timeline (Review & Verify stage active)
- Quick messaging to poster
- Proof of completion section:
  - Attach images/files (mock implementation)
  - View attached items
  - Remove attachments
- "Request Review" button
  - Validates at least one proof item attached
  - Advances to Payout (waiting state)

**Guards:**
- Only accessible if request status is "accepted"
- Validates proof attachments before submission

---

### 4. Payout
**Route:** `/in-progress/[bountyId]/hunter/payout`

**Purpose:** Final stage showing payout status and completion.

**States:**

**A. Waiting State (default after review submission)**
- Yellow hourglass icon
- "Waiting for Payout Release" message
- Status badge: "Payout Pending"
- Payout stage greyed out in timeline

**B. Payout Released State (after poster approval)**
- Green checkmark icon
- "Payout Released!" message
- For paid bounties:
  - Payout amount card
  - Current wallet balance
- For honor bounties:
  - Honor badge and thank you message
- Actions:
  - Archive button → Moves to archived
  - Delete button → Removes from list
- Both actions navigate back to main screen

**Guards:**
- Only accessible if request status is "accepted"
- Display changes based on bounty.status === "completed"

---

## Navigation Flow

### Entry Points
1. **From In Progress Tab:** 
   - Tap InProgressBountyItem → `/in-progress/[bountyId]/hunter`
   - Index determines appropriate stage

2. **Direct Navigation:**
   - Can navigate to specific stages directly via route params
   - Guards ensure proper access control

### Stage Transitions
```
Apply (pending)
  ↓ (auto-advance on selection)
Work in Progress
  ↓ (tap Next button)
Review & Verify
  ↓ (tap Request Review)
Payout (waiting)
  ↓ (poster releases funds)
Payout (released)
  ↓ (tap Archive or Delete)
Main Screen
```

---

## Data Flow

### Required Data
- **Bounty:** ID, title, description, amount, is_for_honor, location, timeline, status
- **BountyRequest:** ID, bounty_id, user_id, status (pending/accepted/rejected)
- **Conversation:** For messaging (optional)
- **Proof Items:** Attachments for review stage

### Status Mapping
```
BountyRequest.status:
  - pending    → Apply stage
  - accepted   → Work/Review/Payout (based on bounty.status)
  - rejected   → Redirect back

Bounty.status:
  - open         → Work in Progress
  - in_progress  → Work in Progress
  - completed    → Payout (released state)
```

---

## Aesthetic & UX Principles

### Design System
- **Primary Color:** Emerald (#10b981)
- **Background:** Dark emerald (#1a3d2e)
- **Accents:** Light emerald (#6ee7b7)
- **Status Colors:**
  - Pending: Amber (#fbbf24)
  - Success: Emerald (#10b981)
  - Error: Red (#ef4444)
  - Honor: Pink (#ec4899)

### Component Patterns
- **Timeline:** Horizontal scrollable, 4 stages, visual feedback
- **Cards:** Rounded, semi-transparent emerald background, subtle borders
- **Buttons:** Full-width primary actions, emerald background
- **Status Badges:** Icon + text, appropriate color coding
- **Safe Areas:** Proper padding for iOS notches and bottom nav

### Shared Components with Poster Flow
- Timeline structure (4 stages with icons)
- Card styling (bounty info, context panels)
- Button variants (primary, secondary, destructive)
- Status badges
- Empty states

---

## Integration Points

### Services
- `bountyService.getById()` - Load bounty data
- `bountyRequestService.getAll()` - Check hunter's request
- `messageService.getConversations()` - Load conversation
- `messageService.sendMessage()` - Send quick messages

### Wallet Context
- `useWallet()` - Access balance
- `deposit()` - Add payout to balance (mock for now)

### Authentication
- `useAuthContext()` - Get current user
- `getCurrentUserId()` - Verify hunter identity

---

## Testing Checklist

### Unit Tests
- [ ] Stage determination logic in index route
- [ ] Guard conditions for each stage
- [ ] Proof attachment add/remove
- [ ] Status badge display logic

### Integration Tests
- [ ] Apply → Work → Review → Payout flow
- [ ] Auto-advance on selection
- [ ] Messaging integration
- [ ] Archive/delete actions

### Manual Tests
- [ ] Navigation from In Progress tab
- [ ] Timeline visual feedback
- [ ] Proof submission validation
- [ ] Payout state transitions
- [ ] Safe area padding on iOS
- [ ] Bottom nav positioning

---

## Future Enhancements

1. **Real-time Updates**
   - WebSocket notifications for selection/rejection
   - Live payout release notifications
   - Chat message updates

2. **Proof Upload**
   - expo-image-picker integration
   - expo-document-picker for files
   - Upload progress indicators
   - Cloud storage integration

3. **Enhanced Messaging**
   - Full chat history
   - Image/file attachments
   - Read receipts
   - Typing indicators

4. **Location Features**
   - Minimap preview in Work stage
   - Distance calculation
   - Navigation integration

5. **Ratings & Reviews**
   - Rate poster after completion
   - View bounty completion history
   - Hunter reputation system

6. **Notifications**
   - Push notifications for status changes
   - In-app notification center
   - Email notifications

---

## Technical Notes

### Performance
- Lazy load conversation data
- Optimize timeline rendering
- Cache bounty data between stages
- Debounce message sending

### Error Handling
- Graceful degradation if services fail
- Retry buttons on errors
- Toast notifications for success/failure
- Network status awareness

### Accessibility
- Proper heading hierarchy
- Screen reader labels
- Touch target sizes (44x44pt minimum)
- Color contrast ratios

### Security
- Verify hunter owns the request
- Validate status transitions server-side
- Sanitize user input
- Secure file uploads
