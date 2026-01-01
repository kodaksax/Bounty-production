# Consolidated Bounty Routes - Phase 2.3

## Overview

This document describes the consolidation of bounty management endpoints from the legacy `api/server.js` into the unified Fastify service at `services/api/src/routes/consolidated-bounties.ts`.

## Migration Summary

**Source:** `api/server.js` (lines 423-933)  
**Destination:** `services/api/src/routes/consolidated-bounties.ts`  
**Status:** ✅ Complete

## API Endpoints

### 1. GET /api/bounties
List bounties with optional filters and pagination.

**Authentication:** Optional (public endpoint, enhanced with auth)

**Query Parameters:**
- `status` - Filter by status: `open`, `in_progress`, `completed`, `archived`, `all` (default: `open`)
- `category` - Filter by category string
- `user_id` - Filter by poster UUID
- `accepted_by` - Filter by hunter UUID
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20, max: 100)
- `sortBy` - Sort field: `created_at`, `amount`, `due_date` (default: `created_at`)
- `sortOrder` - Sort order: `asc`, `desc` (default: `desc`)

**Response:**
```json
{
  "bounties": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### 2. GET /api/bounties/:id
Get bounty details by ID.

**Authentication:** Optional

**Parameters:**
- `id` - Bounty UUID (required)

**Response:** Bounty object

### 3. POST /api/bounties
Create a new bounty.

**Authentication:** Required

**Body:**
```json
{
  "title": "string (10-200 chars)",
  "description": "string (50-5000 chars)",
  "amount": "number (>= 0)",
  "isForHonor": "boolean (optional, default: false)",
  "location": "string (optional)",
  "category": "string (optional)",
  "skills_required": "string[] (optional)",
  "due_date": "ISO 8601 datetime (optional)"
}
```

**Business Rules:**
- If `isForHonor=true`, `amount` must be 0
- If `isForHonor=false`, `amount` can be >= 0 (zero is allowed for future flexibility, e.g., when budget is not yet specified)
- Initial status is always `open`
- `user_id` is set to authenticated user

**Response:** Created bounty object (201)

### 4. PATCH /api/bounties/:id
Update bounty fields (partial update).

**Authentication:** Required (owner only)

**Parameters:**
- `id` - Bounty UUID (required)

**Body:** Partial bounty object (same fields as create, all optional)

**Business Rules:**
- Only bounty owner can update
- Cannot update if status is `completed` or `archived`
- Cannot change `user_id` or `created_at`
- Honor bounty validation still applies

**Response:** Updated bounty object (200)

### 5. DELETE /api/bounties/:id
Delete a bounty permanently.

**Authentication:** Required (owner only)

**Parameters:**
- `id` - Bounty UUID (required)

**Business Rules:**
- Only bounty owner can delete
- Permanently removes bounty from database

**Response:**
```json
{
  "success": true,
  "message": "Bounty deleted successfully"
}
```

### 6. POST /api/bounties/:id/accept
Accept a bounty (hunter applies).

**Authentication:** Required

**Parameters:**
- `id` - Bounty UUID (required)

**Business Rules:**
- Bounty must have `open` status
- Cannot accept own bounty (`user_id` cannot equal requester)
- Sets status to `in_progress`
- Sets `accepted_by` to requester user ID
- Cannot accept if already accepted

**Response:** Updated bounty object (200)

### 7. POST /api/bounties/:id/complete
Mark bounty as complete (hunter submits).

**Authentication:** Required (hunter only)

**Parameters:**
- `id` - Bounty UUID (required)

**Business Rules:**
- Bounty must have `in_progress` status
- Only assigned hunter (`accepted_by`) can mark complete
- Sets status to `completed`
- **TODO (Phase 3):** Trigger wallet escrow release

**Response:** Updated bounty object (200)

### 8. POST /api/bounties/:id/archive
Archive a bounty.

**Authentication:** Required (owner only)

**Parameters:**
- `id` - Bounty UUID (required)

**Business Rules:**
- Only bounty owner can archive
- Can archive any status except `completed`
- Sets status to `archived`

**Response:** Updated bounty object (200)

## Data Model

### Bounty Schema (Supabase)
```typescript
interface Bounty {
  id: string;                    // UUID
  user_id: string;               // Poster UUID
  title: string;                 // 10-200 chars
  description: string;           // 50-5000 chars
  amount: number;                // USD amount
  isForHonor?: boolean;          // Honor bounty flag
  location?: string;             // Optional location
  category?: string;             // Optional category
  skills_required?: string[];    // Optional skill tags
  status: 'open' | 'in_progress' | 'completed' | 'archived';
  accepted_by?: string | null;   // Hunter UUID
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
  due_date?: string | null;      // ISO timestamp
}
```

## Status Transitions

Valid state transitions:
```
open → in_progress (via accept)
open → archived (via archive)
in_progress → completed (via complete)
in_progress → archived (via archive)
completed → [terminal state]
archived → [terminal state]
```

## Validation

### Zod Schemas

**createBountySchema:**
- `title`: 10-200 characters (required)
- `description`: 50-5000 characters (required)
- `amount`: >= 0 (required)
- `isForHonor`: boolean (optional, default: false)
- Additional fields: optional
- Custom refinement: Honor bounties must have amount=0

**updateBountySchema:**
- All fields from createBountySchema, made optional via `.partial()`

**listBountiesSchema:**
- All query parameters with type validation
- Pagination limits enforced

## Error Handling

Uses unified error classes from `middleware/error-handler.ts`:

- **ValidationError (400):** Invalid input, business rule violations
- **AuthenticationError (401):** Missing or invalid token (handled by middleware)
- **AuthorizationError (403):** Not owner, not hunter, permission denied
- **NotFoundError (404):** Bounty not found
- **ConflictError (409):** Invalid status transition, already accepted, etc.

## Security

### Authorization Checks

1. **Owner-only actions:** Update, Delete, Archive
   - Verified by comparing `bounty.user_id` with `request.userId`

2. **Hunter-only actions:** Complete
   - Verified by comparing `bounty.accepted_by` with `request.userId`

3. **Self-action restrictions:** Accept
   - Cannot accept own bounty (poster cannot be hunter)

### Input Validation

- All inputs validated with Zod schemas
- UUID format validation on parameters
- Business rule validation (honor bounties, status transitions)
- SQL injection protected (Supabase client handles parameterization)

## Testing

**Test Suite:** `services/api/src/test-consolidated-bounties.ts`

**Run:** `npm run test:bounties`

**Coverage:**
- ✅ Create bounty (valid, honor, validation errors)
- ✅ List bounties (with/without auth, filters, pagination, sorting)
- ✅ Get bounty (valid, not found, invalid UUID)
- ✅ Update bounty (owner, non-owner, completed bounty)
- ✅ Accept bounty (valid, own bounty, already accepted)
- ✅ Complete bounty (hunter, non-hunter, already completed)
- ✅ Archive bounty (owner, non-owner, completed bounty)
- ✅ Delete bounty (owner, non-owner, not found)

**Total Test Scenarios:** 40+

## Integration Points

### Current
- **Authentication:** `middleware/unified-auth.ts`
- **Error Handling:** `middleware/error-handler.ts`
- **Configuration:** `config/index.ts`
- **Database:** Supabase via `@supabase/supabase-js`

### Future (Phase 3)
- **Wallet Integration:** Escrow on create (if amount > 0)
- **Payment Release:** Automatic release on complete
- **Notifications:** Notify users on status changes
- **Analytics:** Track bounty metrics

## Known Differences from Legacy

### Improvements
1. **Unified validation:** Zod schemas replace manual validation
2. **Better errors:** Structured error responses with codes
3. **Consistent auth:** Uses unified auth middleware
4. **Type safety:** Full TypeScript with interfaces
5. **Better logging:** Structured logging with context

### Changes
1. **Field naming:** Public API uses camelCase (`isForHonor`) while the underlying Supabase schema may use snake_case conventions (e.g., `is_for_honor`). The Supabase client handles the mapping automatically, so API consumers should always use camelCase and do not need to be aware of the database column naming conventions.
2. **Default status filter:** Lists only `open` bounties by default (was all bounties). Use `status=all` to fetch bounties regardless of status.
3. **Stricter validation:** More comprehensive input validation
4. **No MySQL:** Uses Supabase/PostgreSQL only (MySQL logic removed)

### Removed Features
1. **Distance calculation:** Mock distance removed (was placeholder)
2. **Legacy user_id mapping:** Simplified to `user_id` only
3. **Username auto-generation:** Relies on profile service
4. **Supabase relay endpoint:** Not needed in consolidated service

## Deployment Notes

### Prerequisites
- Supabase configured with bounties table
- Service role key available in environment
- Auth routes registered and functional

### Environment Variables
```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Registration
Routes are registered in `services/api/src/index.ts`:
```typescript
await registerConsolidatedBountyRoutes(fastify);
```

