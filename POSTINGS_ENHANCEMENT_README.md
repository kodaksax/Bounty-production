# Postings Enhancement Features

This document describes the new features added to enhance the postings experience, including edit/delete functionality, improved bounty cards, reputation/ratings, disputes, and history views.

## Features Overview

### ✅ Edit & Delete Postings

Users can now edit and delete their own bounty postings with the following features:

- **Edit Modal**: Full-featured editing interface for modifying bounty details
  - Title, description, amount, location
  - "For Honor" toggle
  - Form validation
  - Optimistic UI updates with rollback on error

- **Delete Confirmation**: Safe deletion with confirmation dialog
  - "Delete this posting? This can't be undone."
  - Optimistic UI updates
  - Automatic feed refresh

- **Ownership Guards**: 
  - Edit/Delete actions only visible to posting owner
  - Server-side validation ensures security

**Location**: `components/edit-posting-modal.tsx`, integrated in `app/tabs/postings-screen.tsx`

### ✅ Enhanced Bounty Cards

New `BountyCard` component with improved aesthetics and functionality:

**Visual Improvements**:
- Emerald theme with elevated shadows
- Status badges (open, in_progress, completed, archived)
- Urgent badge for time-sensitive bounties
- Clean card layout with proper spacing

**Features**:
- **Rating Display**: Shows average rating with star icon (e.g., "4.3★ (12)")
- **Meta Information**: Location and work type (online/in-person) with icons
- **Owner Actions Row**: Edit, Delete, Share buttons (only for owner)
- **Amount Display**: Prominent price or "For Honor" badge

**Performance**:
- Optimized for FlatList rendering
- Memoization-ready design
- Efficient re-renders

**Location**: `components/bounty-card.tsx`

### ✅ Reputation & Ratings System

Complete rating system for building user reputation:

**Rating Prompt**:
- Shown after bounty completion
- 1-5 star rating
- Optional comment (up to 500 characters)
- Idempotent (one rating per bounty per user pair)

**Rating Display**:
- Average rating and count on profile chips
- Star icon with decimal precision (e.g., "4.3")
- Integrated in bounty cards

**Data Layer**:
- `UserRating` type with score, comment, timestamps
- `ratingsService` for CRUD operations
- `useRatings` hook for fetching and aggregating
- Aggregate functions for computing averages

**Location**: 
- `components/rating-prompt-modal.tsx`
- `lib/services/ratings.ts`
- `hooks/useRatings.ts`
- See `RATING_INTEGRATION_GUIDE.md` for integration steps

### ✅ Dispute System

Lightweight dispute mechanism for handling conflicts:

**Dispute Modal**:
- Guidance-first approach
- Clear explanation of dispute process
- Support contact information (support@bounty.app)
- Step-by-step process outline
- Confirmation step to prevent accidental disputes

**Features**:
- Opens from bounty detail or transaction row
- Updates transaction with "pending" dispute status
- Visual badge on transaction history
- Non-blocking (other bounties unaffected)
- Funds remain in escrow during dispute

**Process Flow**:
1. User opens dispute
2. Status set to "pending"
3. Support team notified
4. Review process (24-48 hours)
5. Resolution (release or refund)
6. Status updated to "resolved"

**Location**: 
- `components/dispute-modal.tsx`
- `lib/wallet-context.tsx` (disputeStatus support)
- See `DISPUTE_INTEGRATION_GUIDE.md` for integration steps

### ✅ History View

Simple history screen for completed and archived bounties:

**Features**:
- Lists all completed and archived bounties
- Status badges
- Amount/honor display
- Date sorting (newest first)
- Pull-to-refresh
- Empty state with helpful message

**Access**:
- Linked from Profile screen
- "View History" button below stats

**Performance**:
- FlatList for efficient scrolling
- Pagination ready
- Optimized data fetching

**Location**: 
- `components/history-screen.tsx`
- Integrated in `app/tabs/profile-screen.tsx`

## Architecture

### Data Types

