# Consolidated Wallet Service Implementation

## Overview
Phase 3.1 of the backend consolidation project - consolidating wallet operations from multiple sources into a single, unified service.

## Implementation Details

### File Location
`services/api/src/services/consolidated-wallet-service.ts`

### Key Features Implemented

#### 1. **Balance Management**
- `getBalance(userId)` - Retrieves user's current wallet balance
- Returns balance in USD with user ID
- Handles user not found errors

#### 2. **Transaction History**
- `getTransactions(userId, filters)` - Retrieves paginated transaction history
- Supports filtering by:
  - Transaction type (deposit, withdrawal, escrow, release, refund)
  - Status (pending, completed, failed)
  - Bounty ID
  - Date range (start_date, end_date)
  - Pagination (limit, offset)
- Returns formatted transactions with metadata

#### 3. **Deposit Operations**
- `createDeposit(userId, amount, paymentIntentId)` - Creates deposit from Stripe payment
- Called from Stripe webhook when payment succeeds
- Creates transaction record with status='completed'
- Atomically updates user balance
- Links to Stripe payment intent

#### 4. **Withdrawal Operations**
- `createWithdrawal(userId, amount, destination)` - Initiates withdrawal to Stripe
- Validates sufficient balance before processing
- Creates pending transaction
- Atomically deducts from balance
- Initiates Stripe transfer
- Updates transaction with transfer ID on success
- Rolls back balance on Stripe failure

#### 5. **Escrow Operations**
- `createEscrow(bountyId, posterId, amount)` - Holds funds when bounty is accepted
  - Validates poster has sufficient balance
  - Creates escrow transaction (negative amount for debit)
  - Atomically deducts from poster's balance
  - Links to bounty ID

- `releaseEscrow(bountyId, hunterId)` - Releases funds to hunter on completion
  - Finds original escrow transaction
  - Creates release transaction (positive amount for credit)
  - Atomically adds to hunter's balance
  - Tracks escrow transaction relationship

- `refundEscrow(bountyId, posterId, reason)` - Refunds to poster on cancellation
  - Finds original escrow transaction
  - Creates refund transaction with reason
  - Atomically returns funds to poster's balance
  - Includes refund metadata

#### 6. **Atomic Balance Updates**
- `updateBalance(userId, amount)` - Safe, atomic balance updates
- **Two-tier approach:**
  1. **Primary:** Attempts to use Supabase RPC function `update_balance` if available
  2. **Fallback:** Optimistic locking pattern with retry logic
- **Optimistic Locking Implementation:**
  - Reads current balance
  - Calculates new balance
  - Validates non-negative balance
  - Updates only if balance hasn't changed (WHERE balance = old_balance)
  - Retries up to 3 times with exponential backoff on conflict (100ms, 200ms, 400ms)
- **Prevents race conditions** during concurrent updates

### Data Model Alignment

#### Database Tables Used

**profiles table:**
```sql
- id: uuid (primary key)
- balance: numeric(10,2) (wallet balance in USD)
```

**wallet_transactions table:**
```sql
- id: uuid (primary key)
- user_id: uuid (foreign key to profiles)
- type: enum ('deposit', 'withdrawal', 'escrow', 'release', 'refund')
- amount: numeric(10,2) (positive for credits, negative for debits)
- description: text
- status: enum ('pending', 'completed', 'failed')
- bounty_id: uuid (optional)
- stripe_payment_intent_id: text (optional)
- stripe_transfer_id: text (optional)
- stripe_connect_account_id: text (optional)
- metadata: jsonb
- created_at: timestamptz
- updated_at: timestamptz
```

### TypeScript Types

```typescript
export type TransactionType = 'deposit' | 'withdrawal' | 'escrow' | 'release' | 'refund';
export type TransactionStatus = 'pending' | 'completed' | 'failed';

export interface TransactionFilters {
  type?: TransactionType;
  status?: TransactionStatus;
  bounty_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  description: string;
  status: TransactionStatus;
  bounty_id?: string;
  stripe_payment_intent_id?: string;
  stripe_transfer_id?: string;
  stripe_connect_account_id?: string;
  metadata?: any;
  created_at: string;
  updated_at?: string;
}

export interface BalanceResult {
  balance: number;
  currency: string;
  user_id: string;
}

export interface TransactionsResult {
  transactions: WalletTransaction[];
  total: number;
  limit: number;
  offset: number;
}
```

### Error Handling

The service uses standardized error classes from `error-handler.ts`:

- **ValidationError**: Invalid input (negative amounts, insufficient balance)
- **NotFoundError**: User or transaction not found
- **ConflictError**: Balance update conflict (optimistic locking failed)
- **ExternalServiceError**: Supabase or Stripe errors
- **handleStripeError**: Specialized Stripe error handling

