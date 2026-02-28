# Authentication Testing Guide

This guide explains how to test the authentication changes made to the sign-up and sign-in flows.

## Overview of Changes

The authentication system has been simplified to use a clean client-server architecture:

1. **Frontend (React Native)**: Sign-up and sign-in forms now only make API calls to the backend
2. **Backend (Express.js)**: Server handles all Supabase authentication and database operations

## Prerequisites

Before testing, ensure you have:

1. Supabase project configured with proper environment variables:
   - `SUPABASE_URL` (or `PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY` or `SERVICE_ROLE_KEY`)

2. Database with `profiles` table (auto-migrated on server startup if using MySQL)

3. API server running on port 3001 (or configured port)

## Testing Sign-Up Flow

### Step 1: Start the API Server

```bash
cd /path/to/bountyexpo
node api/server.js
```

Expected output should include:
```
[SupabaseAdmin] initialized for URL: https://your-project.supabase.co
[SupabaseAdmin] connectivity OK (listUsers)
🚀 API server listening on http://127.0.0.1:3001
```

### Step 2: Start the Expo App

```bash
npx expo start
```

### Step 3: Navigate to Sign-Up

1. Open the app on your device/emulator
2. Navigate to the sign-up screen (`/auth/sign-up-form`)

### Step 4: Create Account

Fill in the form:
- **Email**: A valid email address (e.g., `test@example.com`)
- **Username**: 3-24 characters, letters/numbers/underscore (e.g., `testuser123`)
- **Password**: Minimum 6 characters (e.g., `password123`)
- **Confirm Password**: Must match password

Press **"Create Account"**

### Expected Results

#### Success Case:
- Form clears all fields
- Success message appears: "Check your email for a confirmation link..."
- "Go to Sign In" button appears
- In Supabase dashboard → Authentication → Users: New user appears
- In database `profiles` table: New profile record with initial balance (40.00)

#### Server Logs (Success):
```
[sign-up] User created successfully: { userId: 'uuid-here', email: 'test@example.com', username: 'testuser123' }
```

#### Error Cases:
- **Missing fields**: "Email, username, and password are required"
- **Invalid email**: "Invalid email address"
- **Invalid username**: "Username must be 3-24 characters (letters, numbers, underscore)"
- **Short password**: "Password must be at least 6 characters"
- **Duplicate email**: "Email already registered"
- **Duplicate username**: "Username already taken"
- **Passwords don't match**: "Passwords do not match"

## Testing Sign-In Flow

### Step 1: Navigate to Sign-In

After successful sign-up, either:
- Click "Go to Sign In" button
- Navigate directly to `/auth/sign-in-form`

### Step 2: Sign In

Fill in the form:
- **Email or Username**: The email you registered with (e.g., `test@example.com`)
- **Password**: The password you created (e.g., `password123`)

Press **"Sign In"**

### Expected Results

#### Success Case:
- Loading indicator shows "Signing in..."
- User is redirected to `/tabs/bounty-app` (main app screen)
- Access token is stored securely

#### Server Logs (Success):
```
[sign-in] User signed in successfully: { userId: 'uuid-here', email: 'test@example.com' }
```

#### Error Cases:
- **Missing fields**: "Email and password are required"
- **Invalid credentials**: "Invalid credentials" or Supabase error message
- **User profile not found**: "User profile not found"

## Verifying Database Records

### Check Supabase Users Table

1. Go to Supabase Dashboard
2. Navigate to Authentication → Users
3. Verify your newly created user appears with:
   - Email confirmed (green checkmark)
   - Metadata includes username

### Check Database Profiles Table

Connect to your database and run:

```sql
SELECT * FROM profiles ORDER BY created_at DESC LIMIT 5;
```

Verify:
- New profile exists with matching `id` (UUID from Supabase)
- `username` matches what you entered
- `email` matches what you entered
- `balance` is set to 40.00
- `created_at` timestamp is recent

## API Endpoint Testing

You can also test the endpoints directly using curl or Postman:

### Test Sign-Up Endpoint

```bash
curl -X POST http://localhost:3001/app/auth/sign-up-form \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "username": "newuser123",
    "password": "password123"
  }'
```

Expected response (201 Created):
```json
{
  "success": true,
  "message": "Account created successfully",
  "userId": "uuid-here",
  "requiresConfirmation": false
}
```

### Test Sign-In Endpoint

```bash
curl -X POST http://localhost:3001/app/auth/sign-in-form \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "password123"
  }'
```

Expected response (200 OK):
```json
{
  "success": true,
  "message": "Signed in successfully",
  "user": {
    "id": "uuid-here",
    "email": "newuser@example.com",
    "username": "newuser123"
  },
  "session": {
    "access_token": "jwt-token-here",
    "refresh_token": "refresh-token-here",
    ...
  },
  "redirectTo": "/app/tabs/bounty-app"
}
```

## Troubleshooting

### "Supabase admin not configured"

**Problem**: Server can't connect to Supabase

**Solutions**:
1. Check environment variables are set correctly
2. Verify `.env` file is in the project root
3. Check server startup logs for Supabase initialization errors
4. Verify service role key has correct permissions

### "Failed to create account" / Network errors

**Problem**: Client can't reach server

**Solutions**:
1. Ensure API server is running on port 3001
2. For Android emulator, server should be reachable at `10.0.2.2:3001`
3. For iOS simulator, use `localhost:3001`
4. Check firewall settings
5. Verify `API_BASE_URL` environment variable if using custom URL

### "Email already registered" when it shouldn't be

**Problem**: Leftover data from previous tests

**Solutions**:
1. Delete user from Supabase dashboard (Authentication → Users)
2. Delete profile from database: `DELETE FROM profiles WHERE email = 'test@example.com'`
3. Try with a different email address

### User created but profile not in database

**Problem**: Database connection issue

**Solutions**:
1. Check database connection in server logs
2. Verify `lib/db.js` or `lib/db-sqlite.js` configuration
3. Check MySQL/PostgreSQL is running
4. Verify database credentials in environment variables

## Summary

The authentication flow has been successfully refactored to:

1. **Remove client-side auth complexity**: No more fallback logic or direct Supabase calls
2. **Centralize auth logic**: All authentication happens server-side
3. **Improve validation**: Server validates all inputs before processing
4. **Better error handling**: Clear error messages for all failure cases
5. **Proper separation of concerns**: Client focuses on UI, server handles business logic

When tested correctly, you should see:
- ✅ New users appear in Supabase Authentication
- ✅ New profiles appear in database with correct data
- ✅ Sign-in works with email and password
- ✅ Successful sign-in redirects to main app
- ✅ Access token is stored for future requests
