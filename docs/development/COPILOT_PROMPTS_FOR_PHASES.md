# GitHub Copilot Prompts for Backend Consolidation Phases

This document contains detailed, context-specific prompts for GitHub Copilot to use when developing PRs for each phase of the backend consolidation project.

## How to Use These Prompts

1. **Copy the entire prompt** for the phase you're working on
2. **Paste it into your Copilot chat** or PR description
3. **Review and customize** any project-specific details
4. **Let Copilot implement** following the detailed context provided
5. **Verify and test** the implementation before committing

---

## Phase 2: Core Services Migration

### Phase 2.1 - Authentication Routes Consolidation

```
I'm working on consolidating authentication endpoints for the BOUNTYExpo backend project. This is Phase 2.1 of an 8-phase backend consolidation project.

CONTEXT:
- We have three separate backend servers (api/server.js, services/api/src/index.ts, server/index.js) with ~40% code duplication
- Foundation is complete with unified config, auth middleware, error handling, and payment services
- Authentication logic is duplicated across api/server.js (lines 202-282, 1184-1363) and server/index.js (lines 152-202)
- We're consolidating all endpoints into a single Fastify service at services/api/src/

EXISTING INFRASTRUCTURE TO USE:
- Unified config: services/api/src/config/index.ts
- Unified auth middleware: services/api/src/middleware/unified-auth.ts (authMiddleware, optionalAuthMiddleware, adminAuthMiddleware)
- Unified error handling: services/api/src/middleware/error-handler.ts (ValidationError, AuthenticationError, asyncHandler)
- Supabase client initialization pattern from config

TASK:
Create services/api/src/routes/consolidated-auth.ts that consolidates authentication endpoints from the legacy servers.

ENDPOINTS TO MIGRATE:
1. POST /auth/register - User registration with email/password
2. POST /auth/sign-in - User login with credentials
3. POST /auth/sign-up - Alternative signup endpoint
4. GET /auth/diagnostics - Auth health check
5. GET /auth/ping - Supabase connectivity test  
6. DELETE /auth/delete-account - Account deletion (authenticated)

REQUIREMENTS:
1. Use Fastify route registration pattern: async function registerConsolidatedAuthRoutes(fastify: FastifyInstance)
2. Import and use authMiddleware for protected routes (delete-account)
3. Use Zod for input validation on all POST endpoints
4. Use asyncHandler wrapper for consistent error handling
5. Implement rate limiting for auth endpoints (5 requests per 15 minutes) using config.rateLimit.auth
6. Add comprehensive logging with request.log.info/warn/error
7. Follow the pattern established in services/api/src/routes/consolidated-payments.ts
8. Return standardized error responses using the error handler
9. Use Supabase admin client from config for user management operations
10. Include JSDoc comments for each route explaining purpose and requirements

VALIDATION SCHEMAS:
- registerSchema: email (email format), password (min 8 chars), username (optional)
- signInSchema: email (email format), password (string)
- signUpSchema: similar to registerSchema

ERROR HANDLING:
- Use ValidationError for invalid inputs
- Use AuthenticationError for auth failures
- Use ExternalServiceError for Supabase failures
- Let asyncHandler catch and format all errors

REFERENCE FILES:
- api/server.js lines 202-282, 1184-1363 (source endpoints)
- server/index.js lines 152-202 (source endpoints)
- services/api/src/routes/consolidated-payments.ts (pattern to follow)
- services/api/src/middleware/unified-auth.ts (auth middleware)
- services/api/src/config/index.ts (configuration)

TESTING:
After implementation, test:
1. POST /auth/register with valid/invalid data
2. POST /auth/sign-in with correct/incorrect credentials
3. DELETE /auth/delete-account with valid auth token
4. Rate limiting (make 6 requests quickly, expect 429 on 6th)
5. Error responses match standard format

OUTPUT:
Generate the complete consolidated-auth.ts file with all endpoints, proper TypeScript types, comprehensive error handling, and following the established patterns.
```

### Phase 2.2 - Profile Routes Consolidation

