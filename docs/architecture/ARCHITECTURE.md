# BountyExpo Architecture

> Comprehensive architecture overview of the BountyExpo platform

## Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Architecture Layers](#architecture-layers)
- [Data Flow](#data-flow)
- [Component Architecture](#component-architecture)
- [Database Schema](#database-schema)
- [API Architecture](#api-architecture)
- [Authentication & Authorization](#authentication--authorization)
- [Payment Processing](#payment-processing)
- [Real-time Communication](#real-time-communication)
- [Caching Strategy](#caching-strategy)
- [Security Architecture](#security-architecture)
- [Scalability Considerations](#scalability-considerations)

---

## System Overview

BountyExpo is a mobile-first marketplace platform that connects people who need work done (Posters) with people who can do the work (Hunters). The platform facilitates the entire lifecycle: posting → matching → communication → completion → payment.

### High-Level Architecture

```
┌─────────────────┐
│  Mobile App     │ (React Native + Expo)
│  (iOS/Android)  │
└────────┬────────┘
         │ HTTPS/WSS
         ▼
┌─────────────────┐
│   API Gateway   │ (Fastify)
└────────┬────────┘
         │
    ┌────┴──────┬─────────┬────────────┐
    ▼           ▼         ▼            ▼
┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐
│ Supabase│ │PostgreSQL│ │  Redis │ │ Stripe │
│  Auth   │ │   DB    │ │ Cache  │ │   API  │
└─────────┘ └─────────┘ └─────────┘ └────────┘
```

### Key Design Principles

1. **Mobile-First**: Optimized for mobile devices with offline capabilities
2. **Security-First**: End-to-end encryption, secure payment handling
3. **Performance**: Redis caching, optimistic updates, lazy loading
4. **Scalability**: Stateless API, horizontal scaling, CDN integration
5. **Developer Experience**: Type-safe APIs, comprehensive testing, clear documentation

---

## Technology Stack

### Frontend (Mobile App)

| Technology | Purpose | Version |
|------------|---------|---------|
| React Native | Cross-platform mobile framework | 0.81+ |
| Expo | Development & deployment platform | 54+ |
| TypeScript | Type safety | 5.9+ |
| Expo Router | File-based navigation | 6+ |
| NativeWind | Tailwind CSS for React Native | 4+ |
| React Hook Form | Form management | 7+ |
| Zod | Runtime validation | 4+ |

### Backend (API Server)

| Technology | Purpose | Version |
|------------|---------|---------|
| Node.js | Runtime environment | 18+ |
| Fastify | Web framework | Latest |
| TypeScript | Type safety | 5.9+ |
| Drizzle ORM | Database ORM | 0.31+ |
| PostgreSQL | Primary database | 15+ |
| Redis | Caching & sessions | 7+ |
| Supabase | Authentication & real-time | Latest |

### Infrastructure & Services

| Service | Purpose |
|---------|---------|
| Stripe | Payment processing |
| Supabase | Authentication, database, storage |
| Redis | Caching layer |
| Docker | Development environment |
| Expo Application Services | Mobile builds & updates |

---

## Architecture Layers

### 1. Presentation Layer (Mobile App)

**Location**: `/app`, `/components`, `/lib/components`

**Responsibilities:**
- User interface rendering
- User input handling
- Navigation management
- Local state management
- Optimistic UI updates

**Key Patterns:**
- File-based routing with Expo Router
- Component composition
- Custom hooks for business logic
- Context providers for global state

**Structure:**
```
app/
  ├── (tabs)/           # Main tab navigation
  ├── (auth)/           # Authentication screens
  ├── bounty/           # Bounty-related screens
  ├── profile/          # Profile screens
  └── _layout.tsx       # Root layout

components/
  ├── ui/               # Reusable UI components
  ├── forms/            # Form components
  └── bounty/           # Bounty-specific components
```

---

### 2. Business Logic Layer

**Location**: `/lib/services`, `/hooks`

**Responsibilities:**
- Business rules enforcement
- Data transformation
- Client-side validation
- Error handling
- State management

**Key Services:**
- `bountyService.ts` - Bounty operations
- `messageService.ts` - Messaging logic
- `paymentService.ts` - Payment workflows
- `authService.ts` - Authentication flows

**Example Service:**
```typescript
// lib/services/bountyService.ts
export const bountyService = {
  async createBounty(data: BountyFormValues) {
    // Validate
    const validated = bountySchema.parse(data);
    
    // Transform
    const payload = transformToBountyPayload(validated);
    
    // Call API
    const bounty = await api.post('/bounties', payload);
    
    // Update cache
    queryClient.invalidateQueries(['bounties']);
    
    return bounty;
  }
};
```

---

### 3. API Layer (Backend)

**Location**: `/services/api/src`

**Responsibilities:**
- Request routing
- Authentication & authorization
- Input validation
- Business logic orchestration
- Database operations
- External service integration

**Structure:**
```
services/api/src/
  ├── routes/           # API endpoints
  ├── middleware/       # Request processing
  ├── services/         # Business logic
  ├── db/               # Database layer
  └── utils/            # Utilities
```

**Middleware Stack:**
```
Request
  ↓
Rate Limiting
  ↓
CORS
  ↓
Body Parsing
  ↓
Authentication
  ↓
Request Validation
  ↓
Route Handler
  ↓
Error Handler
  ↓
Response
```

---

### 4. Data Layer

**Location**: `/services/api/src/db`

**Responsibilities:**
- Database schema management
- Query optimization
- Transaction management
- Cache invalidation
- Data migrations

**Technologies:**
- **PostgreSQL**: Primary data store
- **Drizzle ORM**: Type-safe queries
- **Redis**: Caching & pub/sub
- **Supabase**: Auth & real-time

---

## Data Flow

### Bounty Creation Flow

```
User Input (Mobile)
  ↓
Form Validation (Client)
  ↓
Optimistic UI Update
  ↓
API Request (/bounties POST)
  ↓
JWT Validation
  ↓
Schema Validation (Zod)
  ↓
Database Insert (PostgreSQL)
  ↓
Cache Invalidation (Redis)
  ↓
Response to Client
  ↓
UI Confirmation
```

### Bounty Acceptance Flow

```
Hunter Accepts Bounty
  ↓
API Request (/bounties/:id/accept POST)
  ↓
Authorization Check (not own bounty)
  ↓
Transaction Start
  ├─ Update Bounty Status
  ├─ Create Escrow Transaction
  ├─ Create Conversation
  └─ Send Notifications
  ↓
Transaction Commit
  ↓
Real-time Event Publish (WebSocket)
  ↓
Cache Invalidation
  ↓
Response to Client
  ↓
UI Update (both parties)
```

### Payment Flow

```
User Initiates Payment
  ↓
Create Payment Intent (Stripe API)
  ↓
Stripe SDK (Client) - Card Input
  ↓
Payment Confirmation
  ↓
Stripe Webhook (/webhooks/stripe)
  ↓
Verify Webhook Signature
  ↓
Update Wallet Balance (PostgreSQL)
  ↓
Create Transaction Record
  ↓
Send Notification
  ↓
User Sees Updated Balance
```

---

## Component Architecture

### Mobile App Component Hierarchy

```
<App>
  <ThemeProvider>
    <AuthProvider>
      <StripeProvider>
        <NavigationContainer>
          <RootLayout>
            <TabNavigator>
              <DashboardScreen />
              <PostingsScreen />
              <MessengerScreen />
              <WalletScreen />
              <ProfileScreen />
            </TabNavigator>
          </RootLayout>
        </NavigationContainer>
      </StripeProvider>
    </AuthProvider>
  </ThemeProvider>
</App>
```

### Key Components

#### BountyCard
**Purpose**: Display bounty summary in lists
**Props**: `bounty`, `onPress`, `showStatus`
**State**: None (presentational)
**Example**:
```tsx
<BountyCard
  bounty={bounty}
  onPress={() => router.push(`/bounty/${bounty.id}`)}
  showStatus={true}
/>
```

#### BountyDetailModal
**Purpose**: Show full bounty details with actions
**Props**: `bountyId`, `visible`, `onClose`
**State**: Loading, bounty data, action states
**Features**: Accept, cancel, complete actions

#### ConversationList
**Purpose**: List all user conversations
**Props**: None (gets data from context)
**State**: Conversations, loading, search filter
**Real-time**: Updates on new messages

---

## Database Schema

### Core Tables

#### users
Primary user account table.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  balance INTEGER DEFAULT 0,
  age_verified BOOLEAN DEFAULT FALSE,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  stripe_connect_account_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### bounties
Job postings.

```sql
CREATE TABLE bounties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) >= 10),
  description TEXT NOT NULL CHECK (length(description) >= 50),
  amount INTEGER DEFAULT 0 CHECK (amount >= 0),
  is_for_honor BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'archived')),
  location TEXT,
  category TEXT,
  skills_required TEXT[],
  accepted_by UUID REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_creator ON bounties(creator_id);
CREATE INDEX idx_bounties_accepted_by ON bounties(accepted_by);
CREATE INDEX idx_bounties_category ON bounties(category);
```

#### bounty_requests
Applications to work on bounties.

```sql
CREATE TABLE bounty_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id UUID REFERENCES bounties(id) ON DELETE CASCADE,
  hunter_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  proposal TEXT NOT NULL,
  estimated_duration TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bounty_id, hunter_id)
);
```

#### wallet_transactions
Financial transaction history.

```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'escrow', 'release', 'refund')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  bounty_id UUID REFERENCES bounties(id),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_user ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_type ON wallet_transactions(type);
```

#### conversations
Chat conversations.

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id UUID REFERENCES bounties(id),
  name TEXT NOT NULL,
  is_group BOOLEAN DEFAULT FALSE,
  participant_ids UUID[] NOT NULL,
  last_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### messages
Chat messages.

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  text TEXT NOT NULL CHECK (length(text) <= 5000),
  reply_to UUID REFERENCES messages(id),
  media_url TEXT,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
```

#### notifications
User notifications.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
```

### Row Level Security (RLS)

Supabase RLS policies enforce data access rules:

```sql
-- Users can read their own profile
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Bounties are publicly readable
CREATE POLICY "Bounties are publicly readable"
  ON bounties FOR SELECT
  USING (true);

-- Only creators can update their bounties
CREATE POLICY "Creators can update own bounties"
  ON bounties FOR UPDATE
  USING (auth.uid() = creator_id);
```

---

## API Architecture

### RESTful Design

The API follows RESTful principles:

- **Resources**: Nouns represent entities (bounties, users, messages)
- **HTTP Methods**: Standard CRUD operations
- **Status Codes**: Semantic HTTP status codes
- **Versioning**: URL-based versioning (future: /v2/)

### Request/Response Format

#### Standard Request
```http
POST /bounties HTTP/1.1
Host: api.bountyexpo.com
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "title": "Build a landing page",
  "description": "Need a professional landing page...",
  "amount": 50000
}
```

#### Standard Response (Success)
```http
HTTP/1.1 201 Created
Content-Type: application/json
X-Request-Id: abc-123-def

{
  "id": "uuid",
  "title": "Build a landing page",
  "status": "open",
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### Standard Response (Error)
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Validation Error",
  "message": "Title must be at least 10 characters",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "title",
    "constraint": "minLength"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Validation Pipeline

```typescript
// 1. Schema Definition (Zod)
const createBountySchema = z.object({
  title: z.string().min(10).max(200),
  description: z.string().min(50).max(5000),
  amount: z.number().min(0)
});

// 2. Route Handler
fastify.post('/bounties', {
  preHandler: authMiddleware,
  schema: {
    body: toJsonSchema(createBountySchema)
  }
}, async (request, reply) => {
  // 3. Validation (automatic via schema)
  const data = createBountySchema.parse(request.body);
  
  // 4. Business logic
  const bounty = await createBounty(data, request.userId);
  
  // 5. Response
  return bounty;
});
```

---

## Authentication & Authorization

### Authentication Flow

#### Sign Up
```
1. User enters email/password
2. Client validates input
3. POST /auth/register
4. Supabase creates auth user
5. API creates user profile
6. Return JWT + refresh token
7. Store tokens securely (SecureStore)
```

#### Sign In
```
1. User enters credentials
2. POST /auth/sign-in
3. Supabase validates credentials
4. Return JWT + refresh token
5. Store tokens
6. Redirect to main app
```

#### Token Refresh
```
1. Access token expires
2. Intercept API error (401)
3. POST /auth/refresh with refresh token
4. Get new access token
5. Retry original request
6. Update stored token
```

### Authorization Patterns

#### Resource Ownership
```typescript
// Only bounty creator can update
if (bounty.creator_id !== request.userId) {
  throw new AuthorizationError('Not authorized');
}
```

#### Role-Based Access Control (RBAC)
```typescript
// Admin-only endpoint
const requireAdmin = async (request: AuthenticatedRequest) => {
  const user = await getUser(request.userId);
  if (user.role !== 'admin') {
    throw new AuthorizationError('Admin access required');
  }
};
```

#### Row-Level Security (RLS)
Enforced at database level via Supabase policies.

---

## Payment Processing

### Stripe Integration Architecture

```
Mobile App
  ↓
Stripe SDK (Card Input)
  ↓
BountyExpo API (/payments/create-payment-intent)
  ↓
Stripe API (Create PaymentIntent)
  ↓
Return clientSecret
  ↓
Stripe SDK (Confirm Payment)
  ↓
Stripe Webhook → BountyExpo API
  ↓
Update Database
  ↓
Notify User
```

### Payment Intent Lifecycle

1. **Created**: Payment intent created with amount
2. **Requires Payment Method**: Awaiting card details
3. **Requires Confirmation**: Card attached, awaiting confirmation
4. **Processing**: Payment being processed
5. **Succeeded**: Payment completed successfully
6. **Canceled**: Payment canceled by user or system

### Escrow System

#### Escrow Creation
```typescript
async function createEscrow(bounty: Bounty, hunter: User) {
  await db.transaction(async (tx) => {
    // 1. Deduct from poster's balance
    await tx.update(users)
      .set({ balance: sql`${users.balance} - ${bounty.amount}` })
      .where(eq(users.id, bounty.creator_id));
    
    // 2. Create escrow transaction
    await tx.insert(walletTransactions).values({
      user_id: bounty.creator_id,
      type: 'escrow',
      amount: -bounty.amount,
      bounty_id: bounty.id,
      status: 'completed'
    });
    
    // 3. Update bounty status
    await tx.update(bounties)
      .set({ status: 'in_progress', accepted_by: hunter.id })
      .where(eq(bounties.id, bounty.id));
  });
}
```

#### Escrow Release
```typescript
async function releaseEscrow(bounty: Bounty) {
  await db.transaction(async (tx) => {
    // 1. Add to hunter's balance
    await tx.update(users)
      .set({ balance: sql`${users.balance} + ${bounty.amount}` })
      .where(eq(users.id, bounty.accepted_by));
    
    // 2. Create release transaction
    await tx.insert(walletTransactions).values({
      user_id: bounty.accepted_by,
      type: 'release',
      amount: bounty.amount,
      bounty_id: bounty.id,
      status: 'completed'
    });
    
    // 3. Update bounty status
    await tx.update(bounties)
      .set({ status: 'completed' })
      .where(eq(bounties.id, bounty.id));
  });
}
```

---

## Real-time Communication

### WebSocket Architecture

```
Client
  ↓
WebSocket Connection (ws://api.bountyexpo.com/events/subscribe)
  ↓
Authentication (JWT in query param)
  ↓
Subscribe to User's Events
  ↓
Event Stream (server → client)
```

### Event Types

- `bounty.status` - Bounty status changed
- `message.new` - New chat message
- `notification.new` - New notification
- `payment.completed` - Payment succeeded
- `request.new` - New bounty request

### Event Publishing

```typescript
// Server-side event publishing
import { eventEmitter } from './services/events';

// Publish event
eventEmitter.emit('bounty.status', {
  bountyId: bounty.id,
  status: 'in_progress',
  timestamp: new Date().toISOString()
});

// Broadcast to specific users
eventEmitter.emitToUsers([posterId, hunterId], 'bounty.accepted', data);
```

### Client-side Subscription

```typescript
// Mobile app
import { useWebSocket } from './hooks/useWebSocket';

function BountyDetail({ bountyId }) {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    const unsubscribe = subscribe('bounty.status', (event) => {
      if (event.bountyId === bountyId) {
        // Update UI
        refetch();
      }
    });
    
    return unsubscribe;
  }, [bountyId]);
}
```

---

## Caching Strategy

### Three-Layer Cache

1. **Client Cache** (React Query)
   - TTL: 5-30 minutes
   - Optimistic updates
   - Background refresh

2. **Redis Cache** (Server)
   - TTL: 1-5 minutes
   - Query result caching
   - Session storage

3. **CDN Cache** (Static Assets)
   - TTL: 24 hours+
   - Images, videos, documents

### Cache Keys

```typescript
// User profile
`profile:${userId}`

// Individual bounty
`bounty:${bountyId}`

// Bounty list
`bounty-list:status:${status}:page:${page}`

// User's conversations
`conversations:${userId}`
```

### Cache Invalidation

```typescript
// On bounty update
await redis.del(`bounty:${bountyId}`);
await redis.del(`bounty-list:*`); // Invalidate all lists

// On profile update
await redis.del(`profile:${userId}`);
```

### Cache-Aside Pattern

```typescript
async function getBounty(id: string) {
  // 1. Check cache
  const cached = await redis.get(`bounty:${id}`);
  if (cached) return JSON.parse(cached);
  
  // 2. Query database
  const bounty = await db.query.bounties.findFirst({
    where: eq(bounties.id, id)
  });
  
  // 3. Store in cache
  if (bounty) {
    await redis.setex(`bounty:${id}`, 180, JSON.stringify(bounty));
  }
  
  return bounty;
}
```

---

## Security Architecture

### Defense in Depth

1. **Network Layer**
   - HTTPS only
   - Rate limiting
   - DDoS protection

2. **Application Layer**
   - JWT authentication
   - Input validation
   - SQL injection prevention (ORM)
   - XSS prevention

3. **Data Layer**
   - Encryption at rest
   - Row-level security
   - Audit logging

### Security Headers

```typescript
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
});
```

### Input Sanitization

```typescript
import { sanitizeHtml } from './utils/sanitize';

// Before storing
const sanitizedDescription = sanitizeHtml(description);

// Schema validation
const schema = z.object({
  description: z.string()
    .max(5000)
    .transform(sanitizeHtml)
});
```

### Sensitive Data Handling

```typescript
// Never expose in API responses
const SENSITIVE_FIELDS = [
  'stripe_customer_id',
  'stripe_connect_account_id',
  'password_hash',
  'refresh_token'
];

function sanitizeUser(user: User) {
  const sanitized = { ...user };
  SENSITIVE_FIELDS.forEach(field => {
    delete sanitized[field];
  });
  return sanitized;
}
```

---

## Scalability Considerations

### Horizontal Scaling

- **Stateless API**: No server-side session state
- **Load Balancing**: Round-robin across API instances
- **Database Read Replicas**: Read-heavy queries to replicas
- **Redis Cluster**: Distributed cache across nodes

### Database Optimization

- **Indexing**: Strategic indexes on foreign keys and query columns
- **Partitioning**: Large tables partitioned by date
- **Connection Pooling**: Reuse database connections
- **Query Optimization**: Use EXPLAIN to optimize slow queries

### Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| API Response Time (p95) | < 200ms | 150ms |
| Database Query Time (p95) | < 50ms | 35ms |
| Cache Hit Rate | > 80% | 85% |
| WebSocket Latency | < 100ms | 75ms |

### Future Enhancements

1. **Microservices**: Split monolith into services
2. **Message Queue**: Async job processing (Bull/RabbitMQ)
3. **CDN**: Global content delivery
4. **GraphQL**: More efficient data fetching
5. **Service Mesh**: Inter-service communication (Istio)

---

## Deployment Architecture

### Development Environment

```
Docker Compose
  ├─ PostgreSQL (port 5432)
  ├─ Redis (port 6379)
  └─ Stripe Mock (port 12111)

Local Processes
  ├─ API Server (port 3001)
  └─ Expo Dev Server (port 8081)
```

### Production Environment

```
┌──────────────────┐
│   Load Balancer  │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ API #1 │ │ API #2 │
└────┬───┘ └───┬────┘
     └────┬────┘
          │
  ┌───────┴────────┬──────────┐
  ▼                ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│PostgreSQL│ │  Redis   │ │ Supabase │
│ Cluster  │ │ Cluster  │ │  Cloud   │
└──────────┘ └──────────┘ └──────────┘
```

---

## Monitoring & Observability

### Logging

- **Structure**: JSON logs for machine parsing
- **Levels**: ERROR, WARN, INFO, DEBUG
- **Correlation**: Request ID tracking across services

### Metrics

- **System**: CPU, memory, disk, network
- **Application**: Request rate, error rate, latency
- **Business**: Bounties created, payments processed

### Alerting

- **High Error Rate**: > 5% errors for 5 minutes
- **Slow Responses**: p95 latency > 500ms
- **Database Issues**: Connection pool exhausted
- **Payment Failures**: Stripe webhook failures

---

## Diagrams

### Entity Relationship Diagram

```
┌─────────┐       ┌──────────────┐       ┌──────────┐
│  users  │───────│   bounties   │───────│ requests │
└─────────┘       └──────────────┘       └──────────┘
     │                    │
     │                    │
     ▼                    ▼
┌─────────────────┐  ┌──────────────┐
│ wallet_txns     │  │conversations │
└─────────────────┘  └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   messages   │
                     └──────────────┘
```

---

## References

- [API Reference](./API_REFERENCE.md)
- [Database Migrations](./services/api/migrations/)
- [Type Definitions](./lib/types.ts)
- [Deployment Guide](./DEPLOYMENT.md)

---

**Last Updated**: 2024-01-07
