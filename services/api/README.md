# BountyExpo API

> Backend API service for BountyExpo, built with Fastify, Drizzle ORM, and PostgreSQL

## Overview

The BountyExpo API is a production-ready backend service that powers the BountyExpo mobile application. It provides RESTful endpoints for managing bounties, user profiles, payments, messaging, and more.

## Features

- **🔐 JWT Authentication** - Supabase JWT-based authentication with automatic user provisioning
- **💾 PostgreSQL Database** - Type-safe database operations with Drizzle ORM
- **⚡ Redis Caching** - Multi-layer caching for improved performance
- **💳 Stripe Integration** - Payment processing and escrow management
- **🔄 Real-time Updates** - WebSocket support for live updates
- **📊 Auto-migrations** - Database schema migrations using Drizzle Kit
- **🛡️ Security** - Rate limiting, input validation, and security headers
- **📝 Comprehensive Logging** - Structured logging with request tracking

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- pnpm package manager

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
# Start development server with hot reload
pnpm dev

# Run type checking
pnpm type-check

# Run database migrations
pnpm db:migrate

# Seed database with test data
pnpm db:seed

# Open Drizzle Studio (database GUI)
pnpm db:studio
```

## Architecture

The API follows a layered architecture:

```
src/
  ├── routes/           # API endpoint handlers
  ├── middleware/       # Request processing middleware
  ├── services/         # Business logic services
  ├── db/               # Database schema and queries
  ├── utils/            # Utility functions
  └── types/            # TypeScript type definitions
```

## Database Schema

### Core Tables

- **users** - User accounts and profiles
- **bounties** - Job postings
- **bounty_requests** - Applications to work on bounties
- **wallet_transactions** - Financial transactions
- **conversations** - Chat conversations
- **messages** - Chat messages
- **notifications** - User notifications

For detailed schema documentation, see [Database Schema](../../ARCHITECTURE.md#database-schema).

## API Endpoints

### Authentication

- `POST /auth/register` - Register new user
- `POST /auth/sign-in` - Sign in existing user
- `POST /auth/sign-out` - Sign out
- `POST /auth/refresh` - Refresh access token
- `GET /auth/me` - Get current user

### Bounties

- `POST /bounties` - Create bounty
- `GET /bounties` - List bounties (with filters)
- `GET /bounties/:id` - Get bounty details
- `PATCH /bounties/:id` - Update bounty
- `DELETE /bounties/:id` - Archive bounty
- `POST /bounties/:id/accept` - Accept bounty
- `POST /bounties/:id/complete` - Complete bounty
- `POST /bounties/:id/cancel` - Cancel bounty

### Profiles

- `GET /profiles/:userId` - Get user profile
- `PATCH /profiles/:userId` - Update profile
- `DELETE /profiles/:userId` - Delete account

### Payments & Wallet

- `POST /payments/create-payment-intent` - Create payment intent
- `POST /payments/confirm` - Confirm payment
- `GET /payments/methods` - List payment methods
- `POST /payments/methods` - Add payment method
- `GET /wallet/balance` - Get wallet balance
- `GET /wallet/transactions` - List transactions
- `POST /wallet/withdraw` - Withdraw funds

### Messaging

- `POST /messages` - Send message
- `GET /messages` - List messages
- `GET /conversations` - List conversations
- `POST /conversations` - Create conversation

### Notifications

- `GET /notifications` - List notifications
- `POST /notifications/:id/read` - Mark as read
- `POST /notifications/read-all` - Mark all as read
- `POST /notifications/register-token` - Register push token

For complete API documentation, see [API_REFERENCE.md](../../API_REFERENCE.md).

## Environment Variables

```bash
# Server
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/bountyexpo"
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_ENABLED=true
REDIS_TTL_PROFILE=300
REDIS_TTL_BOUNTY=180
REDIS_TTL_BOUNTY_LIST=60

# Supabase
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_JWT_SECRET="your-jwt-secret"

# Stripe
STRIPE_SECRET_KEY="sk_test_your_key_here"
STRIPE_WEBHOOK_SECRET="whsec_your_secret_here"

# Security
JWT_SECRET="your-jwt-secret"
ENCRYPTION_KEY="your-encryption-key"

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Authentication

The API uses Supabase JWT tokens for authentication. Include the token in the Authorization header:

```http
Authorization: Bearer <supabase-jwt-token>
```

### Token Flow

1. Client signs in via `/auth/sign-in` or `/auth/register`
2. API validates credentials with Supabase
3. Returns JWT access token and refresh token
4. Client includes access token in subsequent requests
5. When token expires, client refreshes via `/auth/refresh`

The `/auth/me` endpoint automatically creates a user record in the database on the first authenticated request if one doesn't exist.

