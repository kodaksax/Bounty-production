# Authentication Testing Guide

This guide provides instructions for manually testing the security enhancements made to the authentication system.

## Prerequisites

- Supabase project configured with authentication enabled
- Environment variables set:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Email confirmation settings configured in Supabase dashboard

## Automated Tests

Run the automated security tests:

```bash
node tests/auth-security.test.js
```

This tests:
- Email validation logic
- Password validation (basic and strong)
- Email normalization
- Rate limiting logic
- Admin role verification
- Session cache expiry
- Backend rate limiting

## Manual Testing Checklist

### 1. Sign-Up Flow

#### Test 1.1: Valid Sign-Up
**Steps:**
1. Navigate to sign-up screen
2. Enter valid email (e.g., `test@example.com`)
3. Enter strong password (e.g., `Password123!`)
4. Confirm password (same as above)
5. Submit form

**Expected Result:**
- ✅ Account created successfully
- ✅ Redirected to email confirmation screen OR main app (depending on Supabase settings)
- ✅ Email sent for confirmation (if enabled)

#### Test 1.2: Weak Password Rejection
**Steps:**
1. Navigate to sign-up screen
2. Enter valid email
3. Enter weak password (e.g., `password`)
4. Confirm password
5. Submit form

**Expected Result:**
- ❌ Form submission blocked
- ❌ Error message: "Password must be at least 8 characters with uppercase, lowercase, number, and special character"

#### Test 1.3: Password Mismatch
**Steps:**
1. Navigate to sign-up screen
2. Enter valid email
3. Enter strong password (e.g., `Password123!`)
4. Enter different confirmation password (e.g., `Password456!`)
5. Submit form

**Expected Result:**
- ❌ Form submission blocked
- ❌ Error message: "Passwords do not match"

#### Test 1.4: Invalid Email
**Steps:**
1. Navigate to sign-up screen
2. Enter invalid email (e.g., `notanemail`)
3. Enter strong password
4. Confirm password
5. Submit form

**Expected Result:**
- ❌ Form submission blocked
- ❌ Error message: "Please enter a valid email address"

#### Test 1.5: Duplicate Email
**Steps:**
1. Navigate to sign-up screen
2. Enter email that's already registered
3. Enter strong password
4. Confirm password
5. Submit form

**Expected Result:**
- ❌ Error message: "This email is already registered. Please sign in instead."

#### Test 1.6: Real-time Validation
**Steps:**
1. Navigate to sign-up screen
2. Enter invalid email
3. See error appear
4. Correct the email
5. Observe error disappears

**Expected Result:**
- ✅ Error appears immediately after blur/validation
- ✅ Error clears when field is corrected
- ✅ Visual feedback (red border) appears and disappears appropriately

#### Test 1.7: Password Visibility Toggle
**Steps:**
1. Navigate to sign-up screen
2. Enter password
3. Click eye icon to toggle visibility
4. Verify password is visible
5. Click again to hide

**Expected Result:**
- ✅ Password toggles between visible and hidden
- ✅ Icon changes between eye and eye-off
- ✅ Works for both password and confirm password fields

### 2. Sign-In Flow

#### Test 2.1: Valid Sign-In
**Steps:**
1. Navigate to sign-in screen
2. Enter valid email
3. Enter correct password
4. Submit form

**Expected Result:**
- ✅ Successfully authenticated
- ✅ Redirected to main app
- ✅ Session token stored securely

#### Test 2.2: Invalid Credentials
**Steps:**
1. Navigate to sign-in screen
2. Enter valid email
3. Enter incorrect password
4. Submit form

**Expected Result:**
- ❌ Error message: "Invalid email or password. Please try again."
- ❌ Not redirected
- ❌ Login attempt counter incremented

#### Test 2.3: Rate Limiting
**Steps:**
1. Navigate to sign-in screen
2. Enter valid email
3. Enter incorrect password
4. Submit form
5. Repeat 4 more times (total 5 failed attempts)
6. Try to submit again

**Expected Result:**
- ❌ After 5th attempt: "Too many failed attempts. Please try again in 5 minutes."
- ❌ Form submission blocked for 5 minutes
- ✅ Counter displayed showing remaining lockout time

#### Test 2.4: Email Normalization
**Steps:**
1. Sign up with email `Test@Example.COM`
2. Sign out
3. Sign in with `test@example.com` (lowercase)

**Expected Result:**
- ✅ Sign-in succeeds despite different casing
- ✅ Email normalized to lowercase in database

#### Test 2.5: Empty Fields
**Steps:**
1. Navigate to sign-in screen
2. Leave email empty
3. Submit form

**Expected Result:**
- ❌ Error message: "Email is required"
- ❌ Form submission blocked