```
I'm working on consolidating profile management endpoints for the BOUNTYExpo backend project. This is Phase 2.2 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project consolidating three servers into one Fastify service
- Foundation complete with unified config, auth, error handling
- Auth routes have been consolidated (Phase 2.1 complete)
- Profile logic currently in api/server.js (lines 348-418)
- We're consolidating to services/api/src/routes/consolidated-profiles.ts

EXISTING INFRASTRUCTURE TO USE:
- Unified auth middleware: services/api/src/middleware/unified-auth.ts
  - authMiddleware: Validates JWT and injects request.user and request.userId
  - optionalAuthMiddleware: Allows both authenticated and unauthenticated access
- Unified error handling: services/api/src/middleware/error-handler.ts
  - ValidationError, NotFoundError, AuthorizationError
  - asyncHandler wrapper
- Unified config: services/api/src/config/index.ts (Supabase configuration)

TASK:
Create services/api/src/routes/consolidated-profiles.ts that consolidates profile management endpoints.

ENDPOINTS TO MIGRATE:
1. GET /api/profiles/:id - Get public profile by ID (no auth required)
2. GET /api/profile - Get current user's profile (authenticated)
3. POST /api/profiles - Create/update profile (authenticated)
4. PATCH /api/profiles/:id - Update specific profile fields (authenticated, owner only)
5. DELETE /api/profiles/:id - Delete profile (authenticated, owner only)

REQUIREMENTS:
1. Use Fastify route registration: async function registerConsolidatedProfileRoutes(fastify: FastifyInstance)
2. GET /api/profiles/:id uses optionalAuthMiddleware (can be public or show more if authenticated)
3. All other routes use authMiddleware
4. Implement ownership checks for PATCH and DELETE (request.userId must match profile id)
5. Use Zod for input validation
6. Add comprehensive logging
7. Handle profile not found with NotFoundError
8. Return sanitized profile data (don't leak sensitive fields)

DATA MODEL (from Supabase profiles table):
- id: string (UUID, primary key)
- email: string
- username: string
- avatar_url: string (optional)
- bio: string (optional)
- balance: number (sensitive - only show to owner)
- stripe_customer_id: string (sensitive - never expose)
- stripe_connect_account_id: string (sensitive - never expose)
- created_at: timestamp
- updated_at: timestamp

VALIDATION SCHEMAS:
- updateProfileSchema: username (3-50 chars), avatar_url (valid URL), bio (max 500 chars)
- All fields optional for PATCH

AUTHORIZATION LOGIC:
```typescript
// For PATCH and DELETE
if (request.userId !== profileId) {
  throw new AuthorizationError('You can only modify your own profile');
}
```

DATA SANITIZATION:
```typescript
function sanitizeProfile(profile: any, isOwner: boolean) {
  const sanitized = {
    id: profile.id,
    username: profile.username,
    avatar_url: profile.avatar_url,
    bio: profile.bio,
    created_at: profile.created_at,
  };
  
  if (isOwner) {
    sanitized.email = profile.email;
    sanitized.balance = profile.balance;
  }
  
  return sanitized;
}
```

REFERENCE FILES:
- api/server.js lines 348-418 (source logic)
- services/api/src/routes/consolidated-payments.ts (pattern)
- services/api/src/routes/consolidated-auth.ts (pattern from Phase 2.1)

TESTING:
1. GET /api/profiles/:id as unauthenticated user (should work, limited data)
2. GET /api/profiles/:id as authenticated user viewing own profile (should include email, balance)
3. GET /api/profile as authenticated user (should return own profile)
4. PATCH /api/profiles/:id as owner (should update)
5. PATCH /api/profiles/:id as different user (should fail with 403)
6. Profile not found scenarios (should return 404)

OUTPUT:
Generate the complete consolidated-profiles.ts file with all endpoints, proper ownership checks, data sanitization, and following established patterns.
```

### Phase 2.3 - Bounty Routes Consolidation

```
I'm working on consolidating bounty management endpoints for the BOUNTYExpo backend project. This is Phase 2.3 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project: three servers → one Fastify service
- Foundation complete, auth routes done (2.1), profile routes done (2.2)
- Bounty logic currently in api/server.js (lines 423-933)
- We're consolidating to services/api/src/routes/consolidated-bounties.ts
- Bounties are the core business entity: tasks posted by users that others can accept and complete

EXISTING INFRASTRUCTURE TO USE:
- Unified auth: services/api/src/middleware/unified-auth.ts (authMiddleware)
- Unified errors: services/api/src/middleware/error-handler.ts (ValidationError, NotFoundError, AuthorizationError, ConflictError)
- Unified config: services/api/src/config/index.ts
- Existing patterns from consolidated-payments.ts, consolidated-auth.ts, consolidated-profiles.ts

TASK:
Create services/api/src/routes/consolidated-bounties.ts with comprehensive bounty management.

ENDPOINTS TO MIGRATE:
1. GET /api/bounties - List bounties with filters (optional auth for personalized results)
2. GET /api/bounties/:id - Get bounty details (optional auth)
3. POST /api/bounties - Create new bounty (authenticated)
4. PATCH /api/bounties/:id - Update bounty (authenticated, owner only)
5. DELETE /api/bounties/:id - Delete bounty (authenticated, owner only)
6. POST /api/bounties/:id/accept - Accept a bounty (authenticated)
7. POST /api/bounties/:id/complete - Mark bounty complete (authenticated, hunter only)
8. POST /api/bounties/:id/archive - Archive bounty (authenticated, owner only)

DATA MODEL (Supabase bounties table):
- id: string (UUID)
- user_id: string (poster ID)
- title: string (required, 10-200 chars)
- description: string (required, 50-5000 chars)
- amount: number (USD, can be 0 for "honor" bounties)
- isForHonor: boolean (if true, amount should be 0)
- location: string (optional, geo-coordinates or address)
- category: string (optional)
- skills_required: string[] (optional array)
- status: enum ('open', 'in_progress', 'completed', 'archived')
- accepted_by: string (hunter user_id, null if not accepted)
- created_at: timestamp
- updated_at: timestamp
- due_date: timestamp (optional)

BUSINESS LOGIC:
1. **Create Bounty**:
   - Validate title, description, amount
   - If isForHonor=true, amount must be 0
   - If amount > 0, isForHonor must be false
   - Set status = 'open', user_id = request.userId
   - If amount > 0, consider future escrow logic (Phase 3)

2. **Update Bounty**:
   - Only owner can update
   - Can't update if status is 'completed' or 'archived'
   - Can't change user_id or created_at

3. **Accept Bounty**:
   - Must be 'open' status
   - Can't accept own bounty (request.userId !== bounty.user_id)
   - Set status = 'in_progress', accepted_by = request.userId
   - Return updated bounty

4. **Complete Bounty**:
   - Must be 'in_progress' status
   - Only hunter (accepted_by) can mark complete
   - Set status = 'completed'
   - Future: Trigger wallet escrow release (Phase 3)

5. **Archive Bounty**:
   - Only owner can archive
   - Can archive any status except 'completed'
   - Set status = 'archived'

6. **List Bounties** (GET with filters):
   - status: filter by status (default: 'open')
   - category: filter by category
   - user_id: filter by poster
   - accepted_by: filter by hunter
   - location: filter by proximity (future enhancement)
   - page, limit: pagination (default: page=1, limit=20, max=100)
   - sortBy: created_at, amount, due_date (default: created_at)
   - sortOrder: asc, desc (default: desc)

VALIDATION SCHEMAS:
```typescript
const createBountySchema = z.object({
  title: z.string().min(10).max(200),
  description: z.string().min(50).max(5000),
  amount: z.number().min(0),
  isForHonor: z.boolean().optional().default(false),
  location: z.string().optional(),
  category: z.string().optional(),
  skills_required: z.array(z.string()).optional(),
  due_date: z.string().datetime().optional(),
}).refine(data => {
  if (data.isForHonor && data.amount > 0) {
    return false; // Honor bounties must have amount=0
  }
  return true;
}, { message: 'Honor bounties must have amount set to 0' });

