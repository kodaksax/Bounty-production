# Consolidated Profile Routes - Phase 2.2

## Overview

This document describes the consolidated profile management endpoints that have been migrated from the legacy `api/server.js` to the unified Fastify service.

**Migration Status**: ✅ Complete  
**Original Location**: `api/server.js` (lines 348-418)  
**New Location**: `services/api/src/routes/consolidated-profiles.ts`

## Architecture

### Infrastructure Used

- **Authentication**: `services/api/src/middleware/unified-auth.ts`
  - `authMiddleware`: Validates JWT and requires authentication
  - `optionalAuthMiddleware`: Allows both authenticated and unauthenticated access
  
- **Error Handling**: `services/api/src/middleware/error-handler.ts`
  - `ValidationError`: For input validation failures
  - `NotFoundError`: For missing resources
  - `AuthorizationError`: For permission violations
  - `asyncHandler`: Wrapper for async route handlers

- **Configuration**: `services/api/src/config/index.ts`
  - Supabase URL, service role key, and anon key
  
- **Validation**: Zod schemas for request body validation

## Endpoints

### 1. GET /api/profiles/:id

**Purpose**: Get public profile by ID

**Authentication**: Optional (shows more data if authenticated and viewing own profile)

**Parameters**:
- `id` (path): Profile UUID

**Response**:
```json
{
  "id": "uuid",
  "username": "string",
  "avatar_url": "string | null",
  "bio": "string | null",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "age_verified": "boolean"
}
```

**Owner-only fields** (when authenticated as profile owner):
```json
{
  "email": "string",
  "balance": "number",
  "phone": "string | null",
  "withdrawal_count": "number",
  "cancellation_count": "number",
  "age_verified_at": "timestamp | null",
  "onboarding_completed": "boolean"
}
```

**Status Codes**:
- `200`: Success
- `404`: Profile not found
- `400`: Invalid UUID format

### 2. GET /api/profile

**Purpose**: Get current authenticated user's profile

**Authentication**: Required

**Response**: Same as GET /api/profiles/:id but always includes owner-only fields

**Status Codes**:
- `200`: Success
- `401`: Not authenticated
- `404`: Profile not found

### 3. POST /api/profiles

**Purpose**: Create or update profile for authenticated user

**Authentication**: Required

**Request Body**:
```json
{
  "username": "string (required, 3-50 chars, alphanumeric + underscore)",
  "avatar_url": "string (optional, valid URL)",
  "bio": "string (optional, max 500 chars)",
  "phone": "string (optional)",
  "email": "string (optional, valid email)"
}
```

**Response**: Updated profile with owner-only fields

**Status Codes**:
- `200`: Success
- `400`: Validation error
- `401`: Not authenticated
- `409`: Username already taken

### 4. PATCH /api/profiles/:id

**Purpose**: Update specific profile fields (partial update)

**Authentication**: Required (owner only)

