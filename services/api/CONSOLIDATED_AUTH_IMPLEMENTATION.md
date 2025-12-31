# Consolidated Authentication Routes Implementation

## Overview
This document describes the implementation of consolidated authentication routes as part of Phase 2.1 of the backend consolidation project.

## Files Created
- `services/api/src/routes/consolidated-auth.ts` - Main route implementation
- `services/api/src/test-consolidated-auth.ts` - Test script for manual testing

## Files Modified
- `services/api/src/index.ts` - Added import and registration of consolidated auth routes

## Endpoints Implemented

### 1. POST /auth/register
**Purpose**: Register a new user with email and password

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "password123", // Min 8 characters
  "username": "myusername"   // Optional, generated from email if not provided
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "userId": "uuid",
  "email": "user@example.com",
  "username": "myusername",
  "message": "Account created successfully"
}
```

**Features**:
- Zod validation for email format and password length
- Auto-generates username from email if not provided
- Creates user in Supabase Auth with auto-confirmed email
- Rate limited (5 requests per 15 minutes per IP)
- Comprehensive error handling and logging

### 2. POST /auth/sign-in
**Purpose**: Sign in with email and password

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "session": {
    "access_token": "jwt_token",
    "refresh_token": "refresh_token",
    "expires_in": 3600
  }
}
```

**Features**:
- Uses Supabase signInWithPassword for authentication
- Returns session tokens for subsequent authenticated requests
- Rate limited (5 requests per 15 minutes per IP)
- Generic error message to avoid revealing whether email exists

### 3. POST /auth/sign-up
**Purpose**: Alternative sign-up endpoint (same functionality as /auth/register)

**Request/Response**: Same as /auth/register

**Features**:
- Provided for backwards compatibility with legacy endpoints
- Identical implementation to /auth/register
- Rate limited (5 requests per 15 minutes per IP)

### 4. GET /auth/diagnostics
**Purpose**: Health check for authentication service configuration

