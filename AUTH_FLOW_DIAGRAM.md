# Authentication Flow Diagram

## Sign-Up Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SIGN-UP PROCESS                                │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   User enters:       │
│   - Email            │
│   - Username         │
│   - Password         │
│   - Confirm Password │
└──────────┬───────────┘
           │
           ↓
┌──────────────────────┐
│  Frontend Validation │
│  - All fields filled │
│  - Passwords match   │
└──────────┬───────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────┐
│  POST /app/auth/sign-up-form                                 │
│  Body: { email, username, password }                         │
└──────────┬───────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────┐
│  Server (api/server.js - Line 195)                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Validate Inputs                                     │  │
│  │    • Email format (regex: /.+@.+\..+/)                │  │
│  │    • Username (3-24 chars, alphanumeric + _)          │  │
│  │    • Password (min 6 chars)                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 2. Check Database for Duplicates                      │  │
│  │    • Query: SELECT id FROM profiles WHERE email = ?   │  │
│  │    • Query: SELECT id FROM profiles WHERE username = ?│  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 3. Create Supabase User                               │  │
│  │    • supabaseAdmin.auth.admin.createUser()           │  │
│  │    • email_confirm: true (auto-confirm)              │  │
│  │    • user_metadata: { username }                     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 4. Create Profile in Database                         │  │
│  │    • INSERT INTO profiles                             │  │
│  │    • id: Supabase user UUID                          │  │
│  │    • balance: 40.00 (default)                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────┬───────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────┐
│  Response (201 Created)                                      │
│  {                                                           │
│    "success": true,                                          │
│    "message": "Account created successfully",                │
│    "userId": "uuid-here",                                    │
│    "requiresConfirmation": false                             │
│  }                                                           │
└──────────┬───────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────┐
│  Client Response     │
│  - Clear form fields │
│  - Show success msg  │
│  - Show "Go to       │
│    Sign In" button   │
└──────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          VERIFICATION                                   │
└─────────────────────────────────────────────────────────────────────────┘

User appears in:
✓ Supabase Dashboard → Authentication → Users
  └─ Email confirmed: ✓
  └─ User metadata: { username: "..." }

✓ Database → profiles table
  └─ id: (Supabase user UUID)
  └─ username: "..."
  └─ email: "..."
  └─ balance: 40.00
  └─ created_at: (timestamp)
```

## Sign-In Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SIGN-IN PROCESS                                │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   User enters:       │
│   - Email            │
│   - Password         │
└──────────┬───────────┘
           │
           ↓
┌──────────────────────┐
│  Frontend Validation │
│  - Both fields filled│
└──────────┬───────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────┐
│  POST /app/auth/sign-in-form                                 │
│  Body: { email, password }                                   │
└──────────┬───────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────┐
│  Server (api/server.js - Line 278)                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Validate Inputs                                     │  │
│  │    • Email and password present                       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 2. Authenticate with Supabase                         │  │
│  │    • supabaseAdmin.auth.signInWithPassword()         │  │
│  │    • Verify email and password                       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 3. Verify Profile Exists                              │  │
│  │    • Query: SELECT * FROM profiles WHERE id = ?       │  │
│  │    • Ensure user has profile record                   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────┬───────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────────────────────┐
│  Response (200 OK)                                           │
│  {                                                           │
│    "success": true,                                          │
│    "message": "Signed in successfully",                      │
│    "user": {                                                 │
│      "id": "uuid",                                           │
│      "email": "user@example.com",                            │
│      "username": "username123"                               │
│    },                                                        │
│    "session": {                                              │
│      "access_token": "jwt-token...",                         │
│      "refresh_token": "refresh-token...",                    │
│      "expires_in": 3600,                                     │
│      "token_type": "bearer"                                  │
│    },                                                        │
│    "redirectTo": "/app/tabs/bounty-app"                     │
│  }                                                           │
└──────────┬───────────────────────────────────────────────────┘
           │
           ↓
┌──────────────────────┐
│  Client Response     │
│  1. Store token in   │
│     SecureStore      │
│  2. Navigate to      │
│     /tabs/bounty-app │
└──────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          USER LOGGED IN                                 │
└─────────────────────────────────────────────────────────────────────────┘

Session active:
✓ Access token stored in SecureStore
✓ Can make authenticated API requests
✓ User on main app screen (/tabs/bounty-app)
```

## Error Handling

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SIGN-UP ERROR SCENARIOS                            │
└─────────────────────────────────────────────────────────────────────────┘

Missing Fields
├─ Error: "Email, username, and password are required"
└─ HTTP 400

Invalid Email Format
├─ Error: "Invalid email address"
└─ HTTP 400

Invalid Username
├─ Error: "Username must be 3-24 characters (letters, numbers, underscore)"
└─ HTTP 400

Short Password
├─ Error: "Password must be at least 6 characters"
└─ HTTP 400

