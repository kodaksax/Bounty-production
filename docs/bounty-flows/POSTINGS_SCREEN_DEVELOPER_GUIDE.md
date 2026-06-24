# Postings Screen — Comprehensive Developer Guide

> **Audience**: Engineers, AI contributors, and product stakeholders.  
> **Scope**: The full `PostingsScreen` (`app/tabs/postings-screen.tsx`) including every tab, how each tab works today, overlooked features, and recommended future enhancements.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Shared Infrastructure](#shared-infrastructure)
4. [Tab: New](#tab-new)
5. [Tab: My Postings](#tab-my-postings)
6. [Tab: In Progress](#tab-in-progress)
7. [Tab: Requests](#tab-requests)
8. [State Management & Data Flow](#state-management--data-flow)
9. [Navigation Integration](#navigation-integration)
10. [Performance Notes](#performance-notes)
11. [Accessibility](#accessibility)
12. [Security & Permissions](#security--permissions)
13. [Testing Checklist](#testing-checklist)
14. [Future Enhancements Summary](#future-enhancements-summary)
15. [UX Intuitiveness Improvements](#ux-intuitiveness-improvements)

---

## Overview

The **Postings Screen** is the poster-centric hub of the BOUNTYExpo platform. It is one of the five root destinations surfaced by `BottomNav` (via `bounty-app.tsx`) and serves two concurrent user roles:

| Role   | Primary use of this screen |
|--------|---------------------------|
| **Poster** | Create new bounties, monitor their open postings, review and accept hunter applications, track bounties through to payout |
| **Hunter** | Track every bounty they have applied to ("In Progress") and withdraw applications if needed |

The screen is composed of **four tabs** rendered inside a single `PostingsScreen` component:

```
┌────────────────────────────────────────────────┐
│  [NEW]  [IN PROGRESS]  [MY POSTINGS]  [REQUESTS] │  ← segmented tab bar
└────────────────────────────────────────────────┘
```

Tab order inside the component:

```typescript
const tabs = [
  { id: "new",        label: "New" },
  { id: "inProgress", label: "In Progress" },
  { id: "myPostings", label: "My Postings" },
  { id: "requests",   label: "Requests" },
]
```

The default active tab on mount is `"new"`.

---

## Architecture at a Glance

```
app/tabs/postings-screen.tsx         ← root component
│
├── app/screens/CreateBounty/        ← New tab (multi-step flow)
│   ├── index.tsx                    ← Flow controller (CreateBountyFlow)
│   ├── StepTitle.tsx
│   ├── StepDetails.tsx
│   ├── StepCompensation.tsx
│   ├── StepLocation.tsx
│   └── StepReview.tsx
│
├── components/my-posting-expandable.tsx  ← My Postings + In Progress rows
├── components/applicant-card.tsx         ← Requests tab rows
├── components/edit-posting-modal.tsx     ← Edit bounty modal
├── components/archived-bounties-screen.tsx ← Archived history overlay
│
├── hooks/useBountyForm.ts           ← Deprecated inline form (still imported)
├── hooks/useAcceptRequest.ts        ← Accept request logic (escrow + conversation)
├── hooks/useRejectRequest.ts        ← Reject request logic
│
└── lib/services/
    ├── bounty-service.ts            ← CRUD for bounties
    ├── bounty-request-service.ts    ← CRUD for applications/requests
    └── wallet-context.tsx           ← Escrow / wallet operations
```

---

## Shared Infrastructure

Several features span all four tabs and are easy to miss when reading the code for the first time.

### Fixed Header with Scroll Shadow

The header is positioned at `top: -55` (pulled up to overlap the global BottomNav gap) and uses `position: absolute` with `zIndex: 20`. It becomes elevated (box shadow applied) as soon as the active list scrolls past `y > 2px`.

```tsx
{showShadow && {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.2,
  shadowRadius: 6,
  elevation: 6,
}}
```

### Wallet Balance Button

A `WalletBalanceButton` in the top-right header is always visible regardless of the active tab. Tapping it calls `setActiveScreen('wallet')` to navigate directly to the Wallet screen. This is a **frequently overlooked navigation shortcut** — it lets posters check their balance without leaving the Postings screen.

### Archived Bounties Shortcut (Bookmark Icon)

A bookmark icon (📌) next to the wallet button opens `ArchivedBountiesScreen` as a full-screen overlay. This history view shows all bounties with status `completed` or `archived`. It is accessible from every tab and is **not documented in any in-app help text**, so many users do not discover it.

### Offline Status Badge

`<OfflineStatusBadge />` renders below the header row when the device has no internet. This is a passive indicator — the badge does **not** block interactions, but API calls will fail gracefully and show inline error banners instead.

### Error & Success Banners

Both banners render at the top of the scrollable content area above the active tab list. Errors include a dismiss `✕` button. `postSuccess` auto-dismisses because it is tied to the form submission state in `useBountyForm`.

### Pull-to-Refresh

All three data tabs (In Progress, My Postings, Requests) share a single `refreshAll()` call that runs `loadMyBounties()` and `loadInProgress()` in parallel. Requests are reloaded as a side effect of `loadMyBounties`.

---

## Tab: New

**Purpose**: Allow the authenticated poster to create a new bounty through a guided, multi-step wizard.

### File Reference

`app/screens/CreateBounty/index.tsx` — rendered as `<CreateBountyFlow …>` inside the New tab.

### Current Features

#### 5-Step Guided Form

The creation flow is split into five logical steps to reduce cognitive load and improve mobile UX:

| Step | Screen Component | What is Collected | Validation |
|------|-----------------|-------------------|------------|
| 1 | `StepTitle.tsx` | Title (5–120 chars), optional category | Required; trimmed whitespace check |
| 2 | `StepDetails.tsx` | Description (min 20 chars), optional timeline, optional skills | Min length enforced |
| 3 | `StepCompensation.tsx` | Amount (≥ $1) OR "For Honor" toggle | Must have amount > 0 or isForHonor = true |
| 4 | `StepLocation.tsx` | Work type (In Person / Online), location string for in-person | Location required only for in-person |
| 5 | `StepReview.tsx` | Read-only summary; escrow education modal | No new data; submit triggers API call |

#### Draft Persistence

> ⚠️ **Frequently overlooked feature** — Most developers assume the form resets on navigation. It does not.

Drafts are auto-saved to `AsyncStorage` with key `bounty-draft-v1` via `useBountyDraft`. The draft survives:
- App backgrounding and foregrounding
- Device restarts
- Navigating away and returning to the New tab

The draft is **only cleared** on successful bounty submission. Cancelling the flow (tapping "Cancel" or switching tabs) intentionally **preserves** the draft so the user can resume.

#### Email Verification Gate

```typescript
if (!canPostBounties) {
  throw new Error('Please verify your email address before posting bounties.');
}
```

If the user's email is not verified, the submit step throws before any API call. A `<EmailVerificationBanner>` is rendered at the top of the flow to guide users.

#### Escrow Education Modal

On Step 5 (StepReview), a dedicated modal explains escrow in four steps before the user confirms submission. Key details surfaced:
- 2.9% + $0.30 fee transparency
- Funds are held until bounty completion
- Dispute resolution pathway

This modal reduces payment-related support tickets. It is shown **only for paid bounties** (`isForHonor === false`).

#### Balance Validation Before Submission

```typescript
if (!validateBalance(draft.amount, balance, draft.isForHonor)) {
  throw new Error(getInsufficientBalanceMessage(draft.amount, balance));
}
```

The `validateBalance` utility (in `lib/utils/bounty-validation.ts`) ensures the poster cannot submit a paid bounty with insufficient wallet funds. The user is redirected to add funds if needed.

#### Atomic Create-then-Deduct Pattern

Funds are only deducted **after** the bounty is successfully created in the database. If the deduction fails, the bounty is automatically deleted (rolled back), preventing phantom bounties with no corresponding escrow.

#### Cancel Flow Reset

When the user cancels the multi-step flow, the parent resets the flow with a `setTimeout(() => setShowMultiStepFlow(true), 0)` trick to force a React remount on the next New tab visit, ensuring Step 1 is always shown fresh.

#### OnComplete Navigation

After a successful submission, the user is routed to `setActiveScreen('bounty')` (the main Bounty Feed), and `onBountyPosted?.()` is called to refresh the feed so the new posting is immediately visible.

### Overlooked Features

| Feature | Why It's Missed |
|---------|----------------|
| Draft persistence across sessions | No in-app indicator that a draft has been saved |
| Email verification gate with banner | Gate fires silently at submit; users may not notice the banner |
| Escrow modal fee breakdown | Only appears for paid bounties; honor-bounty users never see it |
| Balance check at submit vs. at amount selection | Immediate feedback only shown at amount selection in old form; new flow checks at submit |

### Recommended Future Enhancements

1. **Draft indicator** — Show a "Draft saved" chip in the tab bar or header when a draft exists.
2. **Location autocomplete** — Integrate a geolocation / places API so users don't have to type addresses.
3. **Attachment upload** — The `StepDetails` step has a placeholder for attachments; implement file picker + Supabase Storage upload.
4. **Rich text description** — Replace plain text input with a simple Markdown or rich-text editor.
5. **Bounty templates** — Allow users to save and reuse common bounty structures.
6. **Analytics funnel** — Track step completion and abandonment rates per step:
   ```typescript
   trackEvent('bounty_create_step_completed', { step, time_spent });
   ```
7. **AI-assisted title/description** — Surface an AI suggestion based on the selected category.
8. **Cross-device draft sync** — Back up the draft to Supabase so it survives device changes.
9. **Scheduling** — Allow posting to go live at a future date/time.
10. **Duplicate bounty** — Add a "Post Again" shortcut in My Postings to clone a previous bounty.

---

## Tab: My Postings

**Purpose**: Give the poster a complete, real-time view of every bounty they own (excluding archived/deleted). From here they can edit, delete, track progress, or launch the payout flow.

### File Reference

Rendered as a `FlatList` of `<MyPostingRow>` components, each backed by `<MyPostingExpandable>` (`components/my-posting-expandable.tsx`).

### Current Features

#### Expandable Bounty Cards

Each bounty in the list is a collapsible card. Tapping a card header toggles it open using `LayoutAnimation` for a smooth native animation (Android requires `UIManager.setLayoutAnimationEnabledExperimental(true)`).

When expanded, the card reveals:

| Panel | Content |
|-------|---------|
| **Progress Stepper** | 4-stage visual: Apply & Work → Working Progress → Review & Verify → Payout. Current stage is highlighted. |
| **Status + Actions** | Context-sensitive actions (Edit, Delete, Go to Review, Go to Payout) based on `bounty.status` |
| **Quick Message Bar** | Inline `<MessageBar>` tied to the bounty's conversation; send messages without leaving the list |
| **Attachments** | Shows any hunter-uploaded work-in-progress attachments via `<AttachmentsList>` |
| **Revision Feedback Banner** | Displays feedback the poster sent back to the hunter if a revision was requested |
| **Stale Bounty Alert** | Auto-detected warning if the bounty has been open for too long without activity (see `staleBountyService`) |

#### Work Type Filter

A chip row at the top of the list filters bounties by work type:

```
[ All ]  [ Online ]  [ In Person ]
```

Filters are client-side (no API call) and share the same `workTypeFilter` state with the In Progress tab.

> ⚠️ **Overlooked**: The filter persists while switching between My Postings and In Progress. A user who sets "Online" in My Postings will see "Online" pre-selected when they switch to In Progress.

#### Edit Posting (Owner Only)

The Edit button is shown **only** for bounties in `status === 'open'` and only when the current user is the owner. Tapping it opens `<EditPostingModal>` — a full-screen modal pre-filled with the existing title, description, amount, and location.

**Optimistic UI**: The card updates immediately with the new values; if the API call fails, the original values are rolled back.

#### Delete Posting (Owner Only)

Shown only for `status === 'open'` bounties. The confirmation dialog warns "This can't be undone."

**Escrow Refund Safety**: For paid open bounties, a 100% escrow refund is attempted **before** the deletion API call. If the refund fails, deletion is aborted and the user is shown an error.

#### Progress Stage Navigation

The `<Stepper>` component inside each expanded card maps bounty status → stage:

| `bounty.status` | Active Stage |
|----------------|-------------|
| `open` | Apply & Work |
| `in_progress` | Working Progress |
| `completed` | Payout |

Tapping the **"Go to Review"** button navigates to:
```
/postings/[bountyId]/review-and-verify
```
Tapping **"Go to Payout"** navigates to:
```
/postings/[bountyId]/payout
```

#### Scroll-to-Expanded Item

When a card is expanded, the list auto-scrolls to bring the expanded content fully into view using a combination of `itemRefs` (native refs) and `pendingScrollRef`. This is a subtlety many contributors miss when adding new content to expanded cards — adding more content may push actions below the fold.

#### Stale Bounty Detection

`staleBountyService` detects open bounties that haven't had activity within a threshold. When triggered, a `<StaleBountyAlert>` banner renders inside the expanded card, prompting the poster to follow up.

> ⚠️ **Overlooked**: This alert is only visible when the card is expanded and only when `status === 'open'`. No global notification is fired.

#### Archived Bounties Access

The bookmark icon in the header opens `ArchivedBountiesScreen`, which shows all bounties with `status === 'archived'` or `status === 'completed'`. Archived and deleted bounties are filtered **out** of the My Postings list to keep it actionable.

### Overlooked Features

| Feature | Why It's Missed |
|---------|----------------|
| Quick Message Bar inline | Looks like a passive display; it is actually a live send-capable input |
| Revision Feedback Banner | Only appears after a poster explicitly requests a revision; infrequent flow |
| Stale Bounty Alert | Rendered inside expanded panel only; easy to miss if user never expands |
| Scroll-to-Expanded behavior | Silent UX enhancement; no visual indicator |
| Escrow refund on delete | Automated behind the scenes; no explicit UI confirmation of the refund |

### Recommended Future Enhancements

1. **Push notifications for new requests** — Notify the poster when a hunter applies to one of their open bounties.
2. **Batch archive/delete** — Allow selecting multiple completed bounties and archiving them in one action.
3. **Rich editing** — Extend `EditPostingModal` to support deadline and skills fields.
4. **Status change notifications** — Notify the poster when a hunter marks work as ready for review.
5. **Quick stats overlay** — Show a badge on the card with the count of pending applications before expanding.
6. **In-card proof preview** — Render thumbnail previews of hunter-uploaded attachments directly in the card.
7. **Dispute initiation from card** — Surface a "Open Dispute" button inside the `review_verify` stage panel.
8. **Real-time updates via WebSocket** — The current implementation polls on mount and after user actions; add a WebSocket subscription so cards update live.
9. **Duplicate bounty** — "Post Again" shortcut to clone a completed bounty with pre-filled form values.
10. **Timeline & deadline display** — Surface the bounty's deadline prominently in the card header if set.

---

## Tab: In Progress

**Purpose**: Give the **hunter** visibility into every bounty they have applied to (or been accepted for), with the ability to submit work, track progress stages, and withdraw applications.

### File Reference

Rendered as a `FlatList` of `<MyPostingRow>` components in **`variant="hunter"`** mode, each backed by the same `<MyPostingExpandable>` component (with the `variant` prop flipping behaviour).

### Current Features

#### Data Loading Strategy

The In Progress list is populated by fetching all `bounty_requests` where `userId === currentUserId` and filtering out any request with `status === 'rejected'`. Unique bounties are then extracted from those requests.

Bounties with `status === 'archived'` or `'deleted'` are additionally excluded to keep the view clean.

#### Hunter-Mode Expandable Card

When `variant="hunter"`, the `<MyPostingExpandable>` adjusts its available actions (the `variant` prop flips behavior):

| Panel / Action | Hunter View |
|---------------|------------|
| Progress Stepper | Same 4-stage stepper; highlights current stage based on bounty status |
| Work in Progress (WIP) section | Collapsible `<AnimatedSection>` for uploading and listing proof-of-work attachments |
| Ready-to-Submit button | Marks work as ready for poster review; triggers `completionService.markReady()` |
| Payout section | Shows payout amount; only actionable once poster releases funds |
| Withdraw Application | Only shown for `status === 'open'` bounties |
| Revision Feedback Banner | If the poster requested changes, a `<RevisionFeedbackBanner>` displays the poster's comment |

#### Work Type Filter (Shared with My Postings)

The same `All / Online / In Person` chip row filters the In Progress list. As noted above, this state is shared and persists when switching tabs.

#### Proof-of-Work Attachment Upload

> ⚠️ **Frequently overlooked feature** — The WIP section inside each expanded card includes a real attachment upload capability powered by `useAttachmentUpload` hook.

Hunters can:
1. Tap "Add Proof" to open the device file picker.
2. Files are uploaded to Supabase Storage.
3. Uploaded attachments are listed in `<AttachmentsList>` and are visible to the poster in real time (within My Postings → expanded card).

#### Ready-to-Submit Flow

When the hunter taps **"Ready to Submit"**:
1. `completionService.markReady(bountyId, hunterId)` is called.
2. The poster sees a status update in their My Postings card.
3. The stale bounty timer resets.

A loading spinner on the button prevents duplicate submissions.

#### Withdraw Application

Available only when `bounty.status === 'open'`. A confirmation dialog ("Are you sure you want to withdraw?") calls `bountyRequestService.delete(request.id)`, then removes the bounty from the local list.

#### Go to Review & Payout (Hunter Path)

For accepted bounties, the expanded card surfaces:
- **Go to Review** → navigates to `/in-progress/[bountyId]/hunter/review-and-verify`
- **Go to Payout** → navigates to `/in-progress/[bountyId]/hunter/payout`

These routes are separate from the poster's routes (`/postings/[bountyId]/…`) to allow different UIs per role.

#### Cancellation Request Handling

If a poster initiates a cancellation, the hunter's card shows a `hasCancellationRequest` badge and offers an Accept / Deny response, managed by `cancellationService`.

#### Dispute Initiation

> ⚠️ **Overlooked**: Hunters can open a dispute from within the expanded card.

When the dispute icon is tapped, `disputeService.create(…)` is called and a `<DisputeModal>` guides the user through the process. The dispute is linked to the bounty and conversation, and the wallet transaction is updated with `disputeStatus: 'pending'`.

### Overlooked Features

| Feature | Why It's Missed |
|---------|----------------|
| Proof-of-work attachment upload | Hidden inside collapsed WIP section; no empty-state prompt |
| Dispute initiation | Requires expanding card and scrolling to actions row |
| Revision feedback banner | Only visible after poster sends revision request; silent otherwise |
| Cancellation response UI | Only surfaces when the poster has already requested cancellation |
| Ready-to-Submit state persistence | `readyRecord` is fetched on expand to prevent showing button twice |

### Recommended Future Enhancements

1. **Push notifications for acceptance** — Notify the hunter when a poster accepts their application.
2. **Push notifications for revision requests** — Notify the hunter when the poster requests a revision.
3. **Upload progress indicator** — Show a percentage bar when uploading large proof files.
4. **Multiple file upload** — Allow selecting a batch of files at once instead of one at a time.
5. **Work chat thread** — Embed a dedicated conversation thread inside the expanded card to keep all work communication in context.
6. **Deadline countdown** — If a deadline is set, surface a countdown in the card header.
7. **Portfolio auto-add** — After payout, prompt the hunter to add completed work to their profile portfolio.
8. **Application status timeline** — Show a timestamped log (Applied, Accepted, Work Submitted, Payment Released) inside the card.
9. **Real-time card refresh** — WebSocket subscription on the bounty row so status changes appear without a manual pull-to-refresh.
10. **Filter by status** — Add "Open" / "In Review" / "Completed" chip filters to complement the work type filter.

---

## Tab: Requests

**Purpose**: Show the **poster** all pending hunter applications for their open bounties, so they can quickly accept or reject applicants.

### File Reference

Rendered as a `FlatList` of `<ApplicantCard>` components (`components/applicant-card.tsx`).

### Current Features

#### Request Loading Logic

Requests are loaded by `loadRequestsForMyBounties(activeBounties)` which:
1. Filters `myBounties` to only include `status === 'open'` bounties.
2. Fires `bountyRequestService.getAllWithDetails({ bountyId })` in parallel for all open bounties via `Promise.all`.
3. Flattens the results into a single array.

> ⚠️ **Key behaviour**: Once a bounty moves to `in_progress` (i.e., someone is accepted), its requests are **no longer shown** in the Requests tab. The tab stays focused on actionable, open applications only.

#### ApplicantCard

Each card displays:

| Element | Detail |
|---------|--------|
| **Avatar + Initials fallback** | `getValidAvatarUrl` / `getAvatarInitials` utilities handle missing profile pictures |
| **Username** | Tapping navigates to the hunter's public profile |
| **Verification Badge** | `<VerificationBadge>` indicates the hunter's identity verification tier |
| **Reputation Score** | `<ReputationScoreCompact>` shows the hunter's aggregate star rating |
| **Request message** | The hunter's application note |
| **Accept button** | Green; triggers `handleAcceptRequest` with loading state |
| **Reject button** | Red/subtle; triggers `handleRejectRequest` with loading state |

#### Accept Flow (via `useAcceptRequest`)

Accepting a request triggers a multi-step orchestrated operation:

1. **Balance check** — Confirms the poster has sufficient wallet funds.
2. **Escrow creation** — `createEscrow(bountyId, amount)` holds the payment.
3. **Bounty status update** — `bountyService.update(bountyId, { status: 'in_progress' })`.
4. **Request status update** — Updates the accepted request to `status: 'accepted'`.
5. **Conversation creation** — A new conversation is created linking the bounty, poster, and hunter.
6. **State cleanup** — The accepted request and any other pending requests for that bounty are removed from the local list. The bounty moves from My Postings to In Progress on both sides.
7. **Callback** — `onBountyAccepted?.(bountyId)` fires so the parent can navigate to Messenger.

If any step fails, the operation halts and an error banner is shown. The escrow is **not** created until after the status update succeeds to prevent orphaned escrow records.

> ⚠️ **Overlooked**: The accept flow automatically opens a conversation in Messenger. Users often think they need to manually find the hunter to start a chat — they don't.

#### Reject Flow (via `useRejectRequest`)

Rejecting calls `bountyRequestService.update(requestId, { status: 'rejected' })` and removes the card from the local list immediately (optimistic update).

#### Profile Navigation from ApplicantCard

Tapping the hunter's avatar or name navigates to their public profile at `/profile/[userId]`. A brief 400ms loading indicator shows during the navigation transition to provide visual feedback.

> ⚠️ **Overlooked**: Posters can review a hunter's full history and reputation before accepting. Many posters accept or reject without visiting the profile.

#### Skeleton Loaders

While requests are loading, `<ApplicantCardSkeleton>` placeholders replace the list items to maintain layout stability and communicate loading progress.

#### Fixed Item Height Optimization

The Requests FlatList uses `getItemLayout` with a fixed height of `120` per card, enabling the native list renderer to pre-calculate offsets without measuring each item. This is an important performance optimisation that **should not be removed** unless `ApplicantCard` becomes variable-height.

### Overlooked Features

| Feature | Why It's Missed |
|---------|----------------|
| Auto-conversation creation on accept | The resulting conversation is in Messenger, not here — the visual feedback is absent |
| Hunter profile access via avatar tap | No tooltip or affordance hints at tappability |
| Automatic request removal for non-open bounties | Developers sometimes expect rejected bounties' requests to still appear |
| `getItemLayout` performance optimisation | Invisible to users; removing it degrades scroll performance on large lists |

### Recommended Future Enhancements

1. **Request filtering** — Add filters for "New", "Reviewed", "Pending" states within the tab.
2. **Batch accept/reject** — For high-volume postings, allow selecting multiple applicants and acting on them at once.
3. **Request More Info button** — `ApplicantCard` already accepts an `onRequestMoreInfo` prop (currently unused at the screen level); wire it up to a message modal.
4. **Highlight new applications** — Visually differentiate applications received since the user last visited the tab (unread badge).
5. **Sort options** — Sort applicants by reputation, application date, or verification level.
6. **Push notifications for new applications** — Notify the poster as soon as a hunter applies.
7. **Shortlist / star applicants** — Let posters mark applicants for later review without accepting or rejecting.
8. **Counter badge on tab** — Show the count of unreviewed applications directly on the "Requests" tab chip.
9. **Application preview expand** — Let the poster expand the card to see the hunter's portfolio or recent activity without leaving the screen.
10. **"Request More Info" messaging** — Complete the `onRequestMoreInfo` flow to open a direct message thread for clarification.

---

## State Management & Data Flow

```
PostingsScreen
├── myBounties          []Bounty    (poster-owned, non-archived)
├── inProgressBounties  []Bounty    (hunter-applied, non-rejected, non-archived)
├── bountyRequests      []BountyRequestWithDetails  (open bounties' requests only)
├── isLoading           { myBounties, inProgress, requests }
├── isRefreshing        boolean
├── error               string | null
├── expandedMap         Record<bountyId, boolean>
├── workTypeFilter      'all' | 'online' | 'in_person'
├── editingBounty       Bounty | null
├── showEditModal       boolean
└── formData / useBountyForm (legacy inline form state)
```

### Load Sequence on Mount

```
useEffect([postSuccess, currentUserId]) →
  loadMyBounties() → bountyService.getByUserId(currentUserId)
                  → loadRequestsForMyBounties(activeBounties)
                      → bountyRequestService.getAllWithDetails({ bountyId }) × n
  loadInProgress() → bountyRequestService.getAllWithDetails({ userId })
                   → extract unique bounties
```

Data is loaded in parallel (`Promise.all` for `loadMyBounties` + `loadInProgress`). The `refreshAll()` function replicates this in a `setIsRefreshing` wrapper for pull-to-refresh.

> **Note**: Supabase real-time subscriptions were intentionally removed. The component does **not** update live. To restore live updates, implement WebSocket or SSE subscriptions (see `REALTIME_BOUNTY_WEBSOCKET.md`).

---

## Navigation Integration

| Action | Destination |
|--------|------------|
| Wallet balance button tap | `setActiveScreen('wallet')` |
| Bookmark icon tap | `<ArchivedBountiesScreen>` overlay |
| My Postings → "Go to Review" | `router.push('/postings/[bountyId]/review-and-verify')` |
| My Postings → "Go to Payout" | `router.push('/postings/[bountyId]/payout')` |
| In Progress → "Go to Review" | `router.push('/in-progress/[bountyId]/hunter/review-and-verify')` |
| In Progress → "Go to Payout" | `router.push('/in-progress/[bountyId]/hunter/payout')` |
| ApplicantCard avatar/name tap | `router.push('/profile/[userId]')` |
| New tab → `onComplete` | `setActiveScreen('bounty')` (Bounty Feed) |
| In Progress empty state "Browse Bounties" | `setActiveScreen('bounty')` |
| Requests empty state "Post a Bounty" | `setActiveTab('new')` |
| My Postings empty state "Create Your First Bounty" | `setActiveTab('new')` |

---

## Performance Notes

- **FlatList** is used for all three data tabs (not `ScrollView`) to enable windowed rendering for large lists.
- `removeClippedSubviews={true}`, `maxToRenderPerBatch={5}`, `windowSize={5}`, and `initialNumToRender={5}` are set on all three FlatLists.
- `React.memo` wraps `MyPostingRow` to prevent re-renders of unexpanded rows when only one row's `expandedMap` entry changes.
- `React.useCallback` memoises `renderMyPostingItem`, `renderInProgressItem`, and `renderRequestItem`.
- Do **not** add `getItemLayout` to the My Postings or In Progress FlatLists — rows are variable height due to expansion.
- `getItemLayout` is correctly applied to the fixed-height Requests FlatList.

---

## Accessibility

- Every tab chip has `accessibilityRole="tab"` and `accessibilityState={{ selected }}`.
- Filter chips have `accessibilityLabel` and `accessibilityHint`.
- The bookmark icon has `accessibilityLabel="View archived bounties"` and `accessibilityHint="Opens a list of your archived bounties"`.
- `accessibilityElementsHidden={true}` is set on the bookmark icon's inner `MaterialIcons` to avoid duplicate announcement.
- All interactive elements are `TouchableOpacity` with sufficient touch target size (≥ 44pt).

---

## Security & Permissions

| Guard | Where Enforced |
|-------|----------------|
| Edit/Delete only for bounty owner | Client: `bounty.status === 'open'` + `currentUserId === bounty.user_id`; server: RLS policy |
| Accept/Reject only for bounty owner | `useAcceptRequest` passes `currentUserId`; server validates via RLS |
| Withdraw application only for hunter | Client: `variant === 'hunter'` guard; server: request `user_id` must match |
| Create bounty requires verified email | `useEmailVerification().canPostBounties` gate in `CreateBountyFlow` |
| Escrow refund before delete | `refundEscrow` called before `bountyService.delete`; delete aborted on refund failure |
| Authentication guard | `useValidUserId()` returns `null` for unauthenticated users; all data loaders bail early |

---

## Testing Checklist

### New Tab
- [ ] Draft is restored after navigating away and returning
- [ ] Email-unverified user cannot submit; banner appears
- [ ] Honor toggle skips amount validation
- [ ] Insufficient balance blocks submission with clear message
- [ ] Escrow modal appears for paid bounties; not for honor bounties
- [ ] Submission navigates to Bounty Feed and calls `onBountyPosted`
- [ ] Cancel resets flow to Step 1 on re-entry

### My Postings Tab
- [ ] Only `open` bounties show Edit / Delete buttons
- [ ] Edit pre-fills all fields; optimistic update visible immediately
- [ ] Edit rollback on API failure
- [ ] Delete confirmation dialog appears
- [ ] Paid open bounty delete triggers escrow refund first
- [ ] Archived/deleted bounties are excluded from the list
- [ ] Expanding a card auto-scrolls it into view
- [ ] Work type filter correctly shows/hides cards
- [ ] Stale bounty alert appears inside expanded card when conditions are met

### In Progress Tab
- [ ] Only non-rejected requests appear
- [ ] Attachment upload works; file appears in list after upload
- [ ] Ready-to-submit button is disabled after being pressed once
- [ ] Withdraw application removes card from list
- [ ] Revision feedback banner appears after poster requests revision
- [ ] Cancellation response UI appears when poster initiates cancellation
- [ ] Work type filter correctly shows/hides cards

### Requests Tab
- [ ] Only requests for `open` bounties are shown
- [ ] After accepting, request disappears and bounty moves to In Progress
- [ ] After rejecting, request disappears
- [ ] Hunter profile navigation works from avatar tap
- [ ] Skeleton loaders appear while loading
- [ ] Empty state CTA navigates to New tab

---

## Future Enhancements Summary

The table below consolidates the highest-priority improvements across all tabs:

| Priority | Enhancement | Affected Tabs |
|----------|------------|---------------|
| 🔴 High | Push notifications for new applications | Requests |
| 🔴 High | Push notifications for acceptance / rejection | In Progress |
| 🔴 High | Push notifications for revision requests | In Progress |
| 🔴 High | Real-time WebSocket card refresh | My Postings, In Progress |
| 🟠 Medium | Attachment upload (proof of work) improvements (progress bar, batch) | In Progress |
| 🟠 Medium | Unread / new application badge on Requests tab chip | Requests |
| 🟠 Medium | Quick stats badge (pending application count) on My Postings cards | My Postings |
| 🟠 Medium | Draft persistence indicator ("Draft saved") on New tab | New |
| 🟠 Medium | Location autocomplete in bounty creation | New |
| 🟡 Low | Batch archive/delete | My Postings |
| 🟡 Low | Bounty templates | New |
| 🟡 Low | AI-assisted title/description | New |
| 🟡 Low | Application shortlist / star | Requests |
| 🟡 Low | Duplicate bounty ("Post Again") | My Postings, New |
| 🟡 Low | Sort options for applicants | Requests |

---

## UX Intuitiveness Improvements

> **Context**: Beta testers have reported that the Postings screen requires conscious effort to learn rather than being immediately understood. This section diagnoses the root causes and provides concrete, implementation-ready changes ordered by effort and impact.

Intuitiveness means a user can accomplish their goal without instruction, tooltips, or exploration. The changes below are grouped into three tiers:

- **🟢 Quick Wins** — 1–2 hour changes, zero new dependencies, high perceived improvement
- **🟡 Medium Changes** — half-day changes, minimal new state, noticeable improvement
- **🔴 Larger Investments** — multi-day changes, may require new components or backend support

---

### Root Cause Analysis

Beta tester confusion traces to five structural patterns in the current screen:

| Root Cause | Affected Area | Symptom |
|------------|--------------|---------|
| **Hidden affordances** | My Postings, In Progress cards | Cards expand, but nothing signals that they are tappable or expandable |
| **Abstract tab names** | Tab bar | "Requests" and "New" require domain knowledge to interpret |
| **Invisible navigation shortcuts** | Header | Wallet Balance Button and bookmark icon provide navigation but have no labels |
| **Buried primary actions** | In Progress WIP section | Work submission, attachment upload, and "Ready to Submit" are inside a collapsed panel |
| **Silent side-effects** | Requests tab | Accepting an applicant silently creates a conversation — users don't know where to go next |

---

### 🟢 Quick Wins

#### 1. Rename "Requests" → "Applicants"

**Why**: "Requests" is ambiguous — it could mean HTTP requests, cancellation requests, or feature requests. "Applicants" is concrete and immediately understood.

**Where**: `app/tabs/postings-screen.tsx`, line ~286

```diff
  const tabs = [
    { id: "new",        label: "New" },
    { id: "inProgress", label: "In Progress" },
    { id: "myPostings", label: "My Postings" },
-   { id: "requests",   label: "Requests" },
+   { id: "requests",   label: "Applicants" },
  ]
```

**Accessibility note**: Update `accessibilityHint` on the Requests empty state CTAs from `"Post a Bounty"` to remain unchanged — only the visible label changes.

---

#### 2. Label the Bookmark (Archived History) Icon

**Why**: An unlabeled bookmark icon next to the wallet button is invisible to most users. It is the only path to view completed/archived bounty history, yet nobody finds it.

**Where**: `app/tabs/postings-screen.tsx`, header right section (~line 618)

```diff
  <TouchableOpacity
    className="ml-3 p-2 touch-target-min"
    onPress={() => setShowArchivedBounties(true)}
    accessibilityRole="button"
    accessibilityLabel="View archived bounties"
  >
+   <View className="items-center">
      <MaterialIcons name="bookmark" size={20} color="#ffffff" accessibilityElementsHidden={true} />
+     <Text className="text-white text-[9px] font-medium" accessibilityElementsHidden={true}>
+       HISTORY
+     </Text>
+   </View>
  </TouchableOpacity>
```

---

#### 3. Add a Chevron Expand Indicator to Bounty Cards

**Why**: Tappable/expandable cards must signal their interactivity. Without a chevron, users treat cards as read-only displays.

**Where**: `components/bounty-card.tsx` — add a rotating chevron to the card footer row.

```diff
+ import { Animated } from 'react-native';

  // Inside BountyCardProps, add:
+ expanded?: boolean;

  // Inside the card JSX, in the bottom-right of the card footer:
+ <MaterialIcons
+   name={expanded ? "keyboard-arrow-up" : "keyboard-arrow-down"}
+   size={18}
+   color="#6ee7b7"
+   accessibilityElementsHidden={true}
+ />
```

Pass `expanded={!!expandedMap[String(bounty.id)]}` from `renderMyPostingItem` and `renderInProgressItem` in `postings-screen.tsx`.

---

#### 4. Add Count Badges to Tab Chips

**Why**: Users don't know they have pending applicants without switching to the Requests tab. A badge gives at-a-glance awareness — the same pattern used in email, messaging, and every major mobile app.

**Where**: `app/tabs/postings-screen.tsx`, tab bar render (~line 657)

Add badge counts to the tabs array:

```tsx
const tabBadges: Record<string, number> = {
  requests: bountyRequests.length,
  inProgress: inProgressBounties.filter(b => b.status === 'in_progress').length,
}
```

Update the tab chip render to show the badge:

```tsx
{tabs.map((tab) => {
  const isActive = activeTab === tab.id
  const badge = tabBadges[tab.id] ?? 0
  return (
    <TouchableOpacity key={tab.id} onPress={() => setActiveTab(tab.id)} ...>
      <View className="relative items-center">
        <Text className={...}>{tab.label.toUpperCase()}</Text>
        {badge > 0 && (
          <View
            className="absolute -top-1 -right-3 bg-red-500 rounded-full min-w-[14px] h-[14px] items-center justify-center"
            accessibilityElementsHidden={true}
          >
            <Text className="text-white text-[8px] font-bold px-0.5">
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
})}
```

---

#### 5. "Accept opens a chat" Micro-Copy in ApplicantCard

**Why**: Posters accept hunters and then ask support "where is my chat?" because accepting silently creates a conversation in Messenger with no visual confirmation or pointer.

**Where**: `components/applicant-card.tsx`, below the Accept button

```diff
  <TouchableOpacity onPress={handleAccept} ...>
    <Text>Accept</Text>
  </TouchableOpacity>
+ <Text className="text-emerald-300 text-[10px] text-center mt-0.5" accessibilityElementsHidden={true}>
+   Opens a chat in Messenger
+ </Text>
```

---

#### 6. Show "Draft saved" Indicator on the New Tab

**Why**: Users lose drafts by leaving the New tab, assuming nothing was saved. The opposite is true — drafts persist — but there's no indicator of this.

**Where**: `app/tabs/postings-screen.tsx` — check for a saved draft using `useBountyDraft` and render a small indicator when `activeTab === 'new'`.

```tsx
// In PostingsScreen:
const { draft } = useBountyForm(...)
// draft exists when title is non-empty
const hasDraft = !!draft?.title

// In the tab render, add below the tab bar:
{activeTab === 'new' && hasDraft && (
  <View className="mx-4 mb-1 flex-row items-center gap-1">
    <MaterialIcons name="save" size={12} color="#6ee7b7" />
    <Text className="text-emerald-300 text-xs">Draft saved — your progress is restored automatically</Text>
  </View>
)}
```

---

### 🟡 Medium Changes

#### 7. Surface the Primary Action on Collapsed Cards

**Why**: The most important action for an in-progress bounty (e.g., "Submit Work", "Review Submission", "Release Payout") is only reachable by expanding the card and scrolling. Users who never expand cards never complete their bounties.

**Strategy**: Inspect `bounty.status` and `variant` at render time and add a single prominent CTA *below* the collapsed `BountyCard` but *above* the expanded panel. Only show the single most important next action.

```tsx
// In MyPostingExpandable, between BountyCard and AnimatedSection:
const primaryAction = useMemo(() => {
  if (variant === 'owner') {
    if (hasSubmission)    return { label: 'Review Submission →', color: '#fbbf24', onPress: () => setReviewExpanded(true) }
    if (bounty.status === 'in_progress') return null // nothing to do yet
  }
  if (variant === 'hunter') {
    if (hasRevisionRequested) return { label: 'View Revision Request →', color: '#f97316', onPress: () => setWipExpanded(true) }
    if (!hasSubmission && bounty.status === 'in_progress')
      return { label: 'Submit Work →', color: '#10b981', onPress: () => setWipExpanded(true) }
    if (submissionPending) return { label: 'Awaiting poster review', color: '#38bdf8', onPress: null }
  }
  return null
}, [variant, hasSubmission, hasRevisionRequested, submissionPending, bounty.status])

{primaryAction && !expanded && (
  <TouchableOpacity
    onPress={() => { onToggle(); primaryAction.onPress?.() }}
    className="mx-1 mb-2 py-2 px-4 rounded-lg flex-row items-center justify-between"
    style={{ backgroundColor: primaryAction.color + '22', borderWidth: 1, borderColor: primaryAction.color + '66' }}
  >
    <Text style={{ color: primaryAction.color, fontSize: 13, fontWeight: '600' }}>
      {primaryAction.label}
    </Text>
    <MaterialIcons name="arrow-forward" size={14} color={primaryAction.color} />
  </TouchableOpacity>
)}
```

---

#### 8. Add "Tap to manage" Subtitle to Card Headers

**Why**: New users don't understand that the card header is tappable. A small, secondary label reinforces the interaction affordance alongside the chevron (Quick Win #3).

**Where**: `components/bounty-card.tsx`, card header subtitle

```diff
  <Text className="text-white font-semibold text-base" numberOfLines={2}>
    {bounty.title}
  </Text>
+ {!expanded && (
+   <Text className="text-emerald-300 text-xs mt-0.5" accessibilityElementsHidden={true}>
+     Tap to manage
+   </Text>
+ )}
```

Use `expanded` prop added in Quick Win #3.

---

#### 9. Better Empty States for Each Tab

Current empty state descriptions are generic. More contextual copy helps users understand *why* the tab is empty and *exactly* what to do.

**Where**: `app/tabs/postings-screen.tsx`, each tab's `ListEmptyComponent`

| Tab | Current Description | Improved Description |
|-----|--------------------|--------------------|
| In Progress | "Ready to start earning? Browse available bounties and accept one to begin!" | "Bounties you apply to show up here once a poster accepts you. Browse open bounties to apply." |
| My Postings | "You haven't posted any bounties yet. Create your first bounty to get started!" | "Post a task with a reward. When someone applies, you'll review them here in My Postings." |
| Requests | "When hunters apply to your bounties, you'll review and accept them here. Post a bounty to get started!" | "No applications yet. Make sure your bounty is live and clearly describes the work needed." |

---

#### 10. Progress Stage Indicator Visible Without Expanding

**Why**: Users don't know where a bounty is in its lifecycle until they expand the card. Showing the current stage as a small coloured pill in the collapsed `BountyCard` creates at-a-glance awareness.

The `BountyCard` already has `getStatusLabel()`. Extend it to map to human-readable stage language:

```tsx
// In bounty-card.tsx getStatusLabel():
if (reviewNeeded)        return '📋 REVIEW NEEDED'
if (submittedForReview)  return '📤 SUBMITTED FOR REVIEW'
// add:
if (bounty.status === 'in_progress' && !reviewNeeded && !submittedForReview) return '🔨 WORK IN PROGRESS'
if (bounty.status === 'completed')   return '✅ COMPLETED'
```

---

### 🔴 Larger Investments

#### 11. One-Time Onboarding Overlay for New Users

**Why**: First-time users see four tabs with no explanation. A lightweight tooltip sequence (run once, stored in `AsyncStorage`) prevents the most common confusion.

**Implementation outline**:

1. Create a `useFirstVisit(key: string)` hook backed by `AsyncStorage`.
2. After the first `loadMyBounties()` completes and the list is empty, show a `<CoachmarkOverlay>` component.
3. The overlay highlights, in sequence: (a) the New tab — "Post a task here", (b) the My Postings tab — "Your tasks live here", (c) the Requests (Applicants) tab — "Review and accept applicants here".
4. Dismiss on tap or after 8 seconds.

```tsx
const { isFirstVisit, markVisited } = useFirstVisit('postings-screen-v1')

useEffect(() => {
  if (isFirstVisit && !isLoading.myBounties && myBounties.length === 0) {
    // Show onboarding overlay
  }
}, [isFirstVisit, isLoading.myBounties, myBounties.length])
```

---

#### 12. Post-Accept Confirmation Toast with Navigation Shortcut

**Why**: After accepting an applicant, the user is left on the now-empty Requests tab with no feedback about what happened or where the conversation went.

**Implementation**: In `useAcceptRequest`, after the conversation is created, trigger a toast (or inline banner) with a navigation shortcut:

```tsx
// After successful accept in useAcceptRequest:
showToast({
  message: `${hunterName} accepted! A chat has been started.`,
  action: { label: 'Open Chat', onPress: () => setActiveScreen('messenger') }
})
```

Use the existing `error` state pattern (replace with a `notification` state) or integrate a lightweight toast library already in the project.

---

#### 13. Real-Time Notification Dot on BottomNav Postings Icon

**Why**: Users don't return to the Postings screen because they don't know something needs their attention. A notification dot on the BottomNav icon (not a push notification — just a local indicator) draws them back.

**Signal conditions**:
- `bountyRequests.length > 0` (new applicants)
- Any `inProgressBounty` where a submission is pending review (`hasSubmission`)
- Any stale bounty alert

**Where**: Pass a `hasPendingAction` prop from `PostingsScreen` up to `BountyApp` / `BottomNav`:

```tsx
// In bounty-app.tsx, pass to BottomNav:
<BottomNav
  activeScreen={activeScreen}
  onNavigate={setActiveScreen}
  postingsBadge={postingsPendingCount > 0}
/>
```

---

### Intuitiveness Change Summary

| # | Change | Tier | Effort | Impact |
|---|--------|------|--------|--------|
| 1 | Rename "Requests" → "Applicants" | 🟢 Quick Win | 5 min | High — removes ambiguity |
| 2 | Label the bookmark icon "HISTORY" | 🟢 Quick Win | 10 min | Medium — reveals hidden feature |
| 3 | Chevron expand indicator on cards | 🟢 Quick Win | 30 min | High — shows cards are tappable |
| 4 | Count badges on tab chips | 🟢 Quick Win | 1 hr | High — surfaces pending work |
| 5 | "Opens a chat" micro-copy on Accept | 🟢 Quick Win | 10 min | High — removes most common confusion |
| 6 | "Draft saved" indicator on New tab | 🟢 Quick Win | 30 min | Medium — prevents data loss anxiety |
| 7 | Primary action CTA on collapsed cards | 🟡 Medium | 2–4 hrs | Very High — removes biggest friction |
| 8 | "Tap to manage" subtitle on card | 🟡 Medium | 30 min | Medium — reinforces affordance |
| 9 | Improved empty state copy | 🟡 Medium | 1 hr | Medium — reduces dead-end confusion |
| 10 | Stage pill visible without expanding | 🟡 Medium | 1 hr | High — lifecycle visible at a glance |
| 11 | One-time onboarding overlay | 🔴 Larger | 1–2 days | Very High — eliminates cold-start confusion |
| 12 | Post-accept toast + chat shortcut | 🔴 Larger | 4–8 hrs | High — closes navigation gap |
| 13 | Notification dot on BottomNav | 🔴 Larger | 4–8 hrs | High — pulls users back to act |

**Recommended implementation order**: Start with items 1–6 (combined effort < 3 hours) as a fast-follow release. Then tackle item 7 (primary action CTA) as the single highest-impact individual change before investing in the onboarding overlay.

---

## Related Documents

- [Bounty Dashboard Implementation](BOUNTY_DASHBOARD_IMPLEMENTATION.md) — Detail on `/postings/[bountyId]/` routes (Review & Verify, Payout)
- [Create Bounty Implementation](CREATE_BOUNTY_IMPLEMENTATION.md) — Multi-step New tab implementation details
- [Bounty Applications Setup](BOUNTY_APPLICATIONS_SETUP.md) — Database setup for `bounty_requests` table
- [Postings Enhancement Summary](POSTINGS_ENHANCEMENT_SUMMARY.md) — Edit/Delete, Ratings, Disputes, History features
- [Hunter Flow Complete](HUNTER_FLOW_COMPLETE.md) — End-to-end hunter journey from application to payout
- [Completion Flow Summary](COMPLETION_FLOW_SUMMARY.md) — Bounty completion and payout flows
- [Cancellation System Summary](CANCELLATION_SYSTEM_SUMMARY.md) — Cancellation request and response flows
- [Dispute Resolution System](DISPUTE_RESOLUTION_SYSTEM.md) — Dispute lifecycle and admin resolution

---

*Last updated: 2026-04-16*  
*Primary source file: `app/tabs/postings-screen.tsx`*