const updateBountySchema = createBountySchema.partial();

const listBountiesSchema = z.object({
  status: z.enum(['open', 'in_progress', 'completed', 'archived']).optional(),
  category: z.string().optional(),
  user_id: z.string().uuid().optional(),
  accepted_by: z.string().uuid().optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(['created_at', 'amount', 'due_date']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});
```

ERROR SCENARIOS:
- Bounty not found: NotFoundError('Bounty', bountyId)
- Not owner: AuthorizationError('Only the bounty owner can perform this action')
- Already accepted: ConflictError('This bounty has already been accepted')
- Can't accept own: ValidationError('You cannot accept your own bounty')
- Wrong status: ConflictError(`Cannot perform this action on bounty with status: ${status}`)

REFERENCE FILES:
- api/server.js lines 423-933 (source logic)
- services/api/src/routes/consolidated-payments.ts (pattern)
- services/api/src/routes/consolidated-profiles.ts (ownership checks)

TESTING:
1. Create bounty with valid/invalid data
2. List bounties with various filters
3. Accept bounty as different user
4. Try to accept own bounty (should fail)
5. Complete bounty as hunter
6. Try to complete as non-hunter (should fail)
7. Archive bounty as owner
8. Update bounty after it's completed (should fail)

OUTPUT:
Generate complete consolidated-bounties.ts with all endpoints, business logic validation, and comprehensive error handling.
```

### Phase 2.4 - Bounty Request Routes Consolidation

```
I'm working on consolidating bounty request endpoints for the BOUNTYExpo backend project. This is Phase 2.4 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project: three servers → one Fastify service
- Previous phases complete: auth (2.1), profiles (2.2), bounties (2.3)
- Bounty request logic in api/server.js (lines 939-1178)
- We're consolidating to services/api/src/routes/consolidated-bounty-requests.ts
- Bounty requests = applications from hunters to accept bounties

EXISTING INFRASTRUCTURE TO USE:
- Unified auth: services/api/src/middleware/unified-auth.ts (authMiddleware)
- Unified errors: services/api/src/middleware/error-handler.ts
- Previous route files as patterns

TASK:
Create services/api/src/routes/consolidated-bounty-requests.ts for bounty application management.

ENDPOINTS TO MIGRATE:
1. GET /api/bounty-requests - List all requests (filtered by user or bounty)
2. GET /api/bounty-requests/:id - Get specific request details
3. GET /api/bounty-requests/user/:userId - Get requests by specific user
4. POST /api/bounty-requests - Create new request/application
5. PATCH /api/bounty-requests/:id - Update request status
6. DELETE /api/bounty-requests/:id - Delete/withdraw request

DATA MODEL (Supabase bounty_requests table):
- id: string (UUID)
- bounty_id: string (foreign key to bounties)
- user_id: string (hunter applying)
- status: enum ('pending', 'accepted', 'rejected', 'withdrawn')
- message: string (application message, 50-1000 chars)
- proposed_completion_date: timestamp (optional)
- created_at: timestamp
- updated_at: timestamp

BUSINESS LOGIC:
1. **Create Request**:
   - Authenticated user creates application
   - Validate bounty exists and is 'open'
   - Can't apply to own bounty
   - Can't apply twice to same bounty (check existing requests)
   - Set status = 'pending', user_id = request.userId

2. **Update Request**:
   - Only bounty owner can update status (accept/reject)
   - Only applicant can withdraw (set status = 'withdrawn')
   - Can't update if bounty is not 'open'
   - When accepting: update bounty status to 'in_progress', set accepted_by

3. **List Requests**:
   - Filter by bounty_id (show all applicants for a bounty)
   - Filter by user_id (show user's applications)
   - Filter by status
   - Pagination

4. **Delete Request**:
   - Only applicant can delete if status = 'pending'
   - Can't delete 'accepted' requests

VALIDATION SCHEMAS:
```typescript
const createRequestSchema = z.object({
  bounty_id: z.string().uuid(),
  message: z.string().min(50).max(1000),
  proposed_completion_date: z.string().datetime().optional(),
});

const updateRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'withdrawn']),
});