#### Test 2.6: Unconfirmed Email
**Steps:**
1. Create account but don't confirm email
2. Try to sign in

**Expected Result:**
- ❌ Error message: "Please confirm your email address before signing in."
- ❌ Sign-in blocked

### 3. Password Reset Flow

#### Test 3.1: Valid Reset Request
**Steps:**
1. Navigate to password reset screen (from sign-in → "Forgot?")
2. Enter valid registered email
3. Submit form

**Expected Result:**
- ✅ Success message: "If that email exists, a reset link was sent. Please check your inbox."
- ✅ Reset email sent (check inbox)
- ✅ Generic message prevents user enumeration

#### Test 3.2: Invalid Email Format
**Steps:**
1. Navigate to password reset screen
2. Enter invalid email (e.g., `notanemail`)
3. Submit form

**Expected Result:**
- ❌ Error message: "Please enter a valid email address"
- ❌ Form submission blocked

#### Test 3.3: Empty Email
**Steps:**
1. Navigate to password reset screen
2. Leave email field empty
3. Submit form

**Expected Result:**
- ❌ Error message: "Email is required"
- ❌ Form submission blocked

#### Test 3.4: Rate Limiting
**Steps:**
1. Request password reset multiple times rapidly
2. Observe rate limiting

**Expected Result:**
- ❌ After rate limit: "Too many requests. Please try again later."

#### Test 3.5: Reset Link Usage
**Steps:**
1. Request password reset
2. Check email
3. Click reset link
4. Enter new strong password
5. Confirm password
6. Submit

**Expected Result:**
- ✅ Password updated successfully
- ✅ Can sign in with new password
- ✅ Old password no longer works

### 4. Password Change (Settings)

#### Test 4.1: Valid Password Change
**Steps:**
1. Sign in to app
2. Navigate to Settings → Privacy & Security
3. Enter current password
4. Enter new strong password (e.g., `NewPass123!`)
5. Confirm new password
6. Click "Update Password"

**Expected Result:**
- ✅ Success message: "Your password has been updated successfully"
- ✅ Fields cleared
- ✅ Can sign in with new password
- ✅ Old password no longer works

#### Test 4.2: Weak New Password
**Steps:**
1. Navigate to password change section
2. Enter current password
3. Enter weak new password (e.g., `weak`)
4. Confirm password
5. Click "Update Password"

**Expected Result:**
- ❌ Error message: "Password must be at least 8 characters with uppercase, lowercase, number, and special character"

#### Test 4.3: Password Mismatch
**Steps:**
1. Navigate to password change section
2. Enter current password
3. Enter new strong password
4. Enter different confirmation password
5. Click "Update Password"

**Expected Result:**
- ❌ Error message: "New passwords do not match"

#### Test 4.4: Empty Fields
**Steps:**
1. Navigate to password change section
2. Leave fields empty or partially filled
3. Click "Update Password"

**Expected Result:**
- ❌ Error message: "Please fill in all password fields"

### 5. Admin Access Control

#### Test 5.1: Admin Route Access (Authorized)
**Steps:**
1. Sign in with admin account (user_metadata.role = 'admin')
2. Navigate to `/admin` route
3. Observe page loads

**Expected Result:**
- ✅ Admin dashboard displays
- ✅ Can access admin features
- ✅ No redirect

#### Test 5.2: Admin Route Access (Unauthorized)
**Steps:**
1. Sign in with regular account
2. Attempt to navigate to `/admin` route

**Expected Result:**
- ❌ Redirected to `/tabs/bounty-app`
- ❌ Cannot access admin features

#### Test 5.3: Admin Status Verification
**Steps:**
1. Sign in with admin account
2. Check admin status via API
3. Wait 6 minutes
4. Perform admin action

**Expected Result:**
- ✅ Initial status verified from cache
- ✅ Background verification occurs
- ✅ After cache expiry, re-verification happens automatically
- ✅ Admin actions still work

#### Test 5.4: Admin Backend Routes
**Steps:**
1. Sign in with admin account
2. Get auth token from SecureStore/session
3. Make API request to `/admin/metrics` with Bearer token
4. Verify response

**Expected Result:**
- ✅ Request succeeds with valid admin token
- ✅ Metrics data returned

#### Test 5.5: Non-Admin Backend Access
**Steps:**
1. Sign in with regular account
2. Get auth token
3. Make API request to `/admin/metrics` with Bearer token

**Expected Result:**
- ❌ 403 Forbidden response
- ❌ Error: "This resource requires administrator privileges"

### 6. Session Management

#### Test 6.1: Session Persistence
**Steps:**
1. Sign in
2. Close app completely
3. Reopen app

