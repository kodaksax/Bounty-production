# Stale Bounty Handling System

This document describes the comprehensive system for handling "stale" bounties - bounties that are affected when a hunter's account is deleted.

## Overview

When a user who has accepted a bounty deletes their account, the bounty enters a "stale" state. This system ensures that bounty posters are notified and given clear options to resolve the situation.

## Problem Statement

**Edge Case:** What happens to accepted bounties when the hunter deletes their account?

**Solution:** The system:
1. Automatically detects affected bounties
2. Marks them as "stale"
3. Notifies the bounty poster
4. Provides reconciliation options
5. Cleans up resolved bounties

## Architecture

### Database Schema

**Users Table** (soft delete support):
```sql
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;
```

**Bounties Table** (stale tracking):
```sql
ALTER TABLE "bounties" ADD COLUMN "is_stale" boolean DEFAULT false NOT NULL;
ALTER TABLE "bounties" ADD COLUMN "stale_reason" text;
ALTER TABLE "bounties" ADD COLUMN "stale_detected_at" timestamp with time zone;
```

**Indexes** (for performance):
```sql
CREATE INDEX "idx_bounties_is_stale" ON "bounties" ("is_stale") WHERE "is_stale" = true;
CREATE INDEX "idx_bounties_hunter_status" ON "bounties" ("hunter_id", "status") WHERE "status" = 'in_progress';
```

### Backend Components

#### StaleBountyService

Located: `services/api/src/services/stale-bounty-service.ts`

**Methods:**
- `detectStaleBounties(deletedUserId)` - Find and mark bounties as stale
- `getStaleBountiesForPoster(posterId)` - List stale bounties for a poster
- `cancelStaleBounty(bountyId, posterId)` - Cancel and refund
- `repostStaleBounty(bountyId, posterId)` - Reset to open status

#### API Endpoints

Located: `services/api/src/routes/stale-bounty.ts`

```
GET  /stale-bounties              # List stale bounties for authenticated user
POST /stale-bounties/:id/cancel   # Cancel bounty and process refund
POST /stale-bounties/:id/repost   # Repost bounty for new hunters
```

#### Notification Types

New notification types added:
- `stale_bounty` - Alert poster about stale bounty
- `stale_bounty_cancelled` - Confirmation of cancellation
- `stale_bounty_reposted` - Confirmation of repost

#### Outbox Events

New event types for async processing:
- `BOUNTY_STALE` - Bounty became stale
- `STALE_BOUNTY_REFUND` - Process refund for cancelled stale bounty
- `BOUNTY_REPOSTED` - Bounty was reposted

### Frontend Components

#### StaleBountyAlert Component

Located: `components/stale-bounty-alert.tsx`

**Features:**
- Warning banner with clear messaging
- Two action buttons: "Cancel & Refund" and "Repost Bounty"
- Confirmation dialogs before actions
- Responsive design following emerald theme

**Usage:**
```tsx
<StaleBountyAlert
  bounty={bounty}
  onCancel={handleCancelStaleBounty}
  onRepost={handleRepostStaleBounty}
/>
```

#### Stale Bounty Service (Client)

Located: `lib/services/stale-bounty-service.ts`

**Methods:**
- `getStaleBounties()` - Fetch stale bounties from API
- `cancelStaleBounty(bountyId)` - Request cancellation
- `repostStaleBounty(bountyId)` - Request repost
- `isBountyStale(bounty)` - Helper to check stale status
- `getStaleReason(bounty)` - Get human-readable reason

## User Flow

### Detection Flow

1. **User Deletion Triggered**
   ```
   User deletes account
   → DELETE /auth/delete-account endpoint
   → User deletion process begins
   ```

2. **Stale Detection**
   ```
   staleBountyService.detectStaleBounties(userId)
   → Query in-progress bounties where hunter_id = userId
   → Mark each as is_stale = true
   → Set stale_reason = 'hunter_deleted'
   → Set stale_detected_at = NOW()
   ```

3. **Notification**
   ```
   For each stale bounty:
   → Create BOUNTY_STALE outbox event
   → Send notification to poster
   → Create in-app notification
   → Send push notification (if enabled)
   ```

### Reconciliation Flow