const listRequestsSchema = z.object({
  bounty_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']).optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
});
```

AUTHORIZATION:
- Create: Any authenticated user (except bounty owner)
- Update status to accepted/rejected: Bounty owner only
- Update status to withdrawn: Applicant only
- Delete: Applicant only (and only if pending)
- View: Bounty owner sees all for their bounty, users see their own

ERROR SCENARIOS:
- Request not found: NotFoundError('Bounty request', requestId)
- Bounty not found: NotFoundError('Bounty', bountyId)
- Can't apply to own: ValidationError('You cannot apply to your own bounty')
- Duplicate application: ConflictError('You have already applied to this bounty')
- Wrong status: ConflictError(`Cannot perform this action on request with status: ${status}`)
- Not authorized: AuthorizationError('You are not authorized to perform this action')

SPECIAL LOGIC FOR ACCEPTING:
When accepting a bounty request:
1. Verify the bounty is still 'open'
2. Update the bounty: status='in_progress', accepted_by=applicant's user_id
3. Update the request: status='accepted'
4. Reject all other pending requests for the same bounty (set status='rejected')

REFERENCE FILES:
- api/server.js lines 939-1178 (source logic)
- services/api/src/routes/consolidated-bounties.ts (related entity)
- services/api/src/routes/consolidated-profiles.ts (authorization patterns)

TESTING:
1. Create request with valid data
2. Try to apply to own bounty (should fail)
3. Try to apply twice (should fail)
4. Accept request as bounty owner (should update bounty and reject others)
5. Try to accept as non-owner (should fail)
6. Withdraw request as applicant
7. List requests with filters
8. Delete pending request

OUTPUT:
Generate complete consolidated-bounty-requests.ts with all endpoints, complex authorization logic, and proper integration with bounties table.
```

---

## Phase 3: Payment & Wallet Consolidation

### Phase 3.1 - Wallet Service Consolidation

```
I'm working on consolidating wallet functionality for the BOUNTYExpo backend project. This is Phase 3.1 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project: three servers → one Fastify service
- Phase 2 complete: Core services (auth, profiles, bounties, requests) consolidated
- Wallet logic scattered across services/api/src/services/wallet-service.ts and server/index.js (lines 1206-1273)
- Payment service consolidated in Phase 1 (services/api/src/services/consolidated-payment-service.ts)
- We're creating services/api/src/services/consolidated-wallet-service.ts

EXISTING INFRASTRUCTURE TO USE:
- Unified config: services/api/src/config/index.ts (Supabase, Stripe)
- Unified errors: services/api/src/middleware/error-handler.ts
- Consolidated payment service: services/api/src/services/consolidated-payment-service.ts (Stripe operations)

TASK:
Create services/api/src/services/consolidated-wallet-service.ts that consolidates all wallet operations.

DATA MODEL (Supabase tables):
**profiles table**:
- balance: number (user's wallet balance in USD)

**wallet_transactions table**:
- id: string (UUID)
- user_id: string (foreign key to profiles)
- type: enum ('deposit', 'withdrawal', 'escrow', 'release', 'refund')
- amount: number (positive for credits, negative for debits)
- description: string
- status: enum ('pending', 'completed', 'failed')
- bounty_id: string (optional, for escrow/release transactions)
- stripe_payment_intent_id: string (optional)
- stripe_transfer_id: string (optional)
- stripe_connect_account_id: string (optional)
- metadata: jsonb (additional data)
- created_at: timestamp

FUNCTIONS TO IMPLEMENT:

1. **getBalance(userId: string): Promise<number>**
   - Query profiles table for user's balance
   - Return current balance
   - Handle user not found

2. **getTransactions(userId: string, filters: TransactionFilters): Promise<TransactionHistory>**
   - Query wallet_transactions for user
   - Support filters: type, status, bounty_id, start_date, end_date
   - Support pagination
   - Sort by created_at desc

3. **createDeposit(userId: string, amount: number, paymentIntentId: string): Promise<Transaction>**
   - Called from Stripe webhook when payment succeeds
   - Create transaction record (type='deposit', status='completed')
   - Update user balance atomically (use RPC if available, else optimistic locking)
   - Return transaction

4. **createWithdrawal(userId: string, amount: number, destination: string): Promise<Transaction>**
   - Validate user has sufficient balance
   - Create transaction record (type='withdrawal', status='pending', amount negative)
   - Deduct from balance atomically
   - Initiate Stripe transfer (call Stripe API)
   - Return transaction

5. **createEscrow(bountyId: string, posterId: string, amount: number): Promise<Transaction>**
   - Called when bounty is accepted
   - Validate poster has sufficient balance
   - Create transaction (type='escrow', status='completed', amount negative)
   - Deduct from poster's balance atomically
   - Link to bounty_id
   - Return transaction

6. **releaseEscrow(bountyId: string, hunterId: string): Promise<Transaction>**
   - Called when bounty is completed
   - Find escrow transaction for bounty
   - Create release transaction (type='release', status='completed', amount positive)
   - Add to hunter's balance atomically
   - Return transaction

7. **refundEscrow(bountyId: string, posterId: string, reason: string): Promise<Transaction>**
   - Called when bounty is cancelled or disputed
   - Find escrow transaction for bounty
   - Create refund transaction (type='refund', status='completed', amount positive)
   - Add back to poster's balance atomically
   - Return transaction

8. **updateBalance(userId: string, amount: number): Promise<void>**
   - Atomic balance update helper
   - Try to use Supabase RPC function 'update_balance' if exists
   - Fallback to optimistic locking (read balance, update with WHERE balance = old_balance)
   - Throw error if balance would go negative

ATOMIC OPERATIONS:
All balance updates must be atomic to prevent race conditions. Preferred approach:
```typescript
// Try RPC first (database function)
const { error } = await supabase.rpc('update_balance', {
  p_user_id: userId,
  p_amount: amount
});

