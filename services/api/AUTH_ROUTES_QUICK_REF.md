# Authentication Routes Consolidation - Quick Reference

## What Was Done

Consolidated all authentication endpoints from 3 legacy servers into a single unified service at `services/api/src/routes/consolidated-auth.ts`.

## Quick Start

### Start the API server
```bash
cd services/api
npm run dev
```

### Test the auth endpoints
```bash
npm run test:auth
```

## Endpoints

| Method | Path | Auth Required | Rate Limited | Description |
|--------|------|---------------|--------------|-------------|
| POST | /auth/register | No | Yes (5/15min) | Register new user |
| POST | /auth/sign-in | No | Yes (5/15min) | Sign in with credentials |
| POST | /auth/sign-up | No | Yes (5/15min) | Alternative signup endpoint |
| GET | /auth/diagnostics | No | No | Check auth service health |
| GET | /auth/ping | No | No | Test Supabase connectivity |
| DELETE | /auth/delete-account | Yes | No | Delete authenticated user |

## Example Usage

### Register a new user
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "username": "myusername"
  }'
```

### Sign in
```bash
curl -X POST http://localhost:3001/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### Delete account
```bash
curl -X DELETE http://localhost:3001/auth/delete-account \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Check health
```bash
curl http://localhost:3001/auth/diagnostics
curl http://localhost:3001/auth/ping
```

## Key Features

✅ **Zod Validation** - All inputs validated with type-safe schemas  
✅ **Rate Limiting** - 5 requests per 15 minutes per IP on auth endpoints  
✅ **Comprehensive Logging** - Full audit trail with structured logging  
✅ **Error Handling** - Unified error responses with proper status codes  
✅ **Security** - No credential exposure, generic error messages  
✅ **Backwards Compatible** - Same APIs as legacy endpoints  

## Files

- **Implementation**: `services/api/src/routes/consolidated-auth.ts`
- **Tests**: `services/api/src/test-consolidated-auth.ts`
- **Documentation**: `services/api/CONSOLIDATED_AUTH_IMPLEMENTATION.md`
- **Registration**: `services/api/src/index.ts` (line ~144)

## Migration From Legacy

### Legacy endpoints replaced:
- ❌ `api/server.js`: `/app/auth/sign-up-form`, `/auth/register`, `/auth/sign-in`, `/auth/diagnostics`, `/auth/ping`
- ❌ `server/index.js`: `/auth/delete-account`

### New unified endpoint:
- ✅ `services/api/src/routes/consolidated-auth.ts`: All auth endpoints

## Configuration

Uses unified config from `services/api/src/config/index.ts`:

```typescript
config.supabase.url              // Supabase project URL
config.supabase.anonKey          // For client sign-in
config.supabase.serviceRoleKey   // For admin operations
config.rateLimit.auth.windowMs   // Rate limit window (900000ms = 15min)
config.rateLimit.auth.max        // Max requests per window (5)
```

## Environment Variables Required

```bash
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Error Responses

All endpoints return standardized error format:

```json
{
  "error": "Error Type",
  "message": "Human-readable message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "details": {}
}
```

Common error codes:
- `VALIDATION_ERROR` (400) - Invalid input
- `AUTHENTICATION_REQUIRED` (401) - Missing or invalid auth
- `RATE_LIMIT_EXCEEDED` (429) - Too many requests
- `EXTERNAL_SERVICE_ERROR` (502) - Supabase error

## Rate Limiting

When rate limit is exceeded:

```json
{
  "error": "Too Many Requests",
  "message": "Too many authentication attempts. Please try again in 900 seconds.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 900,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Response headers:
- `X-RateLimit-Limit`: 5
- `X-RateLimit-Remaining`: 0
- `X-RateLimit-Reset`: timestamp
- `Retry-After`: seconds

## Testing Checklist

- [x] POST /auth/register with valid data
- [x] POST /auth/register with invalid email
- [x] POST /auth/register with short password
- [x] POST /auth/sign-in with valid credentials
- [x] POST /auth/sign-in with invalid credentials
- [x] POST /auth/sign-up (same as register)
- [x] GET /auth/diagnostics
- [x] GET /auth/ping
- [x] DELETE /auth/delete-account with auth
- [x] DELETE /auth/delete-account without auth
- [x] Rate limiting (6th request gets 429)
- [x] Retry-After header on rate limit

## Next Steps

1. ✅ Implementation complete (Phase 2.1)
2. ⏳ Update client apps to use new endpoints
3. ⏳ Monitor both old and new in production
4. ⏳ Deprecate legacy endpoints
5. ⏳ Remove legacy code after migration

## Support

For questions or issues:
1. Check `CONSOLIDATED_AUTH_IMPLEMENTATION.md` for detailed docs
2. Review test cases in `test-consolidated-auth.ts`
3. Check logs with `request.log` context
4. Verify Supabase configuration with `/auth/diagnostics`

---

**Phase**: 2.1 of 8-phase backend consolidation  
**Status**: ✅ Complete  
**Date**: 2024-01-01
