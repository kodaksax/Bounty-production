# Security Documentation - BOUNTYExpo

This document outlines the security measures implemented in the BOUNTYExpo application.

## Table of Contents
1. [Authentication](#authentication)
2. [Session Management](#session-management)
3. [Admin Access Control](#admin-access-control)
4. [Input Validation](#input-validation)
5. [Password Security](#password-security)
6. [Rate Limiting](#rate-limiting)
7. [Best Practices](#best-practices)
8. [Security Checklist](#security-checklist)

## Authentication

### Overview
BOUNTYExpo uses Supabase for authentication, which provides:
- JWT-based authentication
- Secure token storage using Expo SecureStore
- Automatic token refresh
- Session persistence

### Implementation Details

#### Sign-Up (`app/auth/sign-up-form.tsx`)
- **Email validation**: RFC-compliant email regex
- **Password validation**: Enforces strong password requirements
- **Error handling**: Specific error messages for different failure scenarios
- **Email normalization**: All emails are converted to lowercase
- **Real-time validation**: Field errors clear on user input

#### Sign-In (`app/auth/sign-in-form.tsx`)
- **Email validation**: Required and format-checked
- **Password validation**: Required field
- **Rate limiting**: Client-side lockout after 5 failed attempts (5-minute cooldown)
- **Error handling**: Distinguishes between invalid credentials, unconfirmed email, etc.
- **Session management**: Automatic redirect on successful authentication

#### Password Reset (`app/auth/reset-password.tsx`)
- **Email validation**: Verified before submission
- **Rate limit handling**: User-friendly messages for rate-limited requests
- **Security notice**: Uses generic success message to prevent user enumeration

### Token Management
```typescript
// Tokens are stored in Expo SecureStore (encrypted storage)
// lib/supabase.ts
const ExpoSecureStoreAdapter: StorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
```

## Session Management

### Session Persistence
- Sessions are stored securely using Expo SecureStore
- Automatic token refresh enabled via Supabase client
- Session expiration handling with user-friendly error messages

### Session Security Features
1. **Secure Storage**: All tokens stored in encrypted SecureStore
2. **Auto Refresh**: Tokens automatically refreshed before expiration
3. **State Synchronization**: `onAuthStateChange` listener keeps app state in sync
4. **Session Fixation Prevention**: New tokens generated on sign-in (handled by Supabase)

### Session Monitoring
```typescript
// Admin context monitors auth state changes
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      if (event === 'SIGNED_OUT') {
        await setIsAdmin(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await verifyAdminStatus();
      }
    }
  );
  return () => subscription.unsubscribe();
}, []);
```

## Admin Access Control

### Client-Side Protection (`lib/admin-context.tsx`)

#### Verification Strategy
- **Initial check**: Loads cached admin status from AsyncStorage
- **Background verification**: Verifies admin status with backend
- **Cache expiry**: Admin status re-verified every 5 minutes
- **Auth state listener**: Re-verifies on sign-in/sign-out events

#### Implementation
```typescript
// Admin verification checks user metadata
const isAdminUser = 
  session.user?.user_metadata?.role === 'admin' || 
  session.user?.app_metadata?.role === 'admin';
```

### Backend Protection (`services/api/src/middleware/auth.ts`)

#### Auth Middleware
- Verifies JWT tokens with Supabase
- Adds user information to request object
- Sets `isAdmin` flag based on user metadata
- Provides specific error messages for different failure scenarios

#### Admin Middleware
```typescript
// Requires both authentication and admin role
export async function adminMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  await authMiddleware(request, reply);
  if (reply.sent) return;
  
  if (!request.isAdmin) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'This resource requires administrator privileges'
    });
  }
}
```

### Route Protection (`app/(admin)/_layout.tsx`)
```typescript
// Admin routes require authentication
if (!isAdmin) {
  return <Redirect href="/tabs/bounty-app" />;
}
```

## Input Validation

### Form-Level Validation
All authentication forms implement comprehensive validation:

1. **Email Validation**
   - Required field check
   - RFC-compliant email regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
   - Real-time error clearing

2. **Password Validation**
   - Required field check
   - Minimum length enforcement
   - Strong password requirements (sign-up only)

3. **Field-Level Errors**
   - Visual feedback (red border on error)
   - Clear error messages
   - Real-time error clearing on input

### Validation Utilities (`lib/utils/auth-validation.ts`)
Provides reusable validation functions:
- `validateEmail(email: string)`
- `validatePassword(password: string)`
- `validateUsername(username: string)`
- `validatePasswordMatch(password: string, confirmPassword: string)`

## Password Security

### Strong Password Requirements
Enforced in sign-up and password change flows:

```typescript
// Pattern from hooks/use-form-validation.ts
strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
```

**Requirements:**
- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (@$!%*?&)

### Password Visibility Toggle
All password fields include show/hide toggle:
```typescript
<TouchableOpacity
  onPress={() => setShowPassword(s => !s)}
  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
>
  <MaterialIcons 
    name={showPassword ? 'visibility-off' : 'visibility'} 
    size={20} 
  />
</TouchableOpacity>
```

### Password Change Security (`components/settings/privacy-security-screen.tsx`)
- Requires current password (for user verification)
- Enforces strong password requirements
- Validates password match
- Uses Supabase `updateUser` API for secure password updates

## Rate Limiting

### Client-Side Rate Limiting (Sign-In)
Prevents brute force attacks:
```typescript
// After 5 failed attempts
if (newAttempts >= 5) {
  const lockout = Date.now() + (5 * 60 * 1000); // 5 minutes
  setLockoutUntil(lockout);
  setAuthError('Too many failed attempts. Please try again in 5 minutes.');
  return;
}
```

### Backend Rate Limiting (`services/api/src/middleware/auth.ts`)
In-memory rate limiting per token:
- **Limit**: 60 requests per minute per token
- **Window**: 1 minute rolling window
- **Response**: 429 Too Many Requests with retry message

```typescript
// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute
```

### Recommendations for Production
For production environments, implement:
1. **Distributed rate limiting** using Redis
2. **IP-based rate limiting** at the API gateway level
3. **CAPTCHA** after multiple failed login attempts
4. **Account lockout** after repeated violations

## Best Practices

### Implemented Security Measures

1. **Defense in Depth**
   - Multiple layers of validation (client + server)
   - Admin verification at both frontend and backend
   - Rate limiting at multiple levels

2. **Principle of Least Privilege**
   - Users only get necessary permissions
   - Admin routes require explicit admin role
   - Token-based access control

3. **Secure Defaults**
   - Sessions use secure storage by default
   - Auto-refresh enabled
   - HTTPS enforced (via Supabase)

4. **Error Handling**
   - No sensitive information in error messages
   - Generic messages for user enumeration prevention
   - Detailed logging for debugging (server-side only)

5. **Input Sanitization**
   - Email normalization (lowercase)
   - Whitespace trimming
   - Strong validation patterns

### Security Headers (Backend)
Backend should implement these headers (typically at reverse proxy level):
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'

Note: X-XSS-Protection header is deprecated and should not be used in modern applications. Use Content-Security-Policy instead.
```

### CSRF Protection
- Token-based authentication provides natural CSRF protection
- No cookies used for authentication (JWT in Authorization header)
- State-changing operations require valid JWT

### XSS Prevention
- React Native automatically escapes content
- No `dangerouslySetInnerHTML` usage
- User input sanitized before display

## Security Checklist

### Authentication
- [x] Strong password requirements enforced
- [x] Email validation implemented
- [x] Password visibility toggles added
- [x] Rate limiting on login attempts
- [x] Session tokens stored securely
- [x] Automatic token refresh enabled
- [x] Password reset functionality secured

### Authorization
- [x] Admin routes protected (client-side)
- [x] Admin middleware created (backend)
- [x] Role verification implemented
- [x] Admin status cached with expiry
- [x] Auth state change monitoring

### Input Validation
- [x] Email validation with proper regex
- [x] Password strength validation
- [x] Real-time field validation
- [x] Field-level error messages
- [x] Input sanitization (normalization)

### Session Management
- [x] Secure token storage (SecureStore)
- [x] Session expiration handling
- [x] Auto-refresh configured
- [x] Session fixation protection (via Supabase)
- [x] State synchronization

### Error Handling
- [x] Generic error messages for sensitive operations
- [x] Specific errors for user feedback
- [x] No sensitive data in error responses
- [x] Server-side error logging

### Backend Security
- [x] JWT verification middleware
- [x] Rate limiting implemented
- [x] Admin-only middleware created
- [x] Error handling standardized
- [x] Token expiration checked

### Pending/Recommended Enhancements
- [ ] Implement Redis-based rate limiting for production
- [ ] Add 2FA/MFA support
- [ ] Implement IP-based rate limiting
- [ ] Add CAPTCHA for repeated failures
- [ ] Set up security monitoring/alerting
- [ ] Implement audit logging for admin actions
- [ ] Add backend admin API endpoints
- [ ] Implement role-based access control (RBAC) database schema
- [ ] Add account lockout policies
- [ ] Implement email verification enforcement
- [ ] Add device fingerprinting
- [ ] Set up session invalidation on password change

## Reporting Security Issues

If you discover a security vulnerability, please email security@bountyexpo.com with:
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

Please do not create public GitHub issues for security vulnerabilities.

## Security Updates

This document will be updated as new security features are implemented. Last updated: 2024

---

**Note**: This application uses Supabase for authentication, which provides enterprise-grade security. Many security features are handled by Supabase, including:
- Password hashing (bcrypt)
- Token signing and verification (JWT)
- Rate limiting (Supabase API level)
- DDoS protection
- Database security

Always keep Supabase client libraries up to date to benefit from security patches.