if (error) {
  // Fallback: optimistic locking
  const { data: profile } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();
  
  const newBalance = profile.balance + amount;
  if (newBalance < 0) {
    throw new ValidationError('Insufficient balance');
  }
  
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ balance: newBalance })
    .eq('id', userId)
    .eq('balance', profile.balance); // Optimistic lock
  
  if (updateError) {
    throw new ConflictError('Balance changed during update, please retry');
  }
}
```

ERROR HANDLING:
- Insufficient balance: ValidationError('Insufficient balance')
- User not found: NotFoundError('User', userId)
- Escrow not found: NotFoundError('Escrow transaction', bountyId)
- Atomic update failed: ConflictError('Balance changed during update, please retry')
- Stripe errors: Use handleStripeError from error-handler

INTEGRATION WITH PAYMENT SERVICE:
- createWithdrawal should call Stripe transfer API
- Import stripe instance from consolidated-payment-service

REFERENCE FILES:
- services/api/src/services/wallet-service.ts (existing implementation)
- server/index.js lines 1206-1273 (existing implementation)
- services/api/src/services/consolidated-payment-service.ts (Stripe operations)

TESTING:
1. Get balance for user
2. Create deposit and verify balance increases
3. Create withdrawal with sufficient balance
4. Try withdrawal with insufficient balance (should fail)
5. Create escrow and verify balance decreases
6. Release escrow and verify hunter balance increases
7. Refund escrow and verify poster balance increases
8. Concurrent balance updates (test atomic operations)

OUTPUT:
Generate complete consolidated-wallet-service.ts with all functions, atomic balance updates, comprehensive error handling, and TypeScript types.
```

### Phase 3.2 - Stripe Connect Service Consolidation

```
I'm working on consolidating Stripe Connect functionality for the BOUNTYExpo backend project. This is Phase 3.2 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project: consolidating three servers into one
- Wallet service consolidated in Phase 3.1
- Stripe Connect logic in services/api/src/services/stripe-connect-service.ts and server/index.js (lines 1012-1421)
- We're creating services/api/src/services/consolidated-stripe-connect-service.ts
- Stripe Connect enables users to receive payouts to their bank accounts

EXISTING INFRASTRUCTURE TO USE:
- Unified config: services/api/src/config/index.ts (Stripe configuration)
- Unified errors: services/api/src/middleware/error-handler.ts
- Payment service: services/api/src/services/consolidated-payment-service.ts (stripe instance)
- Wallet service: services/api/src/services/consolidated-wallet-service.ts (for transfers)

TASK:
Create services/api/src/services/consolidated-stripe-connect-service.ts for Stripe Connect operations.

DATA MODEL (Supabase profiles table extensions):
- stripe_connect_account_id: string (Stripe Connect account ID)
- stripe_connect_onboarded_at: timestamp (when onboarding completed)

STRIPE CONNECT FLOW:
1. User requests to enable payouts
2. Create Stripe Express account
3. Generate onboarding link
4. User completes onboarding with Stripe
5. Verify onboarding complete
6. User can now receive transfers

FUNCTIONS TO IMPLEMENT:

1. **createConnectAccount(userId: string, email: string): Promise<string>**
   - Check if user already has Connect account
   - If yes, return existing accountId
   - If no, create new Stripe Express account
   - Save stripe_connect_account_id to profiles table
   - Return accountId

2. **createAccountLink(userId: string, returnUrl: string, refreshUrl: string): Promise<AccountLinkResult>**
   - Get user's Connect account ID
   - Generate Stripe AccountLink for onboarding
   - Return { url, accountId, expiresAt }

3. **verifyOnboarding(userId: string): Promise<OnboardingStatus>**
   - Get user's Connect account ID
   - Check Stripe account status
   - Verify charges_enabled and payouts_enabled
   - If complete, update stripe_connect_onboarded_at if not set
   - Return { onboarded, accountId, chargesEnabled, payoutsEnabled, detailsSubmitted }

4. **createTransfer(userId: string, amount: number, currency: string = 'usd'): Promise<TransferResult>**
   - Verify user has Connect account and is onboarded
   - Check user has sufficient wallet balance
   - Create wallet withdrawal transaction (Phase 3.1)
   - Create Stripe transfer to Connect account
   - Return { transferId, status, amount, estimatedArrival }

5. **retryTransfer(transactionId: string, userId: string): Promise<TransferResult>**
   - Get failed transaction from wallet_transactions
   - Verify transaction belongs to user and status is 'failed'
   - Check retry count (max 3 retries)
   - Verify user has sufficient balance (was refunded on failure)
   - Deduct balance again atomically
   - Create new Stripe transfer
   - Update transaction with new transfer ID and incremented retry count
   - Return result

6. **getAccountStatus(userId: string): Promise<AccountStatus>**
   - Get Connect account ID from profiles
   - Query Stripe for account details
   - Return account status and capabilities

STRIPE API CALLS:
```typescript
// Create account
const account = await stripe.accounts.create({
  type: 'express',
  email: email,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  business_type: 'individual',
  metadata: { user_id: userId }
});

// Create account link
const accountLink = await stripe.accountLinks.create({
  account: accountId,
  refresh_url: refreshUrl,
  return_url: returnUrl,
  type: 'account_onboarding',
});

// Retrieve account
const account = await stripe.accounts.retrieve(accountId);