**Parameters**:
- `id` (path): Profile UUID (must match authenticated user's ID)

**Request Body** (all fields optional):
```json
{
  "username": "string (3-50 chars, alphanumeric + underscore)",
  "avatar_url": "string (valid URL) | null",
  "bio": "string (max 500 chars) | null",
  "phone": "string | null"
}
```

**Response**: Updated profile with owner-only fields

**Status Codes**:
- `200`: Success
- `400`: Validation error
- `401`: Not authenticated
- `403`: Cannot modify another user's profile
- `404`: Profile not found
- `409`: Username already taken

### 5. DELETE /api/profiles/:id

**Purpose**: Delete profile (owner only)

**Authentication**: Required (owner only)

**Parameters**:
- `id` (path): Profile UUID (must match authenticated user's ID)

**Response**:
```json
{
  "success": true,
  "message": "Profile deleted successfully"
}
```

**Status Codes**:
- `200`: Success
- `401`: Not authenticated
- `403`: Cannot delete another user's profile
- `404`: Profile not found

**Note**: This only deletes the profile record. For complete account deletion including auth.users, use `DELETE /auth/delete-account`.

## Security Features

### Data Sanitization

The `sanitizeProfile()` function ensures sensitive data is never exposed:

**Always Hidden**:
- `stripe_customer_id`
- `stripe_connect_account_id`

**Owner-Only Fields**:
- `email`
- `balance`
- `phone`
- `withdrawal_count`
- `cancellation_count`
- `age_verified_at`
- `onboarding_completed`

**Public Fields**:
- `id`
- `username`
- `avatar_url`
- `bio`
- `created_at`
- `updated_at`
- `age_verified`

### Ownership Validation

PATCH and DELETE operations include ownership checks:

```typescript
if (userId !== profileId) {
  throw new AuthorizationError('You can only modify your own profile');
}
```

### Input Validation

All user inputs are validated using Zod schemas:

- Username: 3-50 characters, alphanumeric + underscore only
- Avatar URL: Must be valid URL format
- Bio: Maximum 500 characters
- Email: Must be valid email format

### Username Uniqueness

Before allowing username updates, the system checks if the username is already taken by another user:

```typescript
const { data: existingProfile } = await supabase
  .from('profiles')
  .select('id, username')
  .eq('username', body.username)
  .maybeSingle();

if (existingProfile && existingProfile.id !== userId) {
  throw new ValidationError('Username already taken');
}
```

## Database Schema

The profiles table in Supabase has the following structure:

```sql
CREATE TABLE profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username text NOT NULL UNIQUE,
    email text UNIQUE,
    avatar text,
    about text,
    phone text,
    balance numeric(10,2) NOT NULL DEFAULT 0.00,
    withdrawal_count integer DEFAULT 0,
    cancellation_count integer DEFAULT 0,
    age_verified boolean DEFAULT false,
    age_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
```

**Note**: The code handles both `avatar` and `avatar_url` field names for backward compatibility.

## Testing

### Test File

Location: `services/api/src/test-consolidated-profiles.ts`

### Running Tests

```bash
cd services/api
npm run test:profiles
```

The test suite covers:
- Public profile access (with and without auth)
- Current user profile retrieval
- Profile creation/update
- Partial profile updates (PATCH)
- Profile deletion
- Ownership validation
- Input validation
- Error handling

### Manual Testing

1. Start the API server:
   ```bash
   cd services/api
   npm run dev
   ```

2. Test endpoints using curl or a REST client:

   ```bash
   # Get public profile (no auth)
   curl http://localhost:3001/api/profiles/{uuid}

   # Get current user profile (with auth)
   curl -H "Authorization: Bearer {token}" \
        http://localhost:3001/api/profile

   # Update profile
   curl -X POST \
        -H "Authorization: Bearer {token}" \
        -H "Content-Type: application/json" \
        -d '{"username":"newusername","bio":"My bio"}' \
        http://localhost:3001/api/profiles

   # Patch profile
   curl -X PATCH \
        -H "Authorization: Bearer {token}" \
        -H "Content-Type: application/json" \
        -d '{"bio":"Updated bio"}' \
        http://localhost:3001/api/profiles/{uuid}

   # Delete profile
   curl -X DELETE \
        -H "Authorization: Bearer {token}" \
        http://localhost:3001/api/profiles/{uuid}
   ```

## Migration Notes

### Differences from Legacy Implementation

1. **Authentication**: 
   - Old: Custom `authRequired` middleware
   - New: Unified `authMiddleware` and `optionalAuthMiddleware`

2. **Error Handling**:
   - Old: Generic `handleError()` function with status codes
   - New: Typed error classes (ValidationError, NotFoundError, AuthorizationError)

3. **Validation**:
   - Old: Manual validation or no validation
   - New: Zod schemas with comprehensive validation rules

4. **Database Access**:
   - Old: Direct MySQL queries with connection pooling
   - New: Supabase client with admin privileges

5. **Response Format**:
   - Old: Raw database rows
   - New: Sanitized profiles with proper field filtering

6. **Logging**:
   - Old: Console logs or basic logging
   - New: Structured logging with context (user ID, profile ID, etc.)

### Field Name Normalization

The code handles both field name conventions:
- `avatar` (database field)
- `avatar_url` (API convention)
- `about` (database field)
- `bio` (API convention)

## Logging

All endpoints include comprehensive logging:

- **Info logs**: Successful operations
- **Warn logs**: Authorization failures, ownership violations
- **Error logs**: Unexpected errors, database failures

Example log format:
```javascript
request.log.info(
  { userId, profileId, fields: Object.keys(body) },
  'Patching profile'
);
```

## Future Improvements

1. **Caching**: Add Redis caching for frequently accessed profiles
2. **Rate Limiting**: Implement profile-specific rate limits
3. **Avatar Upload**: Add direct avatar upload endpoint
4. **Profile Completeness**: Add computed field for profile completion percentage
5. **Audit Trail**: Track profile change history
6. **Profile Visibility**: Add privacy settings (public, friends-only, private)

## Related Documentation

- [Backend Consolidation Architecture](../../BACKEND_CONSOLIDATION_ARCHITECTURE.md)
- [Backend Consolidation Checklist](../../BACKEND_CONSOLIDATION_CHECKLIST.md)
- [Phase 2.1: Auth Routes Consolidation](./consolidated-auth.ts)
- [Unified Auth Middleware](../middleware/unified-auth.ts)
- [Error Handler Documentation](../middleware/error-handler.ts)