Passwords Don't Match (Frontend)
├─ Error: "Passwords do not match"
└─ No server call

Email Already Exists
├─ Error: "Email already registered"
└─ HTTP 409

Username Already Exists
├─ Error: "Username already taken"
└─ HTTP 409

Supabase Error
├─ Error: (Supabase error message)
└─ HTTP 400

Server/Database Error
├─ Error: "Failed to create account"
└─ HTTP 500

┌─────────────────────────────────────────────────────────────────────────┐
│                      SIGN-IN ERROR SCENARIOS                            │
└─────────────────────────────────────────────────────────────────────────┘

Missing Fields
├─ Error: "Email and password are required"
└─ HTTP 400

Invalid Credentials
├─ Error: (Supabase error message or "Invalid credentials")
└─ HTTP 401

Profile Not Found
├─ Error: "User profile not found"
└─ HTTP 404

Server/Database Error
├─ Error: "Authentication failed"
└─ HTTP 500
```

## Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      BEFORE (Complex)                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Client     │
│  (Sign-up)   │
└──────┬───────┘
       │
       ├──────────────────────────┐
       │                          │
       ↓                          ↓
┌──────────────┐          ┌──────────────┐
│   Backend    │          │   Supabase   │
│   /auth/     │          │   Direct     │
│   register   │          │   Call       │
└──────┬───────┘          └──────┬───────┘
       │                         │
       ├─ On Error ──────────────┤
       │                         │
       ↓                         ↓
    Fallback              Direct signUp()
    to Supabase          (email confirmation)


Problems:
✗ Complex fallback logic
✗ Multiple code paths
✗ Inconsistent behavior
✗ Hard to debug
✗ Security concerns (client-side auth)
✗ Tight coupling


┌─────────────────────────────────────────────────────────────────────────┐
│                      AFTER (Clean)                                      │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Client     │
│  (Sign-up)   │
└──────┬───────┘
       │
       │ Single API Call
       ↓
┌──────────────────────────────────────────┐
│   Backend                                │
│   /app/auth/sign-up-form                 │
│   ┌─────────────────────────────────┐    │
│   │  1. Validate                   │    │
│   │  2. Check duplicates           │    │
│   │  3. Create Supabase user       │    │
│   │  4. Create profile             │    │
│   │  5. Return JSON response       │    │
│   └─────────────────────────────────┘    │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────┐
│   Supabase   │
│   +          │
│   Database   │
└──────────────┘


Benefits:
✓ Single code path
✓ Consistent behavior
✓ Easy to debug
✓ Server-side validation
✓ Better security
✓ Loose coupling
✓ Easy to test
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DATA CREATED ON SIGN-UP                            │
└─────────────────────────────────────────────────────────────────────────┘

Input: { email: "test@example.com", username: "testuser", password: "pass123" }

       ↓

┌─────────────────────────────────────────────────────────────┐
│  Supabase Authentication                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Users Table (auth.users)                              │  │
│  │ ┌─────────────────────────────────────────────────┐   │  │
│  │ │ id: "f47ac10b-58cc-..."                          │   │  │
│  │ │ email: "test@example.com"                        │   │  │
│  │ │ email_confirmed_at: "2024-01-01T00:00:00Z"      │   │  │
│  │ │ user_metadata: { username: "testuser" }         │   │  │
│  │ │ created_at: "2024-01-01T00:00:00Z"              │   │  │
│  │ └─────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

       ↓

┌─────────────────────────────────────────────────────────────┐
│  Application Database                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ profiles Table                                        │  │
│  │ ┌─────────────────────────────────────────────────┐   │  │
│  │ │ id: "f47ac10b-58cc-..." (same as Supabase)      │   │  │
│  │ │ username: "testuser"                            │   │  │
│  │ │ email: "test@example.com"                       │   │  │
│  │ │ balance: 40.00                                  │   │  │
│  │ │ avatar_url: NULL                                │   │  │
│  │ │ about: NULL                                     │   │  │
│  │ │ phone: NULL                                     │   │  │
│  │ │ created_at: "2024-01-01T00:00:00Z"              │   │  │
│  │ │ updated_at: "2024-01-01T00:00:00Z"              │   │  │
│  │ └─────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

The id field links Supabase auth with app database:
- Supabase manages authentication
- Database manages user profile and app data
- Both use same UUID as primary key
```

## Summary

This refactoring achieves:

1. **Simplicity**: Client code reduced by ~70 lines
2. **Maintainability**: Single source of truth for auth logic
3. **Security**: Server-side validation and user creation
4. **Reliability**: Single code path, fewer failure modes
5. **Testability**: Easy to test endpoints independently
6. **Scalability**: Can add features (2FA, OAuth) server-side only

All authentication logic is now centralized in the backend, making the system easier to understand, maintain, and extend.