// Create transfer
const transfer = await stripe.transfers.create({
  amount: Math.round(amount * 100), // Convert to cents
  currency: currency,
  destination: accountId,
  metadata: { user_id: userId, transaction_id: transactionId }
});
```

TRANSFER WORKFLOW:
1. User requests withdrawal from wallet
2. Verify Connect account onboarded
3. Verify sufficient balance
4. Create wallet withdrawal transaction (deduct balance)
5. Create Stripe transfer
6. Transfer succeeds → mark transaction 'completed'
7. Transfer fails → refund wallet balance, mark transaction 'failed', allow retry

ERROR HANDLING:
- Account not found: NotFoundError('Stripe Connect account')
- Not onboarded: ValidationError('Complete Stripe Connect onboarding first')
- Insufficient balance: ValidationError('Insufficient wallet balance')
- Max retries reached: ValidationError('Maximum retry attempts reached')
- Stripe errors: Use handleStripeError

INTEGRATION:
- Use stripe instance from consolidated-payment-service.ts
- Use wallet service for balance operations and transaction records
- Handle Stripe webhooks (transfer.created, transfer.paid, transfer.failed) in Phase 3.3

REFERENCE FILES:
- services/api/src/services/stripe-connect-service.ts (existing)
- server/index.js lines 1012-1421 (existing)
- services/api/src/services/consolidated-wallet-service.ts (wallet operations)

TESTING:
1. Create Connect account for user
2. Generate account link
3. Verify onboarding status (mock as complete)
4. Create transfer with sufficient balance
5. Try transfer without onboarding (should fail)
6. Try transfer with insufficient balance (should fail)
7. Retry failed transfer
8. Test max retries limit

OUTPUT:
Generate complete consolidated-stripe-connect-service.ts with all functions, proper Stripe API calls, integration with wallet service, and comprehensive error handling.
```

### Phase 3.3 - Webhook Handler Consolidation

```
I'm working on consolidating Stripe webhook handling for the BOUNTYExpo backend project. This is Phase 3.3 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project: consolidating three servers into one
- Wallet service (3.1) and Connect service (3.2) consolidated
- Webhook logic in server/index.js (lines 633-1008)
- We're creating services/api/src/routes/consolidated-webhooks.ts
- Webhooks process Stripe events asynchronously (payment success, transfer updates, etc.)

EXISTING INFRASTRUCTURE TO USE:
- Unified config: services/api/src/config/index.ts (Stripe webhook secret)
- Unified errors: services/api/src/middleware/error-handler.ts
- Payment service: services/api/src/services/consolidated-payment-service.ts
- Wallet service: services/api/src/services/consolidated-wallet-service.ts
- Connect service: services/api/src/services/consolidated-stripe-connect-service.ts

TASK:
Create services/api/src/routes/consolidated-webhooks.ts for processing Stripe webhook events.

WEBHOOK FLOW:
1. Stripe sends POST to /webhooks/stripe
2. Verify webhook signature
3. Check for duplicate events (idempotency)
4. Process event based on type
5. Mark event as processed
6. Return 200 OK

EVENTS TO HANDLE:

1. **payment_intent.succeeded**
   - Payment completed successfully
   - Create wallet deposit transaction
   - Update user balance
   - Log success

2. **payment_intent.payment_failed**
   - Payment failed
   - Log failure with reason
   - Optional: Notify user

3. **payment_intent.requires_action**
   - Payment requires 3D Secure
   - Informational only (client SDK handles)

4. **charge.refunded**
   - Payment refunded
   - Create wallet refund transaction
   - Deduct from user balance
   - Log refund

5. **transfer.created**
   - Transfer to Connect account created
   - Update wallet transaction with transfer ID
   - Log creation

6. **transfer.paid**
   - Transfer completed to bank
   - Mark wallet transaction as 'completed'
   - Log success

7. **transfer.failed**
   - Transfer to Connect account failed
   - Mark wallet transaction as 'failed'
   - Refund user's wallet balance
   - Log failure with reason

8. **account.updated**
   - Connect account info updated
   - Update user's stripe_connect_onboarded_at if complete
   - Log update

9. **payout.paid**
   - Payout to bank completed
   - Informational only
   - Log success

10. **payout.failed**
    - Payout to bank failed
    - Log failure
    - Optional: Notify user and support

IMPLEMENTATION STRUCTURE:
```typescript
export async function registerConsolidatedWebhookRoutes(fastify: FastifyInstance) {
  fastify.post('/webhooks/stripe', {
    config: {
      rawBody: true, // Need raw body for signature verification
    },
  }, asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Verify signature
    const sig = request.headers['stripe-signature'];
    if (!sig) {
      throw new ValidationError('Missing Stripe signature');
    }
    
    const event = stripe.webhooks.constructEvent(
      request.rawBody,
      sig,
      config.stripe.webhookSecret
    );
    
    // 2. Check idempotency
    const existing = await checkEventProcessed(event.id);
    if (existing) {
      return { received: true, alreadyProcessed: true };
    }
    
    // 3. Log event
    await logWebhookEvent(event);
    
    // 4. Process based on type
    await processWebhookEvent(event);
    
    // 5. Mark as processed
    await markEventProcessed(event.id);
    
    return { received: true };
  }));
}
```

IDEMPOTENCY:
Store processed events in stripe_events table:
- stripe_event_id: string (unique)
- event_type: string
- event_data: jsonb
- processed: boolean
- processed_at: timestamp
- created_at: timestamp

ATOMIC OPERATIONS:
All balance updates must be atomic (use wallet service functions):
```typescript
// For deposits
await WalletService.createDeposit(userId, amount, paymentIntentId);

