# BountyExpo API Reference

> Comprehensive reference for all BountyExpo API endpoints

## Table of Contents

- [Overview](#overview)
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [API Endpoints](#api-endpoints)
  - [Authentication](#authentication-endpoints)
  - [User Profiles](#profile-endpoints)
  - [Bounties](#bounty-endpoints)
  - [Bounty Requests](#bounty-request-endpoints)
  - [Payments](#payment-endpoints)
  - [Wallet](#wallet-endpoints)
  - [Messaging](#messaging-endpoints)
  - [Notifications](#notification-endpoints)
  - [Webhooks](#webhook-endpoints)
  - [Admin](#admin-endpoints)
  - [Analytics](#analytics-endpoints)
  - [Health & Monitoring](#health-endpoints)

---

## Overview

The BountyExpo API is a RESTful API built with Fastify and TypeScript. It provides endpoints for managing bounties, user profiles, payments, messaging, and more.

**Key Features:**
- JWT-based authentication via Supabase
- Comprehensive input validation with Zod schemas
- Redis caching for improved performance
- Real-time updates via WebSocket
- Stripe integration for payments
- Rate limiting for security

---

## Base URL

```
Development: http://localhost:3001
Production: https://api.bountyexpo.com
```

---

## Authentication

Most endpoints require authentication via Supabase JWT tokens.

### Authorization Header

Include the JWT token in the `Authorization` header:

```http
Authorization: Bearer <your-jwt-token>
```

### Token Acquisition

Tokens are obtained through the authentication endpoints (`/auth/sign-in` or `/auth/register`).

### Token Validation

The API validates:
- Token signature
- Token expiration
- User existence in database

---

## Error Handling

The API returns standardized error responses:

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {},
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Common HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request succeeded |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource conflict (e.g., duplicate) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | External service failure |

### Error Codes

- `VALIDATION_ERROR` - Input validation failed
- `AUTHENTICATION_ERROR` - Authentication failed
- `AUTHORIZATION_ERROR` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `CONFLICT` - Resource conflict
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `EXTERNAL_SERVICE_ERROR` - External service error

---

## Rate Limiting

The API implements rate limiting to prevent abuse:

### Authentication Endpoints

- **Limit**: 5 requests per 15 minutes per IP
- **Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Reset time (ISO 8601)
  - `Retry-After`: Seconds until retry (when limited)

### General Endpoints

- **Limit**: 100 requests per minute per user
- **Headers**: Same as authentication endpoints

---

## API Endpoints

### Authentication Endpoints

#### POST /auth/register

Register a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "username": "johndoe"
}
```

**Validation:**
- Email: Valid email format
- Password: Minimum 8 characters
- Username: 3-24 characters, alphanumeric + underscores only

**Response:** `201 Created`
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe"
  },
  "session": {
    "access_token": "jwt-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600,
    "expires_at": 1234567890
  }
}
```

**Errors:**
- `409` - Email already registered
- `429` - Too many registration attempts

---

#### POST /auth/sign-in

Sign in to an existing account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** `200 OK`
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe"
  },
  "session": {
    "access_token": "jwt-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600,
    "expires_at": 1234567890
  }
}
```

**Errors:**
- `401` - Invalid credentials
- `429` - Too many sign-in attempts

---

#### POST /auth/sign-out

Sign out the current user.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "message": "Successfully signed out"
}
```

---

#### POST /auth/refresh

Refresh an expired access token.

**Request:**
```json
{
  "refresh_token": "refresh-token"
}
```

**Response:** `200 OK`
```json
{
  "session": {
    "access_token": "new-jwt-token",
    "refresh_token": "new-refresh-token",
    "expires_in": 3600,
    "expires_at": 1234567890
  }
}
```

---

#### GET /auth/me

Get current authenticated user profile.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "johndoe",
  "avatar_url": "https://...",
  "bio": "Software developer",
  "balance": 10000,
  "age_verified": true,
  "onboarding_completed": true,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

---

### Profile Endpoints

#### GET /profiles/:userId

Get a user's public profile.

**Authentication:** Optional (more data returned if authenticated)

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "username": "johndoe",
  "avatar_url": "https://...",
  "bio": "Software developer",
  "age_verified": true,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Owner-only fields** (when viewing own profile):
- `email`
- `balance`
- `phone`
- `onboarding_completed`
- `withdrawal_count`
- `cancellation_count`

**Errors:**
- `404` - User not found

---

#### PATCH /profiles/:userId

Update user profile.

**Authentication:** Required (must be profile owner)

**Request:**
```json
{
  "username": "newusername",
  "bio": "Updated bio",
  "avatar_url": "https://...",
  "phone": "+1234567890"
}
```

**Validation:**
- Username: 3-50 characters, alphanumeric + underscores
- Bio: Maximum 500 characters
- Avatar URL: Valid URL format

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "username": "newusername",
  "bio": "Updated bio",
  "avatar_url": "https://...",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Errors:**
- `401` - Not authenticated
- `403` - Not authorized to update this profile
- `409` - Username already taken

---

#### DELETE /profiles/:userId

Delete user account.

**Authentication:** Required (must be profile owner)

**Response:** `200 OK`
```json
{
  "message": "Profile deleted successfully",
  "userId": "uuid"
}
```

**Note:** This is a soft delete. User data is anonymized and marked as deleted.

---

### Bounty Endpoints

#### POST /bounties

Create a new bounty.

**Authentication:** Required

**Request:**
```json
{
  "title": "Build a mobile app landing page",
  "description": "Need a professional landing page for my mobile app with responsive design...",
  "amount": 50000,
  "isForHonor": false,
  "location": "Remote",
  "category": "design",
  "skills_required": ["HTML", "CSS", "React"],
  "due_date": "2024-12-31T23:59:59Z"
}
```

**Validation:**
- Title: 10-200 characters
- Description: 50-5000 characters
- Amount: Non-negative (in cents)
- isForHonor: If true, amount must be 0
- Due date: ISO 8601 datetime (optional)

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "creator_id": "uuid",
  "title": "Build a mobile app landing page",
  "description": "Need a professional landing page...",
  "amount": 50000,
  "isForHonor": false,
  "status": "open",
  "location": "Remote",
  "category": "design",
  "skills_required": ["HTML", "CSS", "React"],
  "due_date": "2024-12-31T23:59:59Z",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

---

#### GET /bounties

List bounties with filters and pagination.

**Authentication:** Optional

**Query Parameters:**
- `status` - Filter by status: `open`, `in_progress`, `completed`, `archived`, `all` (default: `open`)
- `category` - Filter by category
- `user_id` - Filter by creator
- `accepted_by` - Filter by hunter
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `sortBy` - Sort field: `created_at`, `amount`, `due_date` (default: `created_at`)
- `sortOrder` - Sort order: `asc`, `desc` (default: `desc`)

**Response:** `200 OK`
```json
{
  "bounties": [
    {
      "id": "uuid",
      "creator_id": "uuid",
      "title": "Build a mobile app landing page",
      "description": "Need a professional landing page...",
      "amount": 50000,
      "status": "open",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3,
    "hasMore": true
  }
}
```

**Cache:** Results cached for 60 seconds (bounty list cache)

---

#### GET /bounties/:bountyId

Get a specific bounty by ID.

**Authentication:** Optional

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "creator_id": "uuid",
  "title": "Build a mobile app landing page",
  "description": "Need a professional landing page...",
  "amount": 50000,
  "isForHonor": false,
  "status": "open",
  "location": "Remote",
  "category": "design",
  "skills_required": ["HTML", "CSS", "React"],
  "due_date": "2024-12-31T23:59:59Z",
  "accepted_by": null,
  "accepted_at": null,
  "completed_at": null,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Cache:** Results cached for 180 seconds (individual bounty cache)

**Errors:**
- `404` - Bounty not found

---

#### PATCH /bounties/:bountyId

Update a bounty.

**Authentication:** Required (must be bounty creator)

**Request:**
```json
{
  "title": "Updated title",
  "description": "Updated description",
  "amount": 60000
}
```

**Note:** Only bounties with status `open` can be updated.

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "title": "Updated title",
  "description": "Updated description",
  "amount": 60000,
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Cache Invalidation:** Invalidates bounty cache and list caches

**Errors:**
- `403` - Not authorized to update this bounty
- `409` - Bounty status does not allow updates

---

#### DELETE /bounties/:bountyId

Delete (archive) a bounty.

**Authentication:** Required (must be bounty creator)

**Response:** `200 OK`
```json
{
  "message": "Bounty archived successfully",
  "bountyId": "uuid"
}
```

**Note:** Bounties are soft-deleted (status changed to `archived`)

**Cache Invalidation:** Invalidates bounty cache and list caches

---

#### POST /bounties/:bountyId/accept

Accept a bounty (hunter claims the work).

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "in_progress",
  "accepted_by": "uuid",
  "accepted_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Side Effects:**
- Creates escrow transaction if bounty has amount > 0
- Sends notification to bounty creator
- Publishes real-time event

**Cache Invalidation:** Invalidates bounty cache and list caches

**Errors:**
- `403` - Cannot accept own bounty
- `409` - Bounty already accepted or not open

---

#### POST /bounties/:bountyId/complete

Mark a bounty as completed.

**Authentication:** Required (must be bounty creator)

**Request:**
```json
{
  "rating": 5,
  "comment": "Great work!"
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "completed",
  "completed_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Side Effects:**
- Releases escrow funds to hunter
- Creates rating for hunter
- Sends notification to hunter
- Publishes real-time event

**Cache Invalidation:** Invalidates bounty cache and list caches

---

#### POST /bounties/:bountyId/cancel

Cancel a bounty.

**Authentication:** Required (must be bounty creator or accepted hunter)

**Request:**
```json
{
  "reason": "Project requirements changed",
  "refund_percentage": 100
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "archived",
  "cancellation": {
    "id": "uuid",
    "reason": "Project requirements changed",
    "refund_percentage": 100,
    "status": "accepted"
  }
}
```

**Side Effects:**
- Refunds escrow based on refund_percentage
- Creates cancellation record
- Sends notifications

---

### Bounty Request Endpoints

#### POST /bounty-requests

Create a request to work on a bounty.

**Authentication:** Required

**Request:**
```json
{
  "bountyId": "uuid",
  "proposal": "I have 5 years of experience in web development...",
  "estimated_duration": "3 days"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "bountyId": "uuid",
  "hunterId": "uuid",
  "status": "pending",
  "proposal": "I have 5 years of experience...",
  "estimated_duration": "3 days",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Side Effects:**
- Sends notification to bounty creator

**Errors:**
- `403` - Cannot request own bounty
- `409` - Already have pending request for this bounty

---

#### GET /bounty-requests

List bounty requests.

**Authentication:** Required

**Query Parameters:**
- `bountyId` - Filter by bounty
- `status` - Filter by status: `pending`, `accepted`, `rejected`
- `direction` - `sent` (requests you made) or `received` (requests on your bounties)

**Response:** `200 OK`
```json
{
  "requests": [
    {
      "id": "uuid",
      "bountyId": "uuid",
      "hunterId": "uuid",
      "status": "pending",
      "proposal": "I have 5 years...",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

#### POST /bounty-requests/:requestId/accept

Accept a bounty request.

**Authentication:** Required (must be bounty creator)

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "accepted",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Side Effects:**
- Updates bounty status to `in_progress`
- Accepts the hunter
- Rejects all other pending requests
- Creates escrow transaction
- Sends notifications

---

#### POST /bounty-requests/:requestId/reject

Reject a bounty request.

**Authentication:** Required (must be bounty creator)

**Request:**
```json
{
  "reason": "Looking for someone with more experience"
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "rejected",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

---

### Payment Endpoints

#### POST /payments/create-payment-intent

Create a Stripe payment intent for adding funds.

**Authentication:** Required

**Request:**
```json
{
  "amountCents": 5000,
  "currency": "usd",
  "metadata": {
    "purpose": "wallet_deposit"
  },
  "description": "Add funds to wallet",
  "bountyId": "uuid"
}
```

**Validation:**
- Amount: Minimum 50 cents ($0.50)
- Currency: Lowercase string (default: "usd")

**Response:** `200 OK`
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx",
  "amount": 5000,
  "currency": "usd"
}
```

**Usage:** Use `clientSecret` with Stripe SDK to complete payment on client

---

#### POST /payments/confirm

Confirm a payment intent.

**Authentication:** Required

**Request:**
```json
{
  "paymentIntentId": "pi_xxx",
  "paymentMethodId": "pm_xxx"
}
```

**Response:** `200 OK`
```json
{
  "id": "pi_xxx",
  "status": "succeeded",
  "amount": 5000,
  "currency": "usd"
}
```

**Side Effects:**
- Updates wallet balance on success
- Creates wallet transaction record

---

#### GET /payments/methods

List user's saved payment methods.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "paymentMethods": [
    {
      "id": "pm_xxx",
      "type": "card",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2025
      },
      "created": 1234567890
    }
  ]
}
```

---

#### POST /payments/methods

Attach a payment method to user.

**Authentication:** Required

**Request:**
```json
{
  "paymentMethodId": "pm_xxx"
}
```

**Response:** `200 OK`
```json
{
  "id": "pm_xxx",
  "type": "card",
  "card": {
    "brand": "visa",
    "last4": "4242"
  }
}
```

---

#### DELETE /payments/methods/:paymentMethodId

Detach a payment method.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "id": "pm_xxx",
  "detached": true
}
```

---

#### POST /payments/:paymentIntentId/cancel

Cancel a payment intent.

**Authentication:** Required

**Request:**
```json
{
  "reason": "User requested cancellation"
}
```

**Response:** `200 OK`
```json
{
  "id": "pi_xxx",
  "status": "canceled"
}
```

---

### Wallet Endpoints

#### GET /wallet/balance

Get current wallet balance.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "balance": 10000,
  "currency": "usd",
  "available": 10000,
  "pending": 0
}
```

---

#### GET /wallet/transactions

List wallet transactions.

**Authentication:** Required

**Query Parameters:**
- `type` - Filter by type: `deposit`, `withdrawal`, `escrow`, `release`, `refund`
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `startDate` - Filter by start date (ISO 8601)
- `endDate` - Filter by end date (ISO 8601)

**Response:** `200 OK`
```json
{
  "transactions": [
    {
      "id": "uuid",
      "type": "deposit",
      "amount": 5000,
      "balance_after": 15000,
      "status": "completed",
      "description": "Added funds via Stripe",
      "metadata": {
        "payment_intent_id": "pi_xxx"
      },
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42
  }
}
```

---

#### POST /wallet/withdraw

Withdraw funds from wallet.

**Authentication:** Required

**Request:**
```json
{
  "amount": 5000,
  "paymentMethodId": "pm_xxx",
  "description": "Withdraw to bank account"
}
```

**Validation:**
- Amount must not exceed available balance
- Minimum withdrawal: $10.00

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "type": "withdrawal",
  "amount": 5000,
  "status": "pending",
  "estimated_arrival": "2024-01-04T00:00:00Z",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Errors:**
- `400` - Insufficient balance
- `400` - Amount below minimum

---

### Messaging Endpoints

#### POST /messages

Send a message in a conversation.

**Authentication:** Required

**Request:**
```json
{
  "conversationId": "uuid",
  "text": "Hello! I'm interested in your bounty.",
  "replyTo": "uuid",
  "mediaUrl": "https://..."
}
```

**Validation:**
- Text: Maximum 5000 characters
- Must be participant in conversation

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "senderId": "uuid",
  "text": "Hello! I'm interested...",
  "status": "sent",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Side Effects:**
- Sends push notification to other participants
- Updates conversation's last message and timestamp

---

#### GET /messages

List messages in a conversation.

**Authentication:** Required

**Query Parameters:**
- `conversationId` - Required, conversation ID
- `before` - Cursor for pagination (message ID)
- `limit` - Items per page (default: 50, max: 100)

**Response:** `200 OK`
```json
{
  "messages": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "senderId": "uuid",
      "text": "Hello!",
      "status": "read",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "hasMore": true,
  "nextCursor": "uuid"
}
```

---

#### GET /conversations

List user's conversations.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "conversations": [
    {
      "id": "uuid",
      "name": "Bounty: Website Design",
      "bountyId": "uuid",
      "isGroup": false,
      "participantIds": ["uuid", "uuid"],
      "lastMessage": "Sounds good!",
      "unread": 3,
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

#### POST /conversations

Create a new conversation.

**Authentication:** Required

**Request:**
```json
{
  "participantIds": ["uuid"],
  "bountyId": "uuid",
  "name": "Project Discussion"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "Project Discussion",
  "bountyId": "uuid",
  "participantIds": ["uuid", "uuid"],
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

#### PATCH /messages/:messageId/read

Mark a message as read.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "read"
}
```

---

### Notification Endpoints

#### GET /notifications

List user's notifications.

**Authentication:** Required

**Query Parameters:**
- `read` - Filter by read status: `true`, `false`, `all` (default: `all`)
- `type` - Filter by notification type
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)

**Response:** `200 OK`
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "application",
      "title": "New application on your bounty",
      "body": "John Doe applied to your bounty 'Website Design'",
      "read": false,
      "data": {
        "bountyId": "uuid",
        "userId": "uuid"
      },
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "total": 15,
    "unreadCount": 5
  }
}
```

---

#### POST /notifications/:notificationId/read

Mark a notification as read.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "read": true
}
```

---

#### POST /notifications/read-all

Mark all notifications as read.

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "updated": 5
}
```

---

#### POST /notifications/register-token

Register device token for push notifications.

**Authentication:** Required

**Request:**
```json
{
  "token": "ExponentPushToken[xxx]",
  "platform": "ios"
}
```

**Response:** `200 OK`
```json
{
  "message": "Token registered successfully"
}
```

---

### Webhook Endpoints

#### POST /webhooks/stripe

Stripe webhook handler for payment events.

**Authentication:** Stripe signature verification (no JWT required)

**Headers:**
- `Stripe-Signature` - Webhook signature

**Request:** Raw Stripe event payload

**Supported Events:**
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `account.updated`
- `transfer.created`
- `transfer.updated`

**Response:** `200 OK`
```json
{
  "received": true
}
```

**Side Effects:**
- Updates wallet balance on successful payments
- Creates transaction records
- Sends user notifications

---

### Admin Endpoints

**Note:** All admin endpoints require authentication with admin privileges.

#### GET /admin/users

List all users (admin only).

**Authentication:** Required (admin)

**Query Parameters:**
- `page` - Page number
- `limit` - Items per page
- `search` - Search by username or email
- `status` - Filter by status

**Response:** `200 OK`
```json
{
  "users": [...],
  "pagination": {...}
}
```

---

#### GET /admin/bounties

List all bounties (admin only).

**Authentication:** Required (admin)

**Response:** Similar to GET /bounties but includes all bounties regardless of status

---

#### POST /admin/bounties/:bountyId/moderate

Moderate a bounty (admin only).

**Authentication:** Required (admin)

**Request:**
```json
{
  "action": "remove",
  "reason": "Violates terms of service"
}
```

**Response:** `200 OK`

---

### Analytics Endpoints

#### GET /analytics/overview

Get analytics overview.

**Authentication:** Required

**Query Parameters:**
- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)

**Response:** `200 OK`
```json
{
  "bounties": {
    "total": 42,
    "open": 15,
    "in_progress": 12,
    "completed": 15
  },
  "transactions": {
    "total_volume": 500000,
    "total_count": 125,
    "avg_amount": 4000
  },
  "users": {
    "total": 1000,
    "active": 250
  }
}
```

---

### Health Endpoints

#### GET /health

Health check endpoint.

**Authentication:** None

**Response:** `200 OK`
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "supabase": "healthy"
  },
  "version": "1.0.0"
}
```

---

#### GET /metrics

Prometheus-style metrics.

**Authentication:** None (consider restricting in production)

**Response:** `200 OK` (Prometheus format)

---

## Real-time Events

The API supports real-time updates via WebSocket for certain events.

### WebSocket Connection

```
ws://localhost:3001/events/subscribe
```

### Event Types

- `bounty.status` - Bounty status changed
- `message.new` - New message in conversation
- `notification.new` - New notification

### Event Format

```json
{
  "type": "bounty.status",
  "id": "bounty-id",
  "status": "in_progress",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

---

## Caching

The API uses Redis caching to improve performance:

### Cached Resources

| Resource | TTL | Invalidation Triggers |
|----------|-----|----------------------|
| User Profiles | 5 minutes | Profile update |
| Individual Bounties | 3 minutes | Bounty update/delete |
| Bounty Lists | 1 minute | Any bounty change |

### Cache Headers

Responses include cache-related headers:
- `X-Cache-Hit`: `true` or `false`
- `X-Cache-TTL`: Remaining TTL in seconds

---

## SDK & Client Libraries

### JavaScript/TypeScript

```typescript
import { BountyExpoClient } from '@bountyexpo/api-client';

const client = new BountyExpoClient({
  baseURL: 'http://localhost:3001',
  token: 'your-jwt-token'
});

const bounties = await client.bounties.list({ status: 'open' });
```

---

## Support

For API support:
- **Documentation**: https://docs.bountyexpo.com
- **Issues**: https://github.com/kodaksax/bountyexpo/issues
- **Email**: api-support@bountyexpo.com

---

## Changelog

### Version 1.0.0 (2024-01-01)
- Initial API release
- Core endpoints for bounties, profiles, payments
- Authentication via Supabase JWT
- Redis caching
- Real-time WebSocket events