## Caching Strategy

The API implements a three-layer caching strategy:

### Layer 1: Redis Cache

- **User Profiles**: 5 minutes (300s)
- **Individual Bounties**: 3 minutes (180s)
- **Bounty Lists**: 1 minute (60s)

### Layer 2: Database Connection Pool

- Reuses connections for better performance
- Configurable min/max pool size

### Layer 3: Query Result Caching

- Drizzle ORM query result caching
- Automatic invalidation on updates

### Cache Invalidation

Caches are automatically invalidated when:
- Profile updates → invalidate profile cache
- Bounty CRUD operations → invalidate bounty and list caches
- Status changes → invalidate related caches

## Real-time Events

The API supports real-time updates via WebSocket:

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3001/events/subscribe?token=<jwt-token>');

// Listen for events
ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log('Event:', event);
});
```

### Event Types

- `bounty.status` - Bounty status changed
- `message.new` - New chat message
- `notification.new` - New notification
- `payment.completed` - Payment succeeded

## Error Handling

The API returns standardized error responses:

```json
{
  "error": "Validation Error",
  "message": "Title must be at least 10 characters",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "title",
    "constraint": "minLength"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error
- `503` - Service Unavailable

## Rate Limiting

### Authentication Endpoints

- **Limit**: 5 requests per 15 minutes per IP
- **Applies to**: `/auth/sign-in`, `/auth/register`, `/auth/sign-up`

### General Endpoints

- **Limit**: 100 requests per minute per user
- **Applies to**: All authenticated endpoints

Rate limit headers are included in responses:
- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Remaining requests
- `X-RateLimit-Reset` - Reset time (ISO 8601)

## Testing

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test:unit
pnpm test:integration

# Run with coverage
pnpm test:coverage

# Test specific endpoints
pnpm test:auth
pnpm test:api
```

## Deployment

For production deployment instructions, see [DEPLOYMENT.md](../../DEPLOYMENT.md).

### Docker

```bash
# Build image
docker build -t bountyexpo/api:latest -f Dockerfile .

# Run container
docker run -p 3001:3001 \
  -e DATABASE_URL="postgresql://..." \
  -e REDIS_URL="redis://..." \
  bountyexpo/api:latest
```

### Health Check

```bash
# Check API health
curl http://localhost:3001/health

# Response
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "supabase": "healthy"
  },
  "version": "1.0.0"
}
```

## Monitoring

### Metrics

- API response times (p50, p95, p99)
- Error rates by endpoint
- Database query performance
- Cache hit rates
- Active connections

### Logging

Structured JSON logs with request correlation:

```json
{
  "level": "info",
  "msg": "Request completed",
  "reqId": "req-123",
  "method": "POST",
  "url": "/bounties",
  "statusCode": 201,
  "responseTime": 45,
  "userId": "user-456"
}
```

## Security

- ✅ HTTPS enforced
- ✅ CORS configured
- ✅ Helmet security headers
- ✅ Rate limiting
- ✅ Input validation (Zod schemas)
- ✅ SQL injection prevention (ORM)
- ✅ XSS prevention (input sanitization)
- ✅ JWT authentication
- ✅ Database encryption at rest
- ✅ Secrets management

## Development Commands

```bash
# Development
pnpm dev              # Start dev server with hot reload
pnpm start            # Start production server
pnpm type-check       # TypeScript validation
pnpm lint             # ESLint checks

# Database
pnpm db:generate      # Generate migration files
pnpm db:migrate       # Run pending migrations
pnpm db:seed          # Seed test data
pnpm db:studio        # Open Drizzle Studio
pnpm db:setup         # Migrate + seed

# Testing
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Generate coverage report
```

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
psql -h localhost -U bountyexpo -d bountyexpo -c "SELECT 1;"

# Check connection pool
# View logs for "database" errors
```

### Redis Connection Issues

```bash
# Test Redis connection
redis-cli -h localhost -p 6379 ping

# Check cache stats
redis-cli -h localhost -p 6379 INFO stats
```

### Slow Queries

```bash
# Enable query logging in PostgreSQL
# Check logs for slow queries (> 100ms)
# Add indexes as needed
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## Related Documentation

- [API Reference](../../API_REFERENCE.md) - Complete API endpoint documentation
- [Architecture](../../ARCHITECTURE.md) - System architecture overview
- [Deployment](../../DEPLOYMENT.md) - Deployment guide
- [Main README](../../README.md) - Project overview

## Support

- **Issues**: [GitHub Issues](https://github.com/kodaksax/Bounty-production/issues)
- **Email**: api-support@bountyexpo.com
- **Docs**: https://docs.bountyexpo.com

---

**Built with ❤️ by the BountyExpo team**