// For refunds
await WalletService.refundEscrow(bountyId, userId, reason);
```

ERROR HANDLING:
- Signature verification failed: Return 400
- Event already processed: Return 200 (idempotent)
- Processing error: Log error, return 500, Stripe will retry
- Use try/catch for each event type to prevent one failure from blocking others

SPECIAL CONSIDERATIONS:
1. **Webhook Retries**: Stripe retries failed webhooks, so be idempotent
2. **Event Order**: Events may arrive out of order, handle gracefully
3. **Missing Data**: Event might reference non-existent user/transaction, log and skip
4. **Atomic Updates**: Use wallet service for all balance operations
5. **Logging**: Comprehensive logging for debugging webhook issues

TESTING WEBHOOKS:
Use Stripe CLI to send test events:
```bash
stripe trigger payment_intent.succeeded
stripe trigger transfer.failed
```

REFERENCE FILES:
- server/index.js lines 633-1008 (existing webhook handler)
- services/api/src/services/consolidated-wallet-service.ts (balance operations)
- services/api/src/services/consolidated-stripe-connect-service.ts (transfer operations)

OUTPUT:
Generate complete consolidated-webhooks.ts with signature verification, idempotency, all event handlers, atomic operations, and comprehensive error handling.
```

---

## Phase 4: Real-time & Messaging Verification

### Phase 4 - WebSocket Services Verification

```
I'm working on verifying and documenting WebSocket services for the BOUNTYExpo backend project. This is Phase 4 of an 8-phase backend consolidation project.

CONTEXT:
- Backend consolidation project: consolidating three servers into one
- Phases 1-3 complete: Foundation, core services, payment/wallet
- WebSocket services already exist in services/api/src/
- Need to verify they work with consolidated infrastructure
- Two main WebSocket features: real-time events and messaging

EXISTING WEBSOCKET INFRASTRUCTURE:
- services/api/src/services/realtime-service.ts - Real-time event broadcasting
- services/api/src/services/websocket-messaging-service.ts - Chat messaging
- Likely registered in services/api/src/index.ts

TASK:
Verify WebSocket services integrate properly with consolidated backend and document any issues.

WEBSOCKET ENDPOINTS TO VERIFY:

1. **/events/subscribe** - Real-time event subscription
   - Used for: bounty updates, notifications, presence
   - Authentication: JWT token in connection params
   - Events emitted: bounty_created, bounty_accepted, bounty_completed, user_online, user_offline

2. **/messages/subscribe** - Messaging WebSocket
   - Used for: 1-on-1 and group chat
   - Authentication: JWT token in connection params
   - Events: message_sent, message_received, typing_indicator, read_receipt

VERIFICATION CHECKLIST:

1. **Authentication Integration**
   - [ ] Verify JWT validation works with unified auth
   - [ ] Test with valid token (should connect)
   - [ ] Test with invalid token (should reject)
   - [ ] Test with expired token (should reject)
   - [ ] Verify user context injection (userId available in handlers)

2. **Connection Management**
   - [ ] Test connection establishment
   - [ ] Test reconnection handling
   - [ ] Test connection limits (concurrent connections per user)
   - [ ] Test cleanup on disconnect
   - [ ] Monitor active connection count

3. **Message Delivery**
   - [ ] Test message send/receive
   - [ ] Test broadcast to multiple connections
   - [ ] Test message persistence (saved to database)
   - [ ] Test offline message queue
   - [ ] Measure delivery latency (target: <100ms)

4. **Error Handling**
   - [ ] Test malformed message handling
   - [ ] Test rate limiting (prevent spam)
   - [ ] Test connection errors
   - [ ] Verify error logging

5. **Integration with Consolidated Services**
   - [ ] Verify auth middleware compatibility
   - [ ] Verify error handler compatibility
   - [ ] Verify logging compatibility
   - [ ] Test with consolidated database connection

6. **Performance**
   - [ ] Load test: 100 concurrent connections
   - [ ] Load test: 1000 messages/second
   - [ ] Monitor memory usage
   - [ ] Monitor CPU usage
   - [ ] Check for memory leaks

TESTING APPROACH:
```typescript
// Test script for WebSocket verification
import WebSocket from 'ws';