### Monitoring
- Check logs for route registration: "Consolidated bounty routes registered"
- Monitor error rates on bounty endpoints
- Track common validation errors

## Future Enhancements

### Phase 3 - Payment Integration
- [ ] Create escrow on bounty creation (if amount > 0)
- [ ] Release funds on completion
- [ ] Handle refunds on cancellation

### Phase 4 - Advanced Features
- [ ] Location-based search with proximity
- [ ] Skill matching algorithm
- [ ] Rating system integration
- [ ] Notification triggers

### Phase 5 - Analytics
- [ ] Track bounty metrics (creation, acceptance, completion rates)
- [ ] User behavior analytics
- [ ] Popular categories and skills

## Troubleshooting

### Common Issues

**Issue:** 401 Unauthorized  
**Solution:** Ensure Authorization header is present and valid JWT token

**Issue:** 403 Forbidden on update/delete  
**Solution:** Verify user is the bounty owner

**Issue:** 409 Conflict on accept  
**Solution:** Check bounty status and ensure not already accepted

**Issue:** 400 Validation Error on create  
**Solution:** Check honor bounty rules (isForHonor=true requires amount=0)

### Debug Tips
1. Enable debug logging: `LOG_LEVEL=debug`
2. Check Supabase dashboard for data issues
3. Verify RLS policies allow service role access
4. Test with curl or Postman before client integration

## References

- **Problem Statement:** Phase 2.3 requirements document
- **Legacy Code:** `api/server.js` lines 423-933
- **Auth Routes:** `services/api/src/routes/consolidated-auth.ts`
- **Profile Routes:** `services/api/src/routes/consolidated-profiles.ts`
- **Middleware:** `services/api/src/middleware/`
- **Config:** `services/api/src/config/index.ts`
