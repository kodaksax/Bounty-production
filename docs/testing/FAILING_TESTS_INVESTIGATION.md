# Investigation Report: Remaining Test Failures

**Date**: 2026-02-08  
**Status**: 18 tests failing across 3 test suites  
**Overall Pass Rate**: 998/1074 (92.9%)

## Executive Summary

This document provides a comprehensive analysis of the 18 remaining test failures across three test suites. All failures are caused by inadequate mock implementations that don't simulate the actual business logic validation performed by the services under test.

---

## 1. Risk Management Service Tests (2 failures)

**File**: `services/api/src/__tests__/risk-management.test.ts`  
**Service**: `services/api/src/services/risk-management-service.ts`

### Failing Tests

#### Test 1: "should allow non-restricted categories"
- **Line**: 236-240
- **Expected**: `result.allowed` to be `true`
- **Actual**: `false`

#### Test 2: "should provide risk level for restricted but allowed categories"
- **Line**: 242-255
- **Expected**: `result.allowed` to be `true` with `result.riskLevel` as `'high'`
- **Actual**: `allowed` is `false`

### Root Cause Analysis

The mock database in lines 8-133 doesn't properly implement the `where()` clause filtering for drizzle-orm queries. Specifically:

```typescript
// Current mock (line 52)
where: jest.fn().mockReturnThis(),
```

The `where()` method simply returns `this` without actually filtering the data. When the service queries:

```typescript
const restricted = await db
  .select()
  .from(restrictedBusinessCategories)
  .where(eq(restrictedBusinessCategories.category_code, businessCategory))
  .limit(1);
```

The mock returns ALL data from `mockState['restricted_business_categories']`, not just the matching record.

### Service Logic (Expected Behavior)

From `risk-management-service.ts` lines 558-587:

```typescript
async checkBusinessCategoryCompliance(businessCategory: string): Promise<{
  allowed: boolean;
  reason?: string;
  riskLevel?: string;
}> {
  const restricted = await db
    .select()
    .from(restrictedBusinessCategories)
    .where(eq(restrictedBusinessCategories.category_code, businessCategory))
    .limit(1);

  if (!restricted.length) {
    return { allowed: true }; // Non-restricted category
  }

  const category = restricted[0];

  if (category.is_prohibited) {
    return {
      allowed: false,
      reason: `Business category '${category.category_name}' is prohibited on this platform`,
      riskLevel: 'prohibited',
    };
  }

  return {
    allowed: true,
    riskLevel: category.risk_level,
  };
}
```

**Expected Flow**:
1. For `'general_services'`: Query returns empty → `allowed: true`
2. For `'test_high_risk'`: Query finds it, not prohibited → `allowed: true, riskLevel: 'high'`

**Actual Flow with Broken Mock**:
1. For `'general_services'`: Query returns `'test_prohibited'` (first item) → `allowed: false`
2. For `'test_high_risk'`: Even after insert, query returns `'test_prohibited'` first → `allowed: false`

### How to Fix

**Option 1: Implement Proper Query Filtering (Recommended)**

The mock needs to extract the comparison value from drizzle-orm's `eq()` condition and filter accordingly:

```typescript
const createChain = (tableName: string) => {
  let filterCondition: { field?: string; value?: any } | null = null;
  
  const chain: any = {
    where: jest.fn().mockImplementation((condition) => {
      // Extract field and value from drizzle-orm eq() condition
      // Structure: { queryChunks: [{value: [""]}, {name: "field"}, {value: [" = "]}, "value", {value: [""]}] }
      if (condition?.queryChunks) {
        // Find the field name (object with .name property)
        const fieldChunk = condition.queryChunks.find((c: any) => c?.name);
        // Find the value (standalone primitive, not in an object)
        const valueChunk = condition.queryChunks.find((c: any) => 
          (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') &&
          !c.value && !c.name
        );
        
        if (fieldChunk && valueChunk !== undefined) {
          filterCondition = { field: fieldChunk.name, value: valueChunk };
        }
      }
      return chain;
    }),
    
    // ... other methods ...
    
    then: jest.fn().mockImplementation(function (onFulfilled) {
      const actualTableName = tableName === 'users' ? 'profiles' : tableName;
      let data = mockState[actualTableName] || [];

      // Apply filtering
      if (filterCondition && data.length > 0) {
        data = data.filter((row: any) => {
          return row[filterCondition.field] === filterCondition.value;
        });
      }
      
      // ... rest of implementation ...
      return Promise.resolve(data).then(onFulfilled);
    }),
  };
  return chain;
};
```