async function testWebSocket() {
  // Get valid JWT token
  const token = await getAuthToken();
  
  // Test real-time events
  const eventsWs = new WebSocket(
    'ws://localhost:3001/events/subscribe',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  eventsWs.on('open', () => {
    console.log('✓ Events WebSocket connected');
  });
  
  eventsWs.on('message', (data) => {
    console.log('✓ Received event:', data);
  });
  
  // Test messaging
  const messagesWs = new WebSocket(
    'ws://localhost:3001/messages/subscribe',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  messagesWs.on('open', () => {
    console.log('✓ Messages WebSocket connected');
    
    // Send test message
    messagesWs.send(JSON.stringify({
      type: 'send_message',
      conversation_id: 'test-conv-id',
      message: 'Test message'
    }));
  });
  
  messagesWs.on('message', (data) => {
    console.log('✓ Received message:', data);
  });
}
```

ISSUES TO DOCUMENT:
If you find any issues, document them with:
- Issue description
- Steps to reproduce
- Expected behavior
- Actual behavior
- Suggested fix
- Priority (critical/high/medium/low)

OPTIMIZATION OPPORTUNITIES:
Document any opportunities for:
- Performance improvements
- Better error handling
- Enhanced monitoring
- Code simplification
- Better documentation

DELIVERABLES:

1. **Verification Report**: Create WEBSOCKET_VERIFICATION_REPORT.md with:
   - Checklist results
   - Test results
   - Issues found (if any)
   - Performance metrics
   - Recommendations

2. **Integration Tests**: Create services/api/src/__tests__/websocket-integration.test.ts with:
   - Connection tests
   - Authentication tests
   - Message delivery tests
   - Error handling tests

3. **Monitoring Dashboard** (if time permits): Document metrics to track:
   - Active connections
   - Message delivery rate
   - Connection errors
   - Average latency

REFERENCE FILES:
- services/api/src/services/realtime-service.ts
- services/api/src/services/websocket-messaging-service.ts
- services/api/src/index.ts (main server file)

OUTPUT:
Generate verification report, integration tests, and any bug fixes needed for WebSocket services to work seamlessly with consolidated backend.
```

---

## General Prompt Template

For any phase not covered above, use this template:

```
I'm working on [PHASE_NAME] for the BOUNTYExpo backend consolidation project. This is Phase [X] of an 8-phase project.

CONTEXT:
- Backend consolidation project: consolidating three separate servers into one Fastify service
- Previous phases complete: [LIST_PREVIOUS_PHASES]
- Current state: [DESCRIBE_CURRENT_STATE]
- Goal: [DESCRIBE_GOAL]

EXISTING INFRASTRUCTURE TO USE:
- Unified config: services/api/src/config/index.ts
- Unified auth: services/api/src/middleware/unified-auth.ts
- Unified errors: services/api/src/middleware/error-handler.ts
- [OTHER_RELEVANT_INFRASTRUCTURE]

TASK:
[DETAILED_TASK_DESCRIPTION]

REQUIREMENTS:
1. [REQUIREMENT_1]
2. [REQUIREMENT_2]
3. [...]

DATA MODEL:
[DESCRIBE_RELEVANT_DATA_MODELS]

BUSINESS LOGIC:
[DESCRIBE_BUSINESS_RULES_AND_LOGIC]

VALIDATION SCHEMAS:
[PROVIDE_ZOD_SCHEMAS_OR_VALIDATION_RULES]

ERROR HANDLING:
[DESCRIBE_ERROR_SCENARIOS]

REFERENCE FILES:
- [SOURCE_FILE_1] (lines X-Y)
- [PATTERN_FILE_1] (for patterns to follow)

TESTING:
[LIST_TEST_SCENARIOS]

OUTPUT:
[DESCRIBE_EXPECTED_OUTPUT]
```

---

## Best Practices for Using These Prompts

1. **Always include context**: Copilot works better with full context about the project
2. **Reference existing patterns**: Point to files that follow the patterns you want
3. **Be specific about requirements**: Include validation rules, error scenarios, etc.
4. **Include data models**: TypeScript types and database schemas help a lot
5. **Specify testing approach**: Tell Copilot what needs to be tested
6. **Request documentation**: Ask for comments, JSDoc, and documentation
7. **Mention integration points**: How does this integrate with other services?
8. **Provide examples**: Include code snippets of patterns to follow
9. **Set quality expectations**: Type safety, error handling, logging, etc.
10. **Review and iterate**: After Copilot generates code, review and refine

## Tips for Success

- **Start with small, well-defined tasks**: Don't try to implement an entire phase in one prompt
- **Provide feedback**: If generated code isn't quite right, explain what needs to change
- **Test incrementally**: Test each component before moving to the next
- **Use existing code as examples**: Reference the consolidated-payments.ts pattern extensively
- **Be explicit about edge cases**: List all error scenarios and edge cases
- **Request type safety**: Always ask for proper TypeScript types
- **Emphasize consistency**: Ask Copilot to follow established patterns

## Common Pitfalls to Avoid

- ❌ Vague prompts without context
- ❌ Not specifying data models
- ❌ Forgetting error handling
- ❌ Ignoring existing patterns
- ❌ Not requesting tests
- ❌ Skipping validation
- ❌ No logging requirements
- ❌ Missing edge cases

## After Implementation Checklist

After Copilot generates code for a phase:

- [ ] Review TypeScript types
- [ ] Verify error handling
- [ ] Check validation logic
- [ ] Ensure logging is comprehensive
- [ ] Test happy path
- [ ] Test error scenarios
- [ ] Test edge cases
- [ ] Run linter
- [ ] Run type checker
- [ ] Update documentation
- [ ] Update checklist
- [ ] Commit changes
- [ ] Open PR

---

## Appendix: Quick Reference

### File Structure
```
services/api/src/
├── config/
│   └── index.ts                          # Unified configuration
├── middleware/
│   ├── unified-auth.ts                   # Authentication middleware
│   └── error-handler.ts                  # Error handling
├── services/
│   ├── consolidated-payment-service.ts   # Payment operations
│   ├── consolidated-wallet-service.ts    # Wallet operations (Phase 3.1)
│   └── consolidated-stripe-connect-service.ts  # Connect operations (Phase 3.2)
├── routes/
│   ├── consolidated-payments.ts          # Payment endpoints (Phase 1)
│   ├── consolidated-auth.ts              # Auth endpoints (Phase 2.1)
│   ├── consolidated-profiles.ts          # Profile endpoints (Phase 2.2)
│   ├── consolidated-bounties.ts          # Bounty endpoints (Phase 2.3)
│   ├── consolidated-bounty-requests.ts   # Request endpoints (Phase 2.4)
│   └── consolidated-webhooks.ts          # Webhook handlers (Phase 3.3)
└── index.ts                              # Main server file
```

### Common Patterns

**Route Registration**:
```typescript
export async function registerConsolidatedXRoutes(fastify: FastifyInstance): Promise<void> {
  // Routes go here
}
```

**Authenticated Endpoint**:
```typescript
fastify.post('/endpoint', {
  preHandler: authMiddleware
}, asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
  // Implementation
}));
```

**Validation**:
```typescript
const schema = z.object({
  field: z.string().min(1).max(100),
});

const data = schema.parse(request.body);
```

**Error Throwing**:
```typescript
throw new ValidationError('Message', { details });
throw new NotFoundError('Resource', id);
throw new AuthorizationError('Message');
```

This prompt guide should help GitHub Copilot generate high-quality, consistent code for each phase of the backend consolidation project.
