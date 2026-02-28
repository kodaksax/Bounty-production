# Attachment Fix - Visual Data Flow

## Before Fix ❌

```
┌─────────────────────────────────────────────────────────────┐
│                    CREATE BOUNTY FLOW                       │
└─────────────────────────────────────────────────────────────┘

Step 1: Title & Category
   └─> draft.title = "Test Bounty"

Step 2: Details & Attachments
   │
   ├─> User clicks "Add attachments"
   │   └─> useAttachmentUpload hook
   │       ├─> Picks/captures image
   │       ├─> Uploads to Supabase Storage ✅
   │       │   Location: bounty-attachments/bounties/[timestamp]-[filename]
   │       └─> Returns attachment object
   │
   └─> onUpdate({ attachments: [..., newAttachment] })
       └─> draft.attachments = [{ id, name, uri, remoteUri, ... }] ✅

Step 3-4: Compensation, Location
   └─> draft.amount, draft.workType, etc.

Step 5: Review & Submit
   │
   └─> bountyService.createBounty(draft)
       │
       ├─> app/services/bountyService.ts
       │   const payload = {
       │     title: draft.title,
       │     description: draft.description,
       │     amount: draft.amount,
       │     ...
       │     // ❌ MISSING: attachments field!
       │   }
       │
       └─> baseBountyService.create(payload)
           │
           └─> lib/services/bounty-service.ts
               ├─> Looks for payload.attachments
               │   └─> Not found! ❌
               │
               └─> INSERT INTO bounties
                   └─> attachments_json = NULL ❌

┌─────────────────────────────────────────────────────────────┐
│                    BOUNTY DETAIL MODAL                      │
└─────────────────────────────────────────────────────────────┘

BountyDetailModal opens
   │
   └─> Fetches bounty from database
       ├─> bounty.attachments_json = NULL ❌
       │
       └─> Effect B: Parse attachments
           ├─> raw = NULL
           └─> actualAttachments = [] ❌
               │
               └─> UI shows: No attachments section ❌

Result: File in storage ✅ but not visible in UI ❌
```

## After Fix ✅

```
┌─────────────────────────────────────────────────────────────┐
│                    CREATE BOUNTY FLOW                       │
└─────────────────────────────────────────────────────────────┘

Step 1: Title & Category
   └─> draft.title = "Test Bounty"

Step 2: Details & Attachments
   │
   ├─> User clicks "Add attachments"
   │   └─> useAttachmentUpload hook
   │       ├─> Picks/captures image
   │       ├─> Uploads to Supabase Storage ✅
   │       │   Location: bounty-attachments/bounties/[timestamp]-[filename]
   │       └─> Returns attachment object
   │
   └─> onUpdate({ attachments: [..., newAttachment] })
       └─> draft.attachments = [{ id, name, uri, remoteUri, ... }] ✅

Step 3-4: Compensation, Location
   └─> draft.amount, draft.workType, etc.

Step 5: Review & Submit
   │
   └─> bountyService.createBounty(draft)
       │
       ├─> app/services/bountyService.ts  ⭐ FIXED ⭐
       │   const payload = {
       │     title: draft.title,
       │     description: draft.description,
       │     amount: draft.amount,
       │     ...
       │     attachments: draft.attachments || [], ✅ NEW!
       │   }
       │
       └─> baseBountyService.create(payload)
           │
           └─> lib/services/bounty-service.ts
               ├─> payload.attachments exists! ✅
               │   └─> Filter for uploaded with remoteUri
               │       └─> [{ id, name, remoteUri, ... }]
               │
               ├─> Convert to JSON
               │   └─> attachments_json = JSON.stringify(filtered) ✅
               │
               └─> INSERT INTO bounties
                   └─> attachments_json = '[{...}]' ✅

┌─────────────────────────────────────────────────────────────┐
│                    BOUNTY DETAIL MODAL                      │
└─────────────────────────────────────────────────────────────┘

BountyDetailModal opens
   │
   └─> Fetches bounty from database
       ├─> bounty.attachments_json = '[{...}]' ✅
       │
       └─> Effect B: Parse attachments
           ├─> raw = '[{...}]'
           ├─> Parse JSON
           └─> actualAttachments = [{ id, name, remoteUri, ... }] ✅
               │
               └─> UI renders:
                   ┌─────────────────────────────────┐
                   │ Attachments                     │
                   ├─────────────────────────────────┤
                   │ 📷 [Thumbnail]  photo.jpg       │
                   │                  1.2 MB      →  │
                   └─────────────────────────────────┘
                   ✅ Section visible!
                   ✅ Thumbnail displayed!
                   ✅ Clickable to open!

Result: File in storage ✅ and visible in UI ✅
```

## Key Components

### Upload Hook
```typescript
// hooks/use-attachment-upload.ts
useAttachmentUpload({
  bucket: 'bounty-attachments',
  folder: 'bounties',
  onUploaded: (attachment) => {
    // Returns: { id, name, uri, remoteUri, mimeType, size, status: 'uploaded' }
  }
})
```

### Draft State
```typescript
// app/hooks/useBountyDraft.ts
interface BountyDraft {
  title: string
  description: string
  attachments?: Attachment[]  // ← Stored here
  // ...
}
```

### Create Service (FIXED)
```typescript
// app/services/bountyService.ts
const payload = {
  title: draft.title,
  description: draft.description,
  // ... other fields
  attachments: draft.attachments || [], // ⭐ NEW!
}
```

### Base Service
```typescript
// lib/services/bounty-service.ts
// Already had this logic - just needed data!
const toInclude = attachments.filter(a => a.remoteUri || a.status === 'uploaded')
if (toInclude.length > 0) {
  normalized.attachments_json = JSON.stringify(toInclude)
}
```

### Display Modal
```typescript
// components/bountydetailmodal.tsx
// Parse attachments_json
const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
setActualAttachments(parsed)

// Render
{actualAttachments.map(attachment => (
  <TouchableOpacity onPress={() => open(attachment)}>
    <Image source={{ uri: attachment.remoteUri }} />
    <Text>{attachment.name}</Text>
  </TouchableOpacity>
))}
```

## The Fix in One Line

```diff
  const payload = {
    // ... existing fields
+   attachments: draft.attachments || [],  // ⭐ This one line!
  }
```

This simple addition bridges the gap between:
- Upload (working ✅) 
- Display (working ✅)

By ensuring the data flows through the middle layer (create service).