#### Option 1: Cancel & Refund

1. **User Action**: Poster clicks "Cancel & Refund" button
2. **Confirmation**: Alert dialog confirms intent
3. **API Call**: `POST /stale-bounties/:id/cancel`
4. **Backend Processing**:
   - Verify bounty is stale
   - Verify poster owns bounty
   - Update status to 'cancelled'
   - Clear stale flags
   - Create STALE_BOUNTY_REFUND outbox event
   - Create refund wallet transaction
   - Send notification to poster
5. **Result**: Bounty cancelled, funds refunded to poster

#### Option 2: Repost Bounty

1. **User Action**: Poster clicks "Repost Bounty" button
2. **Confirmation**: Alert dialog confirms intent
3. **API Call**: `POST /stale-bounties/:id/repost`
4. **Backend Processing**:
   - Verify bounty is stale
   - Verify poster owns bounty
   - Update status to 'open'
   - Clear hunter_id
   - Clear stale flags
   - Create BOUNTY_REPOSTED outbox event
   - Send notification to poster
5. **Result**: Bounty back in open state, available for new hunters

### UI Integration

**My Postings Screen** (`app/tabs/postings-screen.tsx`):
- Stale bounties appear with normal bounties
- Yellow warning banner displayed when expanded
- Clear action buttons for reconciliation
- Auto-refresh after action completion

**Bounty Card** (`components/my-posting-expandable.tsx`):
- Shows stale alert when expanded (owner view only)
- Integrates with existing progress tracking
- Handles success/error states with alerts

## Error Handling

### Backend Validation

```typescript
// Verify bounty is stale
if (!bounty.is_stale) {
  return { success: false, error: 'This bounty is not marked as stale' };
}

// Verify ownership
if (bounty.creator_id !== posterId) {
  return { success: false, error: 'Only the bounty poster can cancel this bounty' };
}
```

### Frontend Error Display

```typescript
if (result.success) {
  Alert.alert('Success', 'Bounty cancelled successfully...');
} else {
  Alert.alert('Error', result.error || 'Failed to cancel bounty');
}
```

## Security Considerations

1. **Authentication**: All endpoints require authentication
2. **Authorization**: Only bounty poster can take actions
3. **Validation**: Server-side validation of stale status
4. **Audit Trail**: All actions logged via outbox events
5. **Transaction Safety**: DB transactions ensure data consistency

## Testing

### Unit Tests

Located: `__tests__/unit/services/stale-bounty-service.test.ts`

Tests cover:
- Stale bounty detection
- Reason identification
- Service method signatures

### Manual Testing Checklist

- [ ] Delete hunter account → Bounties marked stale
- [ ] Poster sees stale alert in My Postings
- [ ] Cancel action processes refund
- [ ] Repost action resets bounty to open
- [ ] Notifications sent correctly
- [ ] UI updates after actions
- [ ] Error states handled gracefully

## Future Enhancements

1. **Grace Period**: Allow hunters to reactivate within 24 hours
2. **Auto-Repost**: Automatically repost after X days of no action
3. **Hunter Notifications**: Notify hunters before deletion affects bounties
4. **Batch Operations**: Cancel/repost multiple stale bounties at once
5. **Analytics**: Track stale bounty frequency and resolution rates

## Migration

To apply the schema changes:

```bash
cd services/api
npm run db:migrate
```

Or manually apply:
```bash
psql -f services/api/drizzle/0005_add_stale_bounty_tracking.sql
```

## API Reference

### GET /stale-bounties

**Auth**: Required  
**Response**:
```json
{
  "success": true,
  "bounties": [...],
  "count": 2
}
```

### POST /stale-bounties/:bountyId/cancel

**Auth**: Required  
**Response**:
```json
{
  "success": true,
  "message": "Stale bounty cancelled successfully. Refund is being processed."
}
```

### POST /stale-bounties/:bountyId/repost

**Auth**: Required  
**Response**:
```json
{
  "success": true,
  "message": "Stale bounty reposted successfully. It is now open for new hunters."
}
```

## Support

For questions or issues related to stale bounty handling:
1. Check this documentation
2. Review the code comments
3. Check the test cases
4. Contact the development team