All new types are defined in `lib/types.ts`:

```typescript
// User ratings
export interface UserRating {
  id: string;
  user_id: string; // ratee
  rater_id: string; // rater
  bountyId?: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: string;
}

// Extended wallet transaction
export interface WalletTransaction {
  // ... existing fields
  disputeStatus?: "none" | "pending" | "resolved";
}

// Extended bounty type (in database.types.ts)
export type Bounty = {
  // ... existing fields
  averageRating?: number;
  ratingCount?: number;
}
```

### Services

New services added to `lib/services/`:

- **ratingsService** (`ratings.ts`): CRUD operations for ratings
  - `create(rating)` - Create new rating
  - `getByUserId(userId)` - Get ratings for a user
  - `getAggregatedStats(userId)` - Get average and count
  - `hasRated(raterId, bountyId, userId)` - Check if already rated

### Hooks

New hooks added to `hooks/`:

- **useRatings** (`useRatings.ts`): Fetch and manage user ratings
  - Returns: `{ ratings, stats, loading, error, refresh }`
  - Automatically fetches on mount
  - Provides aggregated statistics

### Components

All new components follow the emerald theme and are fully responsive:

1. **BountyCard** - Enhanced bounty display with all features
2. **EditPostingModal** - Full-screen modal for editing bounties
3. **RatingPromptModal** - Post-completion rating interface
4. **DisputeModal** - Dispute opening with guidance
5. **HistoryScreen** - Full-screen history view

## Integration Patterns

### 1. Edit/Delete in Postings Screen

```tsx
import { BountyCard } from "components/bounty-card";

<BountyCard
  bounty={bounty}
  currentUserId={currentUserId}
  onEdit={() => handleEditBounty(bounty)}
  onDelete={() => handleDeleteBounty(bounty)}
/>
```

### 2. Ratings After Completion

```tsx
import { RatingPromptModal } from "components/rating-prompt-modal";

// Show after bounty completed
<RatingPromptModal
  visible={showRatingPrompt}
  onClose={() => setShowRatingPrompt(false)}
  onSubmit={handleSubmitRating}
  userName={otherUserName}
  bountyTitle={bountyTitle}
/>
```

### 3. Dispute from Transaction

```tsx
import { DisputeModal } from "components/dispute-modal";

<DisputeModal
  visible={showDisputeModal}
  onClose={() => setShowDisputeModal(false)}
  onSubmit={handleOpenDispute}
  bountyTitle={bountyTitle}
  transactionId={transactionId}
/>
```

### 4. History Access

```tsx
import { HistoryScreen } from "components/history-screen";

if (showHistory) {
  return <HistoryScreen onBack={() => setShowHistory(false)} />;
}
```

## Security & Permissions

### Ownership Guards

- Edit/Delete actions only visible to bounty owner
- Server-side validation required
- Client-side: `currentUserId === bounty.user_id`

### Rating Guards

- Users can only rate after completion
- One rating per bounty per user pair
- Both client and server validation

### Dispute Access

- Only participants can open disputes
- Disputes only for in-progress/completed bounties
- Transaction must exist

## UI/UX Guidelines

### Emerald Theme

All components use the emerald color palette:
- Primary: `#10b981` (emerald-500)
- Background: `#059669` (emerald-600)
- Dark: `#047857` (emerald-700)
- Darker: `#065f46` (emerald-800)
- Light: `#a7f3d0` (emerald-200)
- Lightest: `#d1fae5` (emerald-100)

### Mobile-First Design

- Thumb-reachable action buttons
- Bottom sheets for modals
- Safe area insets respected
- Proper padding for BottomNav

### Performance

- FlatList for all lists
- Memoization where appropriate
- Optimistic UI updates
- Efficient re-renders

## Testing Checklist

### Edit/Delete
- ✅ Edit button only shows for owner
- ✅ Edit form pre-fills correctly
- ✅ Validation works (required fields)
- ✅ Optimistic update displays immediately
- ✅ Rollback on error
- ✅ Delete confirmation appears
- ✅ Delete removes from list
- ✅ Non-owners cannot see actions