**Option 2: Use Specific Mock Responses**

Replace the generic mock with specific responses for known queries:

```typescript
jest.mock('../db/connection', () => {
  return {
    db: {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table) => {
          const tableName = getTableName(table);
          
          return {
            where: jest.fn().mockImplementation((condition) => {
              // Extract category_code from condition
              const categoryCode = extractCategoryCode(condition);
              
              return {
                limit: jest.fn().mockReturnValue({
                  then: jest.fn().mockImplementation((callback) => {
                    let result = [];
                    
                    if (tableName === 'restricted_business_categories') {
                      if (categoryCode === 'test_prohibited') {
                        result = [{
                          category_code: 'test_prohibited',
                          is_prohibited: true,
                          risk_level: 'high',
                          category_name: 'Prohibited Category'
                        }];
                      } else if (categoryCode === 'test_high_risk') {
                        result = [{
                          category_code: 'test_high_risk',
                          category_name: 'Test High Risk Category',
                          risk_level: 'high',
                          is_prohibited: false,
                        }];
                      }
                      // For 'general_services' or unknown, return empty array
                    }
                    
                    return Promise.resolve(result).then(callback);
                  })
                })
              };
            })
          };
        })
      }))
    }
  };
});
```

**Option 3: Integration Testing Approach**

Use a real test database instance instead of mocks:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Setup test database connection
const testDbUrl = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/bounty_test';
const queryClient = postgres(testDbUrl);
const testDb = drizzle(queryClient);

beforeAll(async () => {
  // Seed test data
  await testDb.insert(restrictedBusinessCategories).values([
    {
      category_code: 'test_prohibited',
      is_prohibited: true,
      risk_level: 'high',
      category_name: 'Prohibited Category'
    }
  ]);
});

