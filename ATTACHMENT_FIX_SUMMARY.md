# Attachment Display Fix - Implementation Summary

## Problem Statement

Attachments were successfully uploaded to Supabase storage during bounty creation but were not appearing in the bounty detail modal. Investigation revealed that while files were present in the `bounty-attachments` bucket, the `attachments_json` column in the `bounties` table was NULL.

## Root Cause

The issue was in the bounty creation flow at `app/services/bountyService.ts`. The `createBounty()` function was constructing a payload to pass to the lower-level `bountyService.create()` but was not including the `attachments` array from the draft, even though:

1. Attachments were successfully uploaded to storage in Step 2
2. Attachments were stored in `draft.attachments` 
3. The lower-level service had code to handle attachments

## Solution

**File Modified:** `app/services/bountyService.ts`

**Change:** Added `attachments` field to the payload passed to the base bounty service.

```typescript
const payload: Omit<Bounty, 'id' | 'created_at'> & { attachments?: any[] } = {
  title: draft.title,
  description: draft.description,
  amount: draft.isForHonor ? 0 : draft.amount,
  is_for_honor: draft.isForHonor,
  location: draft.workType === 'in_person' ? draft.location : '',
  work_type: draft.workType,
  timeline: draft.timeline || '',
  skills_required: draft.skills || '',
  poster_id: getCurrentUserId(),
  user_id: getCurrentUserId(),
  status: 'open',
  // Include attachments from draft so they get persisted to attachments_json
  attachments: draft.attachments || [],
};
```

## Data Flow

### Before Fix
```
Step 2: Upload → Storage ✅
       ↓
Draft.attachments ✅
       ↓
createBounty(draft) 
       ↓
Payload → {} ❌ (no attachments field)
       ↓
bountyService.create() → attachments_json = null ❌
```

### After Fix
```
Step 2: Upload → Storage ✅
       ↓
Draft.attachments ✅
       ↓
createBounty(draft) 
       ↓
Payload → { attachments: [...] } ✅
       ↓
bountyService.create() → converts to JSON
       ↓
attachments_json = "[{...}]" ✅
       ↓
BountyDetailModal → displays attachments ✅
```

## Components Involved

### 1. Upload Flow (`app/screens/CreateBounty/StepDetails.tsx`)
- Uses `useAttachmentUpload` hook
- Uploads to `bounty-attachments` bucket
- Adds uploaded attachment to draft via `onUpdate({ attachments: [...currentAttachments, attachment] })`

### 2. Draft Management (`app/hooks/useBountyDraft.ts`)
- Stores draft in AsyncStorage with attachments array
- Type: `BountyDraft` includes `attachments?: Attachment[]`

### 3. Bounty Creation (`app/services/bountyService.ts`) - **FIXED**
- Constructs payload from draft
- **Now includes:** `attachments: draft.attachments || []`

### 4. Persistence (`lib/services/bounty-service.ts`)
- Receives payload with attachments array
- Filters for uploaded attachments with `remoteUri`
- Converts to JSON: `attachments_json = JSON.stringify(filtered)`
- Inserts into database

### 5. Display (`components/bountydetailmodal.tsx`)
- Fetches bounty with `attachments_json`
- Parses JSON to array
- Renders with thumbnails and file info
- Handles clicks to open/view files

## Testing

### Manual Test Steps

1. **Navigate to Create Bounty**
2. **Step 1:** Enter title "Test Attachment Fix"
3. **Step 2:** 
   - Enter description (min 20 chars)
   - Click "Add attachments"
   - Select/capture image
   - Wait for upload completion
   - Verify attachment shows with ✓
4. **Step 3:** Set amount $50
5. **Step 4:** Select work type
6. **Step 5:** Submit bounty

### Verification Points

**✅ Supabase Storage:**
```
Bucket: bounty-attachments
Path: bounties/[timestamp]-[filename]
Status: File present
```

**✅ Supabase Database:**
```sql
SELECT attachments_json FROM bounties WHERE id = [new_bounty_id];
```
Expected: `[{"id":"att-123","name":"photo.jpg","remoteUri":"https://...","mimeType":"image/jpeg","size":123456,"status":"uploaded"}]`

**✅ Bounty Detail Modal:**
- Attachments section visible
- Image thumbnail displayed
- File name and size shown
- Clickable to open

## Edge Cases Handled

1. **Empty attachments:** `draft.attachments || []` prevents undefined
2. **Partially uploaded:** Lower-level service filters for `remoteUri` or `status === 'uploaded'`
3. **Offline mode:** Offline queue service also includes attachments in queued bounties
4. **JSON parsing:** Modal handles string, array, and object formats from Supabase JSONB

## Security

- ✅ CodeQL scan passed (0 vulnerabilities)
- ✅ No new dependencies added
- ✅ Existing RLS policies protect storage access
- ✅ Only validated uploaded attachments are persisted
- ✅ Input sanitization in upload hooks

## Impact

**User-Facing:**
- ✅ Attachments now visible in bounty listings
- ✅ Hunters can view reference images/documents
- ✅ Improved bounty clarity and context

**Technical:**
- ✅ Minimal code change (3 lines)
- ✅ No breaking changes
- ✅ Leverages existing attachment infrastructure
- ✅ Maintains backwards compatibility

## Related Files

- `app/services/bountyService.ts` - **Modified**
- `lib/services/bounty-service.ts` - Existing attachment handling
- `app/screens/CreateBounty/StepDetails.tsx` - Upload UI
- `hooks/use-attachment-upload.ts` - Upload logic
- `components/bountydetailmodal.tsx` - Display logic
- `lib/types.ts` - Attachment type definition
- `lib/services/database.types.ts` - Bounty & AttachmentMeta types

## Commit

```
commit 4352802
Fix: Include attachments in bounty creation payload

- Add attachments field to payload in bountyService.createBounty()
- Ensures uploaded files are persisted to attachments_json column
- Enables attachment display in bounty detail modal
```