### Ratings
- ✅ Prompt appears after completion
- ✅ Cannot rate twice
- ✅ Stars are selectable
- ✅ Comment is optional
- ✅ Rating saves successfully
- ✅ Aggregate updates correctly
- ✅ Rating displays on cards

### Disputes
- ✅ Modal shows guidance
- ✅ Support email link works
- ✅ Confirmation step required
- ✅ Transaction status updates
- ✅ Badge appears on transaction
- ✅ Cannot dispute twice
- ✅ Only available to participants

### History
- ✅ Shows completed bounties
- ✅ Shows archived bounties
- ✅ Pull to refresh works
- ✅ Empty state displays correctly
- ✅ Navigation works properly

## Backend Requirements

### Database Schema

**user_ratings table**:
```sql
CREATE TABLE user_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  rater_id UUID NOT NULL REFERENCES profiles(id),
  bounty_id BIGINT REFERENCES bounties(id),
  score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_rating_per_bounty UNIQUE (rater_id, bounty_id, user_id)
);
```

**wallet_transactions update**:
```sql
ALTER TABLE wallet_transactions
ADD COLUMN dispute_status VARCHAR(20) DEFAULT 'none'
CHECK (dispute_status IN ('none', 'pending', 'resolved'));
```

**bounties update** (for caching):
```sql
ALTER TABLE bounties
ADD COLUMN average_rating NUMERIC(3,2),
ADD COLUMN rating_count INTEGER DEFAULT 0;
```

### RPC Functions

**get_user_rating_stats**:
```sql
CREATE OR REPLACE FUNCTION get_user_rating_stats(target_user_id UUID)
RETURNS TABLE (average_rating NUMERIC, rating_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(AVG(score), 0) as average_rating,
    COUNT(*) as rating_count
  FROM user_ratings
  WHERE user_id = target_user_id;
END;
$$ LANGUAGE plpgsql;
```

### API Endpoints

Required for full functionality:

- `POST /api/ratings` - Create rating
- `GET /api/ratings?user_id=...` - Get user ratings
- `GET /api/ratings/check?rater_id=...&bounty_id=...&user_id=...` - Check if rated
- `PATCH /api/bounties/:id` - Update bounty
- `DELETE /api/bounties/:id` - Delete bounty

## Migration Guide

### From Old Bounty List to BountyCard

**Before**:
```tsx
<View className="bg-emerald-800/50 rounded-lg p-4">
  <Text>{bounty.title}</Text>
  <Text>${bounty.amount}</Text>
</View>
```

**After**:
```tsx
<BountyCard
  bounty={bounty}
  currentUserId={currentUserId}
  onEdit={handleEdit}
  onDelete={handleDelete}
/>
```

### Adding Ratings to Existing Profiles

1. Add `averageRating` and `ratingCount` to profile queries
2. Use `useRatings` hook in profile components
3. Display ratings using the pattern in BountyCard

### Adding Dispute to Existing Transactions

1. Add `disputeStatus` field to transaction type
2. Use `updateDisputeStatus` from wallet context
3. Display badge in transaction list

## Future Enhancements

Potential improvements for future iterations:

1. **Mediation System**: Full admin interface for dispute resolution
2. **Rating Replies**: Allow ratees to respond to ratings
3. **Rating Categories**: Break down ratings (communication, quality, etc.)
4. **Dispute Escalation**: Multi-level dispute resolution
5. **Analytics**: Track rating trends and dispute frequency
6. **Notifications**: Real-time updates for ratings and disputes
7. **Batch Operations**: Edit/delete multiple postings at once

## Support

For issues or questions:
- Check integration guides: `RATING_INTEGRATION_GUIDE.md`, `DISPUTE_INTEGRATION_GUIDE.md`
- Review component implementations in `components/`
- Check service implementations in `lib/services/`
- Email: support@bounty.app

## License

Same as main project license.