**Response** (200 OK):
```json
{
  "status": "ok",
  "supabaseConfigured": true,
  "urlPresent": true,
  "serviceKeyPresent": true,
  "anonKeyPresent": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Features**:
- Returns configuration status without exposing sensitive values
- No authentication required
- Useful for monitoring and debugging

### 5. GET /auth/ping
**Purpose**: Test Supabase connectivity and service availability

**Response** (200 OK):
```json
{
  "ok": true,
  "message": "Supabase connection successful",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Features**:
- Makes actual call to Supabase (listUsers with limit 1)
- Verifies service role key is valid
- No authentication required
- Returns 500 if connection fails

### 6. DELETE /auth/delete-account
**Purpose**: Delete the authenticated user's account

**Headers**:
```
Authorization: Bearer <access_token>
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

**Features**:
- Requires authentication (Bearer token)
- Cleans up dependent data (conversations, etc.)
- Attempts admin deletion first, falls back to manual profile deletion
- Comprehensive error handling with fallback strategies
- Full audit logging

## Rate Limiting

All authentication endpoints are protected by a custom rate limiting middleware:

- **Limit**: 5 requests per 15 minutes per IP address
- **Window**: 900,000 ms (15 minutes)
- **Headers Added**:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining in window
  - `X-RateLimit-Reset`: Timestamp when limit resets
  - `Retry-After`: Seconds until next request allowed (only on 429)

**Response** (429 Too Many Requests):
```json
{
  "error": "Too Many Requests",
  "message": "Too many authentication attempts. Please try again in 900 seconds.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 900,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Error Handling

All endpoints use the unified error handling system:

- **ValidationError** (400): Invalid input data
- **AuthenticationError** (401): Invalid credentials or missing auth
- **ExternalServiceError** (502): Supabase API errors
- **Rate limit errors** (429): Too many requests

Standard error response format:
```json
{
  "error": "Error Type",
  "message": "Human-readable message",
  "code": "ERROR_CODE",
  "details": {},
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Logging

All endpoints include comprehensive logging:

- **Info logs**: Successful operations, user actions
- **Warn logs**: Expected errors (invalid credentials, rate limits)
- **Error logs**: Unexpected errors, service failures

Log context includes:
- Request ID
- User ID (when authenticated)
- Email (for registration/sign-in attempts)
- Error details
- Timestamps

## Configuration

Uses unified configuration from `services/api/src/config/index.ts`:

- `config.supabase.url`: Supabase project URL
- `config.supabase.anonKey`: Supabase anon key (for sign-in)
- `config.supabase.serviceRoleKey`: Supabase service role key (for admin operations)
- `config.rateLimit.auth.windowMs`: Rate limit window (default 900000 ms)
- `config.rateLimit.auth.max`: Max requests per window (default 5)

## Testing

### Manual Testing

To test the endpoints, start the API server:

```bash
cd services/api
npm run dev
```

Then run the test script:

```bash
npm run test-auth  # Or: tsx src/test-consolidated-auth.ts
```

The test script will:
1. Test diagnostics endpoint
2. Test ping endpoint
3. Test registration with various inputs
4. Test sign-in with valid/invalid credentials
5. Test sign-up endpoint
6. Test rate limiting (6 consecutive requests)
7. Test account deletion with authentication

### Test Coverage

Tests verify:
- ✅ Successful user registration
- ✅ Validation errors (missing fields, invalid formats)
- ✅ Successful sign-in with valid credentials
- ✅ Failed sign-in with invalid credentials
- ✅ Session token generation
- ✅ Rate limiting after 5 requests
- ✅ Retry-After header on rate limit
- ✅ Account deletion with authentication
- ✅ Account deletion rejects unauthenticated requests
- ✅ Diagnostics returns configuration status
- ✅ Ping verifies Supabase connectivity

## Migration Notes

### Legacy Endpoints Replaced

This implementation consolidates and replaces the following legacy endpoints:

**From `api/server.js`**:
- `POST /app/auth/sign-up-form` (lines 202-282)
- `POST /auth/register` (lines 1184-1244)
- `GET /auth/diagnostics` (lines 1260-1267)
- `GET /auth/ping` (lines 1270-1279)
- `POST /auth/sign-in` (lines 1282-1323)

**From `server/index.js`**:
- `DELETE /auth/delete-account` (lines 152-202)

### Backwards Compatibility

The new endpoints maintain backwards compatibility:
- Same URL paths as legacy endpoints
- Same request/response formats
- Enhanced error handling and validation
- Added rate limiting for security

### Migration Path

1. ✅ Phase 2.1: Implement consolidated auth routes (COMPLETED)
2. [ ] Phase 2.2: Update client applications to use new endpoints
3. [ ] Phase 2.3: Monitor both old and new endpoints in production
4. [ ] Phase 2.4: Deprecate legacy endpoints
5. [ ] Phase 2.5: Remove legacy auth code from old servers

## Security Improvements

Compared to legacy endpoints:

1. **Rate Limiting**: Prevents brute force attacks (5 req/15 min)
2. **Consistent Error Messages**: Doesn't reveal if email exists
3. **Comprehensive Logging**: Full audit trail of auth operations
4. **Input Validation**: Strict Zod schemas for all inputs
5. **Error Sanitization**: Doesn't expose internal error details
6. **Service Isolation**: Uses unified auth middleware pattern

## Performance Considerations

- **Rate Limit Store**: In-memory Map (consider Redis for production multi-instance)
- **Auto Cleanup**: Expired rate limit entries cleaned every 5 minutes
- **Connection Pooling**: Reuses Supabase client instances
- **Async Operations**: All I/O operations are async for non-blocking

## Future Enhancements

Potential improvements for future phases:

1. Add email verification flow
2. Add password reset functionality
3. Add 2FA/MFA support
4. Move rate limit store to Redis for distributed systems
5. Add username uniqueness validation
6. Add profile creation in database after Supabase registration
7. Add OAuth/social login endpoints
8. Add session refresh endpoint
9. Add logout endpoint (session revocation)
10. Add account recovery flow

## Dependencies

No new dependencies added. Uses existing:
- `fastify`: Web framework
- `zod`: Schema validation
- `@supabase/supabase-js`: Supabase client
- Unified middleware: `unified-auth`, `error-handler`
- Unified config: `config/index`
