# BountyExpo Backend Integration Guide

This document covers the live data backend integration implemented for BountyExpo.

## Overview

The app uses a **Supabase** backend for authentication and user management, along with a **PostgreSQL** database and **Express.js API server** for bounty data and business logic. All frontend services connect to real API endpoints.

## Architecture

```
Frontend (React Native/Expo)
    ↓ (HTTP requests)
Service Layer (TypeScript)
    ↓ (REST API calls) 
Express.js API Server
    ↓ (Supabase Auth + PostgreSQL queries)
Supabase (Authentication) + PostgreSQL Database
```

## Authentication Flow

- **Sign-Up**: Frontend → API Server → Supabase Admin API → Creates user + profile in database
- **Sign-In**: Frontend → API Server → Supabase Auth → Returns JWT token → Stored in SecureStore
- **Protected Routes**: Frontend includes JWT token in Authorization header → API verifies with Supabase

## Database Schema

The database includes these main tables:
- `profiles` - User profiles with balance, username, etc.
- `bounties` - Bounty postings with title, description, amount, etc.
- `bounty_requests` - Applications/requests for bounties
- `skills` - User skills and credentials
- `conversations` & `messages` - Chat/messaging system
- `wallet_transactions` - Financial transactions

## Setup Instructions

### 1. Environment Configuration

Create a `.env` file in the root directory:

```env
DB_HOST=localhost
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=bountyexpo_db
API_PORT=3001
NODE_ENV=development
```

### 2. Database Setup

Initialize the database schema:

```bash
npm run db:init
```

This will create all necessary tables and insert a default test user.

### 3. Start the API Server

```bash
npm run api
```

The API server will start on http://localhost:3001

### 4. Test the Integration

Run API tests to verify everything works:

```bash
npm run test:api
```

## API Endpoints

### Profiles
- `GET /api/profile` - Get current user profile  
- `GET /api/profiles/:id` - Get profile by ID
- `POST /api/profiles` - Create/update profile

### Bounties
- `GET /api/bounties` - Get all bounties (with filters)
- `GET /api/bounties/:id` - Get bounty by ID
- `POST /api/bounties` - Create new bounty
- `PATCH /api/bounties/:id` - Update bounty
- `DELETE /api/bounties/:id` - Delete bounty

### Bounty Requests
- `GET /api/bounty-requests` - Get all requests (with filters)
- `POST /api/bounty-requests` - Create new request
- `PATCH /api/bounty-requests/:id` - Update request status

### Authentication (Supabase-backed)
- `POST /app/auth/sign-up-form` - User registration (creates Supabase user + profile)
- `POST /app/auth/sign-in-form` - User authentication (validates with Supabase)
- `GET /api/user-id` - Get current user ID
- `GET /auth/diagnostics` - Check Supabase configuration status

## Service Layer

The TypeScript services in `lib/services/` now connect to real API endpoints:

- `bounty-service.ts` - Bounty CRUD operations
- `profile-service.ts` - User profile management  
- `bounty-request-service.ts` - Bounty request handling

## Testing Authentication

Use the test script to verify authentication endpoints:

```bash
# Make sure the API server is running first
npm run api

# In another terminal, run the test
node scripts/test-auth-endpoints.js

# Or specify a custom API URL
node scripts/test-auth-endpoints.js http://localhost:3001
```

The test script will:
1. Check server health
2. Verify Supabase configuration
3. Create a test user account
4. Sign in with the test credentials
5. Verify invalid credentials are rejected

## Error Handling

- Services include comprehensive error logging
- API returns proper HTTP status codes
- Database connection errors are handled gracefully
- TypeScript ensures type safety throughout

## Development Workflow

1. Start the API server: `npm run api`
2. In another terminal, start the Expo dev server: `npm start`
3. Make changes to services or API endpoints as needed
4. Run tests: `npm run test:api`

## Production Considerations

For production deployment:

1. Use proper environment variables for database credentials
2. Set up database connection pooling
3. Add JWT authentication tokens
4. Implement rate limiting
5. Add database backups
6. Use HTTPS for API endpoints

## Troubleshooting

**Database Connection Issues:**
- Verify MySQL is running
- Check database credentials in `.env`
- Ensure database exists

**API Server Issues:**
- Check if port 3001 is available
- Verify all dependencies are installed: `npm install`
- Check server logs for errors

**Frontend Issues:**
- Ensure API_BASE_URL environment variable is set correctly
- Check network connectivity between frontend and API server
- Verify TypeScript compilation: `npx tsc --noEmit`

## Next Steps

The live data backend integration is now complete. Future enhancements could include:

- Real-time updates with WebSocket connections
- Advanced authentication with JWT tokens
- Database migrations for schema changes
- Performance optimizations and caching
- Integration with payment systems
- File upload handling for attachments