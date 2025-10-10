# Rating Integration Guide

This guide explains how to integrate the rating prompt modal after bounty completion.

## Overview

The rating system allows users to rate each other after completing a bounty. The `RatingPromptModal` component should be shown once after a bounty is marked as completed.

## Components

### RatingPromptModal

Located in `components/rating-prompt-modal.tsx`

**Props:**
- `visible: boolean` - Controls modal visibility
- `onClose: () => void` - Called when modal is dismissed
- `onSubmit: (rating: { score: 1|2|3|4|5; comment?: string }) => Promise<void>` - Called when user submits rating
- `userName: string` - Name of the person being rated
- `bountyTitle: string` - Title of the completed bounty

## Integration Steps

### 1. Import Required Modules

```tsx
import { RatingPromptModal } from "components/rating-prompt-modal";
import { ratingsService } from "lib/services/ratings";
import { getCurrentUserId } from "lib/utils/data-utils";
```

### 2. Add State Management

```tsx
const [showRatingPrompt, setShowRatingPrompt] = useState(false);
const [ratingTarget, setRatingTarget] = useState<{
  userId: string;
  userName: string;
  bountyId: string;
  bountyTitle: string;
} | null>(null);
```

### 3. Check if Rating Already Exists

Before showing the rating prompt, check if the user has already rated:

```tsx
const checkAndShowRatingPrompt = async (
  bountyId: string,
  bountyTitle: string,
  otherUserId: string,
  otherUserName: string
) => {
  const currentUserId = getCurrentUserId();
  
  // Check if already rated
  const hasRated = await ratingsService.hasRated(
    currentUserId,
    bountyId,
    otherUserId
  );
  
  if (!hasRated) {
    setRatingTarget({
      userId: otherUserId,
      userName: otherUserName,
      bountyId,
      bountyTitle,
    });
    setShowRatingPrompt(true);
  }
};
```

### 4. Handle Bounty Completion

After marking a bounty as completed, trigger the rating prompt:

```tsx
const handleCompleteBounty = async (bounty: Bounty) => {
  try {
    // Update bounty status to completed
    await bountyService.updateStatus(bounty.id, "completed");
    
    // Determine who should be rated (the other party)
    const currentUserId = getCurrentUserId();
    const otherUserId = bounty.user_id === currentUserId 
      ? bounty.acceptor_id  // If poster, rate the acceptor
      : bounty.user_id;     // If acceptor, rate the poster
    
    // Show rating prompt
    await checkAndShowRatingPrompt(
      bounty.id.toString(),
      bounty.title,
      otherUserId,
      otherUserName  // Get from profile data
    );
  } catch (error) {
    console.error("Failed to complete bounty:", error);
  }
};
```

### 5. Handle Rating Submission

```tsx
const handleSubmitRating = async (rating: { score: 1|2|3|4|5; comment?: string }) => {
  if (!ratingTarget) return;
  
  const currentUserId = getCurrentUserId();
  
  try {
    await ratingsService.create({
      user_id: ratingTarget.userId,      // Person being rated
      rater_id: currentUserId,            // Person giving rating
      bountyId: ratingTarget.bountyId,
      score: rating.score,
      comment: rating.comment,
    });
    
    // Close modal and clear target
    setShowRatingPrompt(false);
    setRatingTarget(null);
  } catch (error) {
    console.error("Failed to submit rating:", error);
    throw error; // RatingPromptModal will show error
  }
};
```

### 6. Render the Modal

Add the modal to your component's JSX:

```tsx
{ratingTarget && (
  <RatingPromptModal
    visible={showRatingPrompt}
    onClose={() => {
      setShowRatingPrompt(false);
      setRatingTarget(null);
    }}
    onSubmit={handleSubmitRating}
    userName={ratingTarget.userName}
    bountyTitle={ratingTarget.bountyTitle}
  />
)}
```

## Example: Complete Integration

Here's a complete example showing all the pieces together:

```tsx
import { useState } from "react";
import { RatingPromptModal } from "components/rating-prompt-modal";
import { ratingsService } from "lib/services/ratings";
import { bountyService } from "lib/services/bounty-service";
import { getCurrentUserId } from "lib/utils/data-utils";
import type { Bounty } from "lib/services/database.types";

export function BountyCompletionFlow() {
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<{
    userId: string;
    userName: string;
    bountyId: string;
    bountyTitle: string;
  } | null>(null);

  const checkAndShowRatingPrompt = async (
    bountyId: string,
    bountyTitle: string,
    otherUserId: string,
    otherUserName: string
  ) => {
    const currentUserId = getCurrentUserId();
    const hasRated = await ratingsService.hasRated(
      currentUserId,
      bountyId,
      otherUserId
    );
    
    if (!hasRated) {
      setRatingTarget({
        userId: otherUserId,
        userName: otherUserName,
        bountyId,
        bountyTitle,
      });
      setShowRatingPrompt(true);
    }
  };

  const handleCompleteBounty = async (bounty: Bounty, otherUserName: string) => {
    try {
      await bountyService.updateStatus(bounty.id, "completed");
      
      const currentUserId = getCurrentUserId();
      const otherUserId = bounty.user_id === currentUserId 
        ? "acceptor_id_here"  // Get from bounty data
        : bounty.user_id;
      
      await checkAndShowRatingPrompt(
        bounty.id.toString(),
        bounty.title,
        otherUserId,
        otherUserName
      );
    } catch (error) {
      console.error("Failed to complete bounty:", error);
    }
  };

  const handleSubmitRating = async (rating: { score: 1|2|3|4|5; comment?: string }) => {
    if (!ratingTarget) return;
    
    const currentUserId = getCurrentUserId();
    
    try {
      await ratingsService.create({
        user_id: ratingTarget.userId,
        rater_id: currentUserId,
        bountyId: ratingTarget.bountyId,
        score: rating.score,
        comment: rating.comment,
      });
      
      setShowRatingPrompt(false);
      setRatingTarget(null);
    } catch (error) {
      console.error("Failed to submit rating:", error);
      throw error;
    }
  };

  return (
    <>
      {/* Your completion UI here */}
      
      {ratingTarget && (
        <RatingPromptModal
          visible={showRatingPrompt}
          onClose={() => {
            setShowRatingPrompt(false);
            setRatingTarget(null);
          }}
          onSubmit={handleSubmitRating}
          userName={ratingTarget.userName}
          bountyTitle={ratingTarget.bountyTitle}
        />
      )}
    </>
  );
}
```

## Displaying Ratings

To display user ratings on profile cards or bounty cards, use the `useRatings` hook:

```tsx
import { useRatings } from "hooks/useRatings";

function UserProfileCard({ userId }: { userId: string }) {
  const { stats, loading } = useRatings(userId);
  
  if (loading) return <Text>Loading...</Text>;
  
  return (
    <View>
      {stats.ratingCount > 0 && (
        <View>
          <MaterialIcons name="star" size={16} color="#fcd34d" />
          <Text>{stats.averageRating.toFixed(1)} ({stats.ratingCount})</Text>
        </View>
      )}
    </View>
  );
}
```

## Backend Requirements

The ratings service expects the following:

1. **Supabase Table: `user_ratings`**
   - `id` (uuid, primary key)
   - `user_id` (uuid, foreign key to profiles) - person being rated
   - `rater_id` (uuid, foreign key to profiles) - person giving rating
   - `bounty_id` (bigint, foreign key to bounties)
   - `score` (smallint, 1-5)
   - `comment` (text, optional)
   - `created_at` (timestamp)

2. **Supabase Function: `get_user_rating_stats`**
   ```sql
   CREATE OR REPLACE FUNCTION get_user_rating_stats(target_user_id uuid)
   RETURNS TABLE (average_rating numeric, rating_count bigint) AS $$
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

3. **Unique Constraint**
   Add a unique constraint to prevent duplicate ratings:
   ```sql
   ALTER TABLE user_ratings
   ADD CONSTRAINT unique_rating_per_bounty 
   UNIQUE (rater_id, bounty_id, user_id);
   ```

## Testing

1. Complete a bounty
2. Verify rating prompt appears
3. Submit a rating with score and optional comment
4. Verify rating is saved
5. Try to rate again - should not show prompt
6. Check that ratings appear on profile cards

## Notes

- Ratings are idempotent - users can only rate once per bounty per person
- The `hasRated` check prevents duplicate rating prompts
- Ratings contribute to a user's overall reputation score
- Comments are optional and can be displayed in a full review section