**Expected Result:**
- ✅ User still signed in
- ✅ No need to re-authenticate
- ✅ Session restored from SecureStore

#### Test 6.2: Token Refresh
**Steps:**
1. Sign in
2. Wait for token to approach expiry (check token exp claim)
3. Perform authenticated action

**Expected Result:**
- ✅ Token automatically refreshed
- ✅ Action succeeds without re-authentication
- ✅ New token stored

#### Test 6.3: Session Expiration
**Steps:**
1. Sign in
2. Manually expire token in Supabase dashboard
3. Perform authenticated action

**Expected Result:**
- ❌ Error: "Your session has expired. Please sign in again."
- ❌ Redirected to sign-in screen

#### Test 6.4: Sign-Out
**Steps:**
1. Sign in
2. Navigate to profile/settings
3. Click sign out
4. Try to access protected route

**Expected Result:**
- ✅ Session cleared from SecureStore
- ✅ Redirected to sign-in screen
- ✅ Cannot access protected routes

### 7. Backend Rate Limiting

#### Test 7.1: API Rate Limit
**Steps:**
1. Sign in and get auth token
2. Make 61+ requests to authenticated endpoint within 1 minute
3. Observe response

**Expected Result:**
- ✅ First 60 requests succeed
- ❌ 61st request returns 429 Too Many Requests
- ❌ Error: "Rate limit exceeded. Please try again later."

#### Test 7.2: Rate Limit Reset
**Steps:**
1. Hit rate limit (61+ requests)
2. Wait 1 minute
3. Make another request

**Expected Result:**
- ✅ Request succeeds after 1 minute wait
- ✅ Rate limit counter reset

### 8. Error Handling

#### Test 8.1: Network Error
**Steps:**
1. Disable network connection
2. Try to sign in
3. Observe error message

**Expected Result:**
- ❌ User-friendly error: "An unexpected error occurred. Please try again."
- ❌ Not "Network Error" or raw error

#### Test 8.2: Server Error
**Steps:**
1. Simulate Supabase being down (disconnect or use invalid credentials)
2. Try to sign in

**Expected Result:**
- ❌ User-friendly error message
- ❌ App doesn't crash

#### Test 8.3: Invalid Token
**Steps:**
1. Manually modify stored auth token
2. Try to perform authenticated action

**Expected Result:**
- ❌ Error: "Authentication failed. Please sign in again."
- ❌ Redirected to sign-in screen

## Testing with Different Scenarios

### Scenario 1: First-Time User
1. Install app
2. Create account
3. Confirm email
4. Sign in
5. Navigate around app

### Scenario 2: Returning User
1. Open app (already authenticated)
2. Verify session persists
3. Perform actions
4. Sign out
5. Sign back in

### Scenario 3: Admin User
1. Sign in with admin account
2. Access admin dashboard
3. Perform admin actions
4. Verify audit logging

### Scenario 4: Security Breach Attempt
1. Try SQL injection in email field
2. Try XSS in password field
3. Try CSRF with different origin
4. Verify all are blocked

## Automated Testing Tools

### Using Postman/cURL for API Testing

```bash
# Get admin metrics (replace TOKEN with valid admin JWT)
curl -X GET http://localhost:3000/admin/metrics \
  -H "Authorization: Bearer TOKEN"

# Expected: 200 OK with metrics data (admin)
# Expected: 403 Forbidden (non-admin)

# Test rate limiting
for i in {1..65}; do
  curl -X GET http://localhost:3000/me \
    -H "Authorization: Bearer TOKEN"
done
# Expected: First 60 succeed, remaining return 429
```

### Using React Native Testing Library

For component testing, use:
```bash
npm install --save-dev @testing-library/react-native
npm install --save-dev @testing-library/jest-native
```

Then create tests in `__tests__/` directories.

## Security Review Checklist

After testing, verify:

- [ ] All passwords stored are hashed (handled by Supabase)
- [ ] No sensitive data in error messages
- [ ] Rate limiting works correctly
- [ ] Admin routes properly protected
- [ ] Session tokens stored securely
- [ ] HTTPS used for all requests (handled by Supabase)
- [ ] Input validation prevents injection attacks
- [ ] Email normalization prevents duplicate accounts
- [ ] Password requirements are enforced
- [ ] Account lockout prevents brute force
- [ ] Audit trail logs admin actions

## Reporting Issues

If you find security vulnerabilities during testing:

1. **DO NOT** create public GitHub issues
2. Email security@bountyexpo.com with details
3. Include steps to reproduce
4. Wait for response before disclosure

## Additional Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [SECURITY.md](./SECURITY.md) - Detailed security documentation

---

Last Updated: 2024
Testing Guide Version: 1.0
