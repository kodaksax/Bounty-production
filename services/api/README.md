# BountyExpo API

This is the backend API service for BountyExpo, built with Fastify, Drizzle ORM, and PostgreSQL.

## Features

- **PostgreSQL Database**: Uses Drizzle ORM for type-safe database operations
- **Supabase JWT Authentication**: Middleware for verifying Supabase JWT tokens
- **Auto-migration System**: Database schema migrations using Drizzle Kit
- **User Management**: Automatic user creation on first authenticated request

## Database Schema

### Users Table
- `id` (UUID, Primary Key)
- `handle` (Text, Not Null)
- `stripe_account_id` (Text, Nullable)
- `created_at` (Timestamp with timezone)

### Bounties Table
- `id` (UUID, Primary Key) 
- `creator_id` (UUID, Foreign Key to users.id)
- `title` (Text, Not Null)
- `description` (Text, Not Null)
- `amount_cents` (Integer, Default 0)
- `is_for_honor` (Boolean, Default false)
- `status` (Text, Default 'open')
- `created_at` (Timestamp with timezone)
- `updated_at` (Timestamp with timezone)

## API Endpoints

### `GET /health`
Health check endpoint that verifies database connectivity.
- **Auth**: None required
- **Response**: Service status and database connection status

### `GET /me`
Get current user profile. Creates user record on first request if it doesn't exist.
- **Auth**: Required (Supabase JWT)
- **Response**: User profile data

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   Copy `.env.example` to `.env` and configure:
   ```bash
   DATABASE_URL="postgresql://username:password@localhost:5432/bountyexpo"
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_ANON_KEY="your-anon-key"
   ```

3. **Generate and run migrations**:
   ```bash
   npm run db:generate  # Generate migration files
   npm run db:migrate   # Run migrations
   npm run db:seed      # Seed test data (optional)
   ```

4. **Start the server**:
   ```bash
   npm run dev    # Development with hot reload
   npm run start  # Production
   ```

## Development Commands

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run type-check` - Run TypeScript type checking
- `npm run db:generate` - Generate new migration files
- `npm run db:migrate` - Run pending migrations
- `npm run db:seed` - Seed database with test data
- `npm run db:studio` - Open Drizzle Studio (database GUI)
- `npm run db:setup` - Run migrations and seed data

## Authentication

The API uses Supabase JWT tokens for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <supabase-jwt-token>
```

The `/me` endpoint will automatically create a user record in the database on the first authenticated request if one doesn't exist.