afterAll(async () => {
  // Cleanup
  await testDb.delete(restrictedBusinessCategories);
  await queryClient.end();
});
```

### Effort Estimates

- **Option 1**: 4-6 hours (complex mock logic, needs thorough testing)
- **Option 2**: 2-3 hours (simpler but less maintainable)
- **Option 3**: 8-10 hours (requires test database setup, best long-term solution)

---

## 2. Completion Release Service Tests (7 failures)

**File**: `services/api/src/__tests__/completion-release-service.test.ts`  
**Service**: `services/api/src/services/completion-release-service.ts`

### Failing Tests

1. **"should use custom platform fee percentage"** (line 240-259)
   - Expected: `result.platformFee` to be `1000`
   - Actual: `0`

2. **"should handle missing bounty"** (line 370-375)
   - Expected: `result.success` to be `false`
   - Actual: `true`

3. **"should validate hunter matches bounty"** (line 403-408)
   - Expected: `result.success` to be `false`
   - Actual: `true`

4. **"should handle email failure gracefully"** (line 421-424)
   - Expected: `result.success` to be `true`
   - Actual: `false`

5. **"should handle realtime broadcast failure gracefully"** (line 437-440)
   - Expected: `result.success` to be `true`
   - Actual: `false`

6. **"should skip if already released"** (line 560-572)
   - Expected: `consolidatedWalletService.releaseEscrow` NOT to be called
   - Actual: It WAS called

7. **"should handle missing required fields"** (line 650-655)
   - Expected: `result.success` to be `false`
   - Actual: `true`

### Root Cause Analysis

The mock implementation (lines 7-77) provides static, successful responses regardless of the input parameters or validation checks. The actual service has multiple validation steps:

1. **Bounty existence check**
2. **Hunter validation** (must match bounty's hunter_id)
3. **Platform fee calculation**
4. **Duplicate release check**
5. **Email notification** (should not cause failure)
6. **Realtime broadcast** (should not cause failure)

The mock's `mockCreateChain` always returns the same data:

```typescript
if (tableName === 'bounties') {
  return Promise.resolve([{
    id: 'bounty123',
    creator_id: 'poster123',
    hunter_id: 'hunter123',
    amount_cents: 10000,
    status: 'in_progress',
    title: 'Test Bounty',
  }]);
}
```

This means:
- Missing bounties still return data
- Wrong hunter IDs aren't caught
- Validation logic isn't tested

### Service Logic (Expected Behavior)

From `completion-release-service.ts` lines 50+:

```typescript
async processCompletionRelease(request: CompletionReleaseRequest): Promise<CompletionReleaseResponse> {
  try {
    // 1. Validate bounty exists
    const bounty = await getBounty(request.bountyId);
    if (!bounty) {
      return { success: false, error: 'Bounty not found' };
    }

    // 2. Validate hunter matches
    if (bounty.hunter_id !== request.hunterId) {
      return { success: false, error: 'Hunter ID mismatch' };
    }

    // 3. Check for duplicate release
    const existingRelease = await checkExistingRelease(request.bountyId);
    if (existingRelease) {
      return { success: false, error: 'Already released' };
    }

    // 4. Calculate platform fee
    const platformFee = calculatePlatformFee(bounty.amount_cents, request.platformFeePercentage);

    // 5. Release escrow (core operation)
    const releaseResult = await walletService.releaseEscrow(
      request.bountyId,
      request.hunterId,
      platformFee
    );

    // 6. Send email (non-blocking, log errors but don't fail)
    try {
      await sendCompletionEmail(bounty, request.hunterId);
    } catch (emailError) {
      logger.warn('Email failed but continuing', emailError);
    }

    // 7. Broadcast realtime update (non-blocking)
    try {
      await broadcastCompletion(bounty);
    } catch (broadcastError) {
      logger.warn('Broadcast failed but continuing', broadcastError);
    }

    return {
      success: true,
      releaseId: releaseResult.id,
      platformFee: platformFee,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### How to Fix

**Option 1: Stateful Mock with Validation Logic**

Create a mock that simulates the actual validation:

```typescript
// Track state
const mockBounties: Map<string, any> = new Map();
const mockReleases: Set<string> = new Set();

const mockCreateChain = (tableName: string, customData?: any[]) => {
  let whereConditions: any[] = [];
  
  return {
    where: jest.fn().mockImplementation((condition) => {
      whereConditions.push(condition);
      return this;
    }),
    
    then: jest.fn().mockImplementation((callback) => {
      let data = customData;
      
      if (!data && tableName === 'bounties') {
        // Check if bounty was requested
        const bountyId = extractBountyId(whereConditions);
        const bounty = mockBounties.get(bountyId);
        data = bounty ? [bounty] : [];
      }
      
      if (!data && tableName === 'wallet_transactions') {
        // Check for existing releases
        const bountyId = extractBountyId(whereConditions);
        const hasRelease = mockReleases.has(bountyId);
        data = hasRelease ? [{ type: 'release', bounty_id: bountyId }] : [];
      }
      
      return Promise.resolve(data || []).then(callback);
    })
  };
};

// In tests, setup specific scenarios
beforeEach(() => {
  mockBounties.clear();
  mockReleases.clear();
  
  // Setup default bounty
  mockBounties.set('bounty123', {
    id: 'bounty123',
    hunter_id: 'hunter123',
    amount_cents: 10000,
    status: 'in_progress',
  });
});

it('should handle missing bounty', async () => {
  // Remove bounty from mock state
  mockBounties.delete('bounty123');
  
  const result = await service.processCompletionRelease({
    bountyId: 'bounty123',
    hunterId: 'hunter123',
  });
  
  expect(result.success).toBe(false);
  expect(result.error).toContain('not found');
});

it('should validate hunter matches bounty', async () => {
  const result = await service.processCompletionRelease({
    bountyId: 'bounty123',
    hunterId: 'wrong_hunter', // Mismatch!
  });
  
  expect(result.success).toBe(false);
  expect(result.error).toContain('mismatch');
});
```

**Option 2: Spy on Service Methods**

Mock individual service methods instead of the entire database:

```typescript
import * as completionReleaseService from '../services/completion-release-service';

describe('Completion Release Service', () => {
  let getBountySpy: jest.SpyInstance;
  let checkExistingReleaseSpy: jest.SpyInstance;
  
  beforeEach(() => {
    // Spy on internal methods
    getBountySpy = jest.spyOn(completionReleaseService as any, 'getBounty');
    checkExistingReleaseSpy = jest.spyOn(completionReleaseService as any, 'checkExistingRelease');
  });
  
  it('should handle missing bounty', async () => {
    getBountySpy.mockResolvedValueOnce(null); // No bounty found
    
    const result = await completionReleaseService.processCompletionRelease({
      bountyId: 'missing123',
      hunterId: 'hunter123',
    });
    
    expect(result.success).toBe(false);
  });
  
  it('should skip if already released', async () => {
    checkExistingReleaseSpy.mockResolvedValueOnce({ id: 'existing_release' });
    
    const releaseSpy = jest.spyOn(walletService, 'releaseEscrow');
    
    await completionReleaseService.processCompletionRelease({
      bountyId: 'bounty123',
      hunterId: 'hunter123',
    });
    
    expect(releaseSpy).not.toHaveBeenCalled();
  });
});
```

**Option 3: Refactor Service for Testability**

Add dependency injection to make the service easier to test:

```typescript
// completion-release-service.ts
export class CompletionReleaseService {
  constructor(
    private db: DatabaseClient,
    private walletService: WalletService,
    private emailService: EmailService,
    private realtimeService: RealtimeService
  ) {}
  
  async processCompletionRelease(request: CompletionReleaseRequest) {
    // Implementation using injected dependencies
  }
}

// In tests
const mockDb = createMockDb();
const mockWallet = createMockWallet();
const mockEmail = createMockEmail();
const mockRealtime = createMockRealtime();

const service = new CompletionReleaseService(
  mockDb,
  mockWallet,
  mockEmail,
  mockRealtime
);

// Now you can control each dependency's behavior
mockDb.getBounty.mockResolvedValue(null); // Missing bounty test
```

### Effort Estimates

- **Option 1**: 6-8 hours (complex stateful mock)
- **Option 2**: 3-4 hours (simpler but requires service method exposure)
- **Option 3**: 10-12 hours (requires service refactoring)

---

## 3. Refund Service Tests (9 failures)

**File**: `services/api/src/__tests__/refund-service.test.ts`  
**Service**: `services/api/src/services/refund-service.ts`

### Failing Tests

1. **"should prevent refund for honor-only bounties"** (line 228-239)
   - Expected: `result.error` to contain `'honor'`
   - Actual: Success or different error

2. **"should prevent duplicate refunds"** (line 241-263)
   - Expected: `result.success` to be `false` with error about "already been refunded"
   - Actual: `true`

3. **"should include reason in refund transaction"** (line 306-324)
   - Expected: `db.insert` to have been called
   - Actual: Not called

4. **"should skip if already refunded"** (line 495-514)
   - Expected: `stripeConnectService.refundPaymentIntent` NOT to be called
   - Actual: It WAS called

5. **"should handle invalid payload"** (line 516-525)
   - Expected: `result` to be `false`
   - Actual: `true`

6. **"should handle partial refunds"** (line 543-559)
   - Expected: `result.success` to be `true`
   - Actual: `false`

7. **"should handle Stripe refund pending status"** (line 561-577)
   - Expected: `result.refund.status` to be `'pending'`
   - Actual: `result.refund` is `undefined`

8. **"should handle missing bounty ID"** (line 626-644)
   - Expected: `result.success` to be `false`
   - Actual: `true`

9. **"should handle missing cancelledBy"** (line 646-656)
   - Expected: `result.success` to be `false`
   - Actual: `true`

### Root Cause Analysis

Similar to completion-release tests, the mock doesn't validate:

1. **Honor-only bounties** (amount = 0 or `isForHonor` flag)
2. **Duplicate refund checks**
3. **Required field validation** (bountyId, cancelledBy)
4. **Partial refund amounts**
5. **Stripe response status handling**

The static mock always returns the same bounty data:

```typescript
if (tableName === 'bounties') {
  return Promise.resolve([{
    id: 'bounty123',
    creator_id: 'poster123',
    amount_cents: 5000,
    status: 'cancelled',
    payment_intent_id: 'pi_test123',
    title: 'Test Bounty',
  }]);
}
```

### Service Logic (Expected Behavior)

From `refund-service.ts` lines 24+:

```typescript
async processRefund(request: RefundRequest): Promise<RefundResponse> {
  try {
    // 1. Validate required fields
    if (!request.bountyId) {
      return { success: false, error: 'Bounty ID is required' };
    }
    if (!request.cancelledBy) {
      return { success: false, error: 'CancelledBy is required' };
    }

    // 2. Get bounty
    const bounty = await getBounty(request.bountyId);
    if (!bounty) {
      return { success: false, error: 'Bounty not found' };
    }

    // 3. Check if honor-only (no refund needed)
    if (bounty.amount_cents === 0 || bounty.isForHonor) {
      return { 
        success: false, 
        error: 'Cannot refund honor-only bounties' 
      };
    }

    // 4. Check for duplicate refund
    const existingRefund = await checkExistingRefund(request.bountyId);
    if (existingRefund) {
      return { 
        success: false, 
        error: 'Bounty has already been refunded' 
      };
    }

    // 5. Process Stripe refund
    const stripeRefund = await stripeService.refundPaymentIntent(
      bounty.payment_intent_id,
      request.amount || bounty.amount_cents,
      request.reason
    );

    // 6. Record transaction
    await db.insert(walletTransactions).values({
      type: 'refund',
      bounty_id: request.bountyId,
      amount: stripeRefund.amount,
      reason: request.reason,
      stripe_refund_id: stripeRefund.id,
    });

    return {
      success: true,
      refundId: stripeRefund.id,
      refund: {
        status: stripeRefund.status, // 'pending' or 'succeeded'
        amount: stripeRefund.amount,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### How to Fix

**Option 1: Enhanced Mock with Validation**

```typescript
const mockBounties: Map<string, any> = new Map();
const mockRefunds: Set<string> = new Set();
let mockDbInserts: any[] = [];

const mockCreateChain = (tableName: string, customData?: any[]) => {
  return {
    where: jest.fn().mockReturnThis(),
    
    values: jest.fn().mockImplementation((data) => {
      if (tableName === 'wallet_transactions') {
        mockDbInserts.push(data);
      }
      return { returning: jest.fn().mockResolvedValue([data]) };
    }),
    
    then: jest.fn().mockImplementation((callback) => {
      if (tableName === 'bounties' && customData) {
        return Promise.resolve(customData).then(callback);
      }
      
      if (tableName === 'wallet_transactions') {
        const bountyId = /* extract from where */;
        const hasRefund = mockRefunds.has(bountyId);
        const data = hasRefund ? [{ type: 'refund', bounty_id: bountyId }] : [];
        return Promise.resolve(data).then(callback);
      }
      
      return Promise.resolve([]).then(callback);
    })
  };
};

describe('Refund Service', () => {
  beforeEach(() => {
    mockBounties.clear();
    mockRefunds.clear();
    mockDbInserts = [];
  });

  it('should prevent refund for honor-only bounties', async () => {
    mockBounties.set('bounty123', {
      id: 'bounty123',
      amount_cents: 0, // Honor only!
      isForHonor: true,
      status: 'cancelled',
    });
    
    const result = await refundService.processRefund({
      bountyId: 'bounty123',
      cancelledBy: 'poster123',
      reason: 'Test',
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('honor');
  });

  it('should prevent duplicate refunds', async () => {
    mockRefunds.add('bounty123'); // Mark as already refunded
    
    const result = await refundService.processRefund({
      bountyId: 'bounty123',
      cancelledBy: 'poster123',
      reason: 'Test',
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('already been refunded');
  });

  it('should include reason in refund transaction', async () => {
    mockBounties.set('bounty123', {
      id: 'bounty123',
      amount_cents: 5000,
      payment_intent_id: 'pi_123',
      status: 'cancelled',
    });
    
    await refundService.processRefund({
      bountyId: 'bounty123',
      cancelledBy: 'poster123',
      reason: 'Customer request',
    });
    
    expect(mockDbInserts).toHaveLength(1);
    expect(mockDbInserts[0].reason).toBe('Customer request');
  });
});
```

**Option 2: Test Data Builders**

Create test data builders for cleaner test setup:

```typescript
class BountyBuilder {
  private bounty: any = {
    id: 'bounty123',
    amount_cents: 5000,
    status: 'cancelled',
    payment_intent_id: 'pi_123',
  };
  
  honorOnly(): this {
    this.bounty.amount_cents = 0;
    this.bounty.isForHonor = true;
    return this;
  }
  
  withoutPaymentIntent(): this {
    delete this.bounty.payment_intent_id;
    return this;
  }
  
  build(): any {
    return this.bounty;
  }
}

// In tests
it('should prevent refund for honor-only bounties', async () => {
  const bounty = new BountyBuilder().honorOnly().build();
  mockDb.getBounty.mockResolvedValue(bounty);
  
  const result = await refundService.processRefund({
    bountyId: 'bounty123',
    cancelledBy: 'poster123',
  });
  
  expect(result.error).toContain('honor');
});
```

### Effort Estimates

- **Option 1**: 7-9 hours (comprehensive mock with validation)
- **Option 2**: 4-5 hours (cleaner but still requires mock work)

---

## Summary and Recommendations

### Overall Effort by Approach

| Approach | Total Effort | Pros | Cons |
|----------|-------------|------|------|
| **Fix All Mocks** | 17-23 hours | Keeps current architecture | Complex, maintenance burden |
| **Refactor for DI** | 24-30 hours | Better design, easier testing | Requires service changes |
| **Integration Tests** | 12-16 hours | Tests real behavior | Requires test DB, slower |
| **Hybrid** | 10-14 hours | Balance of approaches | Mixed testing strategies |

### Recommended Approach: Hybrid Strategy

1. **Risk Management Tests** (2 failures) - 3 hours
   - Use Option 2: Specific mock responses
   - Small, isolated fix
   
2. **Completion Release Tests** (7 failures) - 4-5 hours
   - Use Option 1: Stateful mock with validation
   - Reusable pattern for refund tests
   
3. **Refund Tests** (9 failures) - 5-6 hours
   - Apply same pattern from completion release
   - Add test data builders for clarity

**Total: 12-14 hours**

### Implementation Order

1. **Start with Risk Management** (easiest win)
   - Quick fix to show progress
   - Learn mock patterns
   
2. **Then Completion Release** (establishes pattern)
   - Create reusable stateful mock utilities
   - Document patterns for team
   
3. **Finally Refund Service** (apply learned patterns)
   - Use utilities from step 2
   - Should go faster

### Long-Term Recommendations

1. **Adopt Integration Testing**
   - Use test database for business logic tests
   - Reserve mocks for UI/presentation layer
   
2. **Implement Dependency Injection**
   - Makes services more testable
   - Reduces mock complexity
   
3. **Create Testing Utilities**
   - Shared mock factories
   - Test data builders
   - Common assertions

4. **Update Testing Documentation**
   - Document mock patterns
   - Provide examples for common scenarios
   - Code review checklist for test quality

---

## Additional Resources

### Files to Review

- `services/api/src/services/risk-management-service.ts` - Risk management logic
- `services/api/src/services/completion-release-service.ts` - Completion logic
- `services/api/src/services/refund-service.ts` - Refund logic
- `services/api/src/db/connection.ts` - Database connection
- `services/api/src/db/schema.ts` - Database schema

### Helpful Commands

```bash
# Run specific test suite
npm test -- services/api/src/__tests__/risk-management.test.ts

# Run with verbose output
npm test -- --verbose services/api/src/__tests__/completion-release-service.test.ts

# Run single test
npm test -- -t "should allow non-restricted categories"

# Watch mode for development
npm test -- --watch services/api/src/__tests__/refund-service.test.ts
```

### Contact for Questions

If you need clarification on any of these issues or want to discuss the implementation approach, please reach out to the development team.