### Integration Points

#### 1. Supabase
- Uses admin client with service role key
- Direct table access for profiles and wallet_transactions
- Supports both RPC functions and direct SQL

#### 2. Stripe (via consolidated-payment-service)
- Imports `stripe` instance for transfer operations
- Creates transfers for withdrawals
- Links transactions to Stripe payment intents and transfers

#### 3. Configuration (config/index.ts)
- Supabase URL and service role key
- All config accessed via unified config object

### Test Coverage

Test file: `services/api/src/test-consolidated-wallet.ts`

Tests include:
1. ✓ Get balance for user
2. ✓ Get transactions with filters
3. ✓ Create deposit and verify balance update
4. ✓ Withdrawal with insufficient balance (should fail)
5. ✓ Create escrow and verify balance decrease
6. ✓ Release escrow to hunter
7. ✓ Refund escrow to poster
8. ✓ Get filtered transactions (by type)
9. ✓ Concurrent balance updates (atomic operations)

### Security Considerations

1. **Atomic Operations**: All balance updates use optimistic locking to prevent race conditions
2. **Validation**: Amount and balance validations before processing
3. **Authorization**: Service assumes caller has already validated user authorization
4. **Stripe Security**: Transfer operations use authenticated Stripe API
5. **Rollback (Best Effort)**: Failed operations attempt to rollback balance changes. Note that rollback operations themselves may fail in edge cases; such failures are logged as critical errors and may require manual investigation/remediation.

### Future Enhancements

1. **RPC Function**: Create `update_balance` RPC function in Supabase for better performance
2. **Transaction Fees**: Add support for platform fees on transactions
3. **Multi-currency**: Extend beyond USD support
4. **Transaction Limits**: Add daily/monthly transaction limits
5. **Audit Logging**: Enhanced audit trail for compliance
6. **Webhooks**: Event notifications for transaction updates

## Usage Examples

### Get User Balance
```typescript
import { getBalance } from './services/consolidated-wallet-service';

const balance = await getBalance(userId);
console.log(`Balance: $${balance.balance} ${balance.currency}`);
```

### Create Deposit (from webhook)
```typescript
import { createDeposit } from './services/consolidated-wallet-service';

const transaction = await createDeposit(userId, 50.00, paymentIntentId);
console.log(`Deposit created: ${transaction.id}`);
```

### Create Escrow on Bounty Accept
```typescript
import { createEscrow } from './services/consolidated-wallet-service';

const escrow = await createEscrow(bountyId, posterId, 100.00);
console.log(`Escrow held: $${Math.abs(escrow.amount)}`);
```

### Release Escrow on Completion
```typescript
import { releaseEscrow } from './services/consolidated-wallet-service';

const release = await releaseEscrow(bountyId, hunterId);
console.log(`Payment released: $${release.amount}`);
```

### Get Transaction History
```typescript
import { getTransactions } from './services/consolidated-wallet-service';

const result = await getTransactions(userId, {
  type: 'deposit',
  status: 'completed',
  limit: 20,
  offset: 0,
});
console.log(`Found ${result.total} transactions`);
```

## Migration Notes

### From server/index.js
- `/wallet/balance` endpoint logic → `getBalance()`
- `/wallet/transactions` endpoint logic → `getTransactions()`

### From services/wallet-service.ts
- `createTransaction()` split into specific methods
- `getTransactionsByUserId()` → `getTransactions()` with filters
- Risk integration preserved (can be added as middleware)

## Deployment Checklist

- [x] TypeScript types defined
- [x] All functions implemented
- [x] Error handling added
- [x] Test file created
- [x] Type checking passed
- [ ] Integration tests with real database
- [ ] Create Supabase RPC function for optimal performance
- [ ] Update API routes to use consolidated service
- [ ] Update webhook handlers to use consolidated service
- [ ] Deploy and monitor

## Dependencies

- `@supabase/supabase-js`: ^2.38.5
- `stripe`: ^18.5.0 (via consolidated-payment-service)
- Configuration via `config/index.ts`
- Error handling via `middleware/error-handler.ts`

## Performance Characteristics

- **Balance queries**: Single SELECT query (fast)
- **Transaction history**: Indexed queries with pagination (scalable)
- **Balance updates**: Optimistic locking with retry (safe, minimal contention)
- **Stripe transfers**: Async API call (may take seconds)

## Monitoring Recommendations

1. Track balance update retry counts
2. Monitor Stripe transfer success rates
3. Alert on failed transactions
4. Log all balance changes for audit
5. Track concurrent update conflicts

---

**Status**: ✅ Implementation Complete
**Phase**: 3.1 - Wallet Service Consolidation
**Next Phase**: 3.2 - Route Migration
