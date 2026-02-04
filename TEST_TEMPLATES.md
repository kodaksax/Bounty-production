# Test Implementation Templates - BOUNTYExpo

Quick-start templates for implementing the critical missing tests. Copy, modify, and use these templates to accelerate test development.

---

## Template 1: Service Unit Test

Use this for any service in `lib/services/`

```typescript
/**
 * Unit tests for [ServiceName]
 * Tests: [brief description of what this service does]
 */

import { [serviceName] } from '../[service-file-name]';
import { supabase } from '../../supabase';
import { logger } from '../../utils/error-logger';

// Mock dependencies
jest.mock('../../supabase');
jest.mock('../../utils/error-logger');

describe('[ServiceName]', () => {
  // Mock data
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser'
  };

  const mockSupabaseResponse = {
    data: null,
    error: null
  };

  // Setup/teardown
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue(mockSupabaseResponse)
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('[methodName]', () => {
    it('should [expected behavior] when [condition]', async () => {
      // Arrange
      const input = { /* test input */ };
      const expectedOutput = { /* expected output */ };
      
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: expectedOutput,
          error: null
        })
      });

      // Act
      const result = await [serviceName].[methodName](input);

      // Assert
      expect(result).toEqual(expectedOutput);
      expect(supabase.from).toHaveBeenCalledWith('[table-name]');
    });

    it('should throw error when [error condition]', async () => {
      // Arrange
      const input = { /* invalid input */ };
      
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' }
        })
      });

      // Act & Assert
      await expect([serviceName].[methodName](input)).rejects.toThrow('Database error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should validate input before processing', async () => {
      // Arrange
      const invalidInput = { /* missing required fields */ };

      // Act & Assert
      await expect([serviceName].[methodName](invalidInput))
        .rejects.toThrow('Validation error');
    });

    it('should handle null/undefined gracefully', async () => {
      // Act
      const result = await [serviceName].[methodName](null);

      // Assert
      expect(result).toBeNull();
      // Or throw error depending on expected behavior
    });
  });

  describe('[anotherMethodName]', () => {
    // More tests...
  });
});
```

---

## Template 2: Integration Test

Use this for testing multiple services working together

```typescript
/**
 * Integration tests for [Feature Name]
 * Tests the integration between [ServiceA], [ServiceB], and [ServiceC]
 */

import { [serviceA] } from '../../lib/services/[service-a]';
import { [serviceB] } from '../../lib/services/[service-b]';
import { createClient } from '@supabase/supabase-js';

// Use real Supabase client with test database
const supabaseUrl = process.env.SUPABASE_TEST_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_TEST_ANON_KEY || 'test-key';
const supabase = createClient(supabaseUrl, supabaseKey);

describe('[Feature Name] Integration', () => {
  // Test data cleanup
  const createdIds: string[] = [];

  beforeAll(async () => {
    // Setup: Create test database state
    await setupTestDatabase();
  });

  afterAll(async () => {
    // Cleanup: Remove all test data
    await cleanupTestData(createdIds);
  });

  beforeEach(async () => {
    // Reset state between tests
    jest.clearAllMocks();
  });

  it('should complete full [feature] flow', async () => {
    // 1. Create initial entity
    const entity1 = await [serviceA].create({
      /* data */
    });
    createdIds.push(entity1.id);

    expect(entity1).toBeDefined();
    expect(entity1.id).toBeTruthy();

    // 2. Process entity with ServiceB
    const result = await [serviceB].process(entity1.id);

    expect(result.status).toBe('processed');

    // 3. Verify side effects
    const updated = await [serviceA].getById(entity1.id);
    expect(updated.status).toBe('processed');

    // 4. Verify related entity created
    const related = await [serviceB].getRelated(entity1.id);
    expect(related).toBeDefined();
  });

  it('should handle errors across services', async () => {
    // 1. Create entity that will cause error
    const entity = await [serviceA].create({ /* invalid data */ });
    createdIds.push(entity.id);

    // 2. Attempt processing (should fail)
    await expect([serviceB].process(entity.id)).rejects.toThrow();

    // 3. Verify rollback occurred
    const retrieved = await [serviceA].getById(entity.id);
    expect(retrieved.status).toBe('pending'); // unchanged
  });

  it('should maintain data consistency', async () => {
    // 1. Create multiple related entities
    const entity1 = await [serviceA].create({ /* data */ });
    const entity2 = await [serviceA].create({ /* data */ });
    createdIds.push(entity1.id, entity2.id);

    // 2. Link them
    await [serviceB].link(entity1.id, entity2.id);

    // 3. Delete one
    await [serviceA].delete(entity1.id);

    // 4. Verify cascade or orphan handling
    const link = await [serviceB].getLink(entity1.id, entity2.id);
    expect(link).toBeNull(); // or expect cascade delete
  });
});

// Helper functions
async function setupTestDatabase() {
  // Create test data, tables, etc.
}

async function cleanupTestData(ids: string[]) {
  for (const id of ids) {
    try {
      await supabase.from('[table]').delete().eq('id', id);
    } catch (error) {
      console.error(`Failed to cleanup ${id}:`, error);
    }
  }
}
```

---

## Template 3: E2E Test

Use this for testing complete user journeys

```typescript
/**
 * E2E tests for [User Journey Name]
 * Simulates: [description of user journey]
 */

import { [requiredServices] } from '../../lib/services';
import { setupTestUser, cleanupTestUser } from '../helpers/test-users';

describe('[User Journey] E2E', () => {
  let testPoster: any;
  let testHunter: any;
  let createdEntities: string[] = [];

  beforeAll(async () => {
    // Create test users
    testPoster = await setupTestUser({
      email: 'poster@test.com',
      role: 'poster'
    });
    testHunter = await setupTestUser({
      email: 'hunter@test.com',
      role: 'hunter'
    });
  });

  afterAll(async () => {
    // Cleanup all test data
    await cleanupTestUser(testPoster.id);
    await cleanupTestUser(testHunter.id);
    for (const id of createdEntities) {
      await cleanupEntity(id);
    }
  });

  it('should complete [journey name] from start to finish', async () => {
    // Step 1: [First user action]
    console.log('Step 1: [Description]');
    const step1Result = await performAction1(testPoster.id);
    createdEntities.push(step1Result.id);

    expect(step1Result).toBeDefined();
    expect(step1Result.status).toBe('expected-status');

    // Step 2: [Second user action]
    console.log('Step 2: [Description]');
    const step2Result = await performAction2(testHunter.id, step1Result.id);

    expect(step2Result).toBeDefined();

    // Step 3: [Third action]
    console.log('Step 3: [Description]');
    const step3Result = await performAction3(testPoster.id, step2Result.id);

    expect(step3Result.status).toBe('completed');

    // Step 4: Verify final state
    console.log('Step 4: Verifying final state');
    const finalState = await verifyFinalState(step1Result.id);

    expect(finalState.completed).toBe(true);
    expect(finalState.participants).toHaveLength(2);
  });

  it('should handle [error scenario] gracefully', async () => {
    // Step 1: Setup
    const entity = await setupEntityForError();
    createdEntities.push(entity.id);

    // Step 2: Trigger error
    await expect(
      performActionThatFails(entity.id)
    ).rejects.toThrow('Expected error message');

    // Step 3: Verify recovery
    const recovered = await checkRecoveryState(entity.id);
    expect(recovered.status).toBe('error-recovered');
  });

  it('should handle concurrent actions', async () => {
    // Setup entity
    const entity = await setupEntity();
    createdEntities.push(entity.id);

    // Perform multiple concurrent actions
    const promises = [
      performAction(testPoster.id, entity.id),
      performAction(testHunter.id, entity.id),
      performAction(testPoster.id, entity.id)
    ];

    const results = await Promise.allSettled(promises);

    // Verify only one succeeded (or all, depending on expected behavior)
    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);
  });
});

// Helper functions
async function performAction1(userId: string) {
  // Implementation
}

async function cleanupEntity(id: string) {
  // Implementation
}
```

---

## Template 4: Payment/Stripe Integration Test

Use this specifically for payment-related tests

```typescript
/**
 * Payment integration tests for [Feature]
 * Uses Stripe test mode API
 */

import Stripe from 'stripe';
import { paymentService } from '../../lib/services/payment-service';

const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

describe('[Payment Feature] Integration', () => {
  let testCustomer: Stripe.Customer;
  let testPaymentMethod: Stripe.PaymentMethod;
  let createdIntents: string[] = [];

  beforeAll(async () => {
    // Create test customer
    testCustomer = await stripe.customers.create({
      email: 'test@example.com',
      name: 'Test User'
    });

    // Create test payment method
    testPaymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: 'tok_visa' // Stripe test token
      }
    });

    // Attach to customer
    await stripe.paymentMethods.attach(testPaymentMethod.id, {
      customer: testCustomer.id
    });
  });

  afterAll(async () => {
    // Cleanup: Cancel all test payment intents
    for (const intentId of createdIntents) {
      try {
        await stripe.paymentIntents.cancel(intentId);
      } catch (error) {
        // Already completed or canceled
      }
    }

    // Delete test payment method
    await stripe.paymentMethods.detach(testPaymentMethod.id);

    // Delete test customer
    await stripe.customers.del(testCustomer.id);
  });

  it('should create payment intent with correct amount', async () => {
    const result = await paymentService.createPayment({
      amount: 50, // $50
      currency: 'usd',
      userId: testCustomer.id,
      purpose: 'bounty_payment'
    });

    createdIntents.push(result.paymentIntentId!);

    expect(result.success).toBe(true);
    expect(result.paymentIntentId).toBeDefined();

    // Verify in Stripe
    const intent = await stripe.paymentIntents.retrieve(result.paymentIntentId!);
    expect(intent.amount).toBe(5000); // cents
    expect(intent.currency).toBe('usd');
    expect(intent.status).toBe('requires_payment_method');
  });

  it('should confirm payment with test card', async () => {
    // Create payment intent
    const created = await paymentService.createPayment({
      amount: 25,
      userId: testCustomer.id
    });
    createdIntents.push(created.paymentIntentId!);

    // Confirm payment
    const confirmed = await paymentService.confirmPayment({
      paymentIntentClientSecret: created.clientSecret!,
      paymentMethodId: testPaymentMethod.id,
      userId: testCustomer.id
    });

    expect(confirmed.success).toBe(true);
    expect(confirmed.status).toBe('succeeded');

    // Verify in Stripe
    const intent = await stripe.paymentIntents.retrieve(created.paymentIntentId!);
    expect(intent.status).toBe('succeeded');
  });

  it('should handle card decline', async () => {
    // Create declining payment method
    const decliningCard = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: 'tok_chargeDeclined' // Stripe test token for decline
      }
    });

    const created = await paymentService.createPayment({
      amount: 25,
      userId: testCustomer.id
    });
    createdIntents.push(created.paymentIntentId!);

    // Attempt to confirm (should fail)
    const result = await paymentService.confirmPayment({
      paymentIntentClientSecret: created.clientSecret!,
      paymentMethodId: decliningCard.id,
      userId: testCustomer.id
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('card_error');
    expect(result.error?.code).toBe('card_declined');

    // Cleanup
    await stripe.paymentMethods.detach(decliningCard.id);
  });

  it('should create escrow with manual capture', async () => {
    const escrow = await paymentService.createEscrow({
      bountyId: 'bounty-123',
      amount: 100,
      posterId: testCustomer.id,
      hunterId: 'hunter-456',
      userId: testCustomer.id,
      paymentMethodId: testPaymentMethod.id
    });

    createdIntents.push(escrow.paymentIntentId!);

    expect(escrow.success).toBe(true);

    // Verify manual capture in Stripe
    const intent = await stripe.paymentIntents.retrieve(escrow.paymentIntentId!);
    expect(intent.capture_method).toBe('manual');
    expect(intent.status).toBe('requires_capture');
  });

  it('should release escrow funds', async () => {
    // Create escrow
    const escrow = await createTestEscrow(testCustomer.id, 100);
    createdIntents.push(escrow.paymentIntentId!);

    // Release
    const released = await paymentService.releaseEscrow({
      paymentIntentId: escrow.paymentIntentId!,
      userId: testCustomer.id
    });

    expect(released.success).toBe(true);

    // Verify captured in Stripe
    const intent = await stripe.paymentIntents.retrieve(escrow.paymentIntentId!);
    expect(intent.status).toBe('succeeded');
  });

  it('should refund escrow', async () => {
    // Create and confirm payment
    const payment = await createAndConfirmPayment(testCustomer.id, 50);
    createdIntents.push(payment.paymentIntentId!);

    // Refund
    const refund = await paymentService.refund({
      paymentIntentId: payment.paymentIntentId!,
      amount: 5000, // Full refund
      reason: 'requested_by_customer'
    });

    expect(refund.success).toBe(true);

    // Verify refund in Stripe
    const intent = await stripe.paymentIntents.retrieve(payment.paymentIntentId!);
    expect(intent.latest_charge).toBeDefined();
    
    const charge = await stripe.charges.retrieve(intent.latest_charge as string);
    expect(charge.refunded).toBe(true);
  });
});

// Helper functions
async function createTestEscrow(customerId: string, amount: number) {
  // Implementation
}

async function createAndConfirmPayment(customerId: string, amount: number) {
  // Implementation
}
```

---

## Template 5: Real-time/WebSocket Test

Use this for testing real-time features

```typescript
/**
 * Real-time integration tests for [Feature]
 * Tests WebSocket/Supabase Realtime functionality
 */

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { messagingService } from '../../lib/services/supabase-messaging';

describe('[Real-time Feature] Tests', () => {
  let channel: RealtimeChannel;
  let subscription: any;

  afterEach(async () => {
    // Cleanup subscriptions
    if (subscription) {
      await messagingService.unsubscribe(subscription);
    }
    if (channel) {
      await supabase.removeChannel(channel);
    }
  });

  it('should receive real-time updates', async () => {
    const receivedMessages: any[] = [];
    const conversationId = 'conv-123';

    // Subscribe to channel
    subscription = await messagingService.subscribeToConversation(
      conversationId,
      (message) => {
        receivedMessages.push(message);
      }
    );

    // Wait for subscription to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send message from different client
    await messagingService.sendMessage({
      conversation_id: conversationId,
      sender_id: 'user-456',
      content: 'Test message'
    });

    // Wait for real-time delivery
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify received
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].content).toBe('Test message');
  });

  it('should handle reconnection after disconnect', async () => {
    const conversationId = 'conv-123';
    let reconnected = false;

    subscription = await messagingService.subscribeToConversation(
      conversationId,
      jest.fn()
    );

    // Listen for reconnection
    messagingService.on('reconnected', () => {
      reconnected = true;
    });

    // Simulate disconnect
    await supabase.removeAllChannels();

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Reconnect
    subscription = await messagingService.subscribeToConversation(
      conversationId,
      jest.fn()
    );

    expect(reconnected).toBe(true);
  });

  it('should handle multiple concurrent subscriptions', async () => {
    const subscriptions: any[] = [];
    const messageCounters = {
      conv1: 0,
      conv2: 0,
      conv3: 0
    };

    // Subscribe to multiple conversations
    subscriptions.push(
      await messagingService.subscribeToConversation('conv-1', () => {
        messageCounters.conv1++;
      })
    );

    subscriptions.push(
      await messagingService.subscribeToConversation('conv-2', () => {
        messageCounters.conv2++;
      })
    );

    subscriptions.push(
      await messagingService.subscribeToConversation('conv-3', () => {
        messageCounters.conv3++;
      })
    );

    // Send messages to each
    await messagingService.sendMessage({ conversation_id: 'conv-1', ... });
    await messagingService.sendMessage({ conversation_id: 'conv-2', ... });
    await messagingService.sendMessage({ conversation_id: 'conv-3', ... });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify each received only their messages
    expect(messageCounters.conv1).toBe(1);
    expect(messageCounters.conv2).toBe(1);
    expect(messageCounters.conv3).toBe(1);

    // Cleanup all
    for (const sub of subscriptions) {
      await messagingService.unsubscribe(sub);
    }
  });
});
```

---

## Template 6: Test Utilities & Helpers

Create these in `__tests__/helpers/` directory

### `test-users.ts`
```typescript
/**
 * Test user management utilities
 */

import { supabase } from '../../lib/supabase';
import { faker } from '@faker-js/faker';

export interface TestUser {
  id: string;
  email: string;
  username: string;
  role?: string;
  auth?: any;
}

const createdUsers: string[] = [];

export async function setupTestUser(options: {
  email?: string;
  username?: string;
  role?: string;
}): Promise<TestUser> {
  const email = options.email || faker.internet.email();
  const username = options.username || faker.internet.userName();
  const password = 'TestPass123!';

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (authError) throw authError;

  // Create profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: authData.user!.id,
      username,
      email,
      role: options.role || 'user'
    })
    .select()
    .single();

  if (profileError) throw profileError;

  createdUsers.push(authData.user!.id);

  return {
    id: authData.user!.id,
    email,
    username,
    role: options.role,
    auth: authData
  };
}

export async function cleanupTestUser(userId: string) {
  try {
    // Delete profile
    await supabase.from('profiles').delete().eq('id', userId);

    // Delete auth user (requires service role)
    await supabase.auth.admin.deleteUser(userId);

    // Remove from tracking
    const index = createdUsers.indexOf(userId);
    if (index > -1) {
      createdUsers.splice(index, 1);
    }
  } catch (error) {
    console.error(`Failed to cleanup user ${userId}:`, error);
  }
}

export async function cleanupAllTestUsers() {
  for (const userId of createdUsers) {
    await cleanupTestUser(userId);
  }
}

// Automatically cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    // Note: This is synchronous, won't work with async cleanup
    console.log(`Cleaning up ${createdUsers.length} test users...`);
  });
}
```

### `test-data-factory.ts`
```typescript
/**
 * Test data factories
 */

import { faker } from '@faker-js/faker';

export const BountyFactory = {
  create: (overrides?: any) => ({
    id: faker.string.uuid(),
    title: faker.lorem.sentence(),
    description: faker.lorem.paragraph(),
    amount: faker.number.int({ min: 10, max: 1000 }),
    currency: 'usd',
    status: 'open',
    work_type: faker.helpers.arrayElement(['online', 'in_person', 'hybrid']),
    location: faker.location.city(),
    poster_id: faker.string.uuid(),
    created_at: faker.date.recent().toISOString(),
    ...overrides
  })
};

export const MessageFactory = {
  create: (overrides?: any) => ({
    id: faker.string.uuid(),
    conversation_id: faker.string.uuid(),
    sender_id: faker.string.uuid(),
    content: faker.lorem.sentence(),
    created_at: faker.date.recent().toISOString(),
    read_at: null,
    ...overrides
  })
};

export const TransactionFactory = {
  create: (overrides?: any) => ({
    id: faker.string.uuid(),
    user_id: faker.string.uuid(),
    type: faker.helpers.arrayElement(['deposit', 'withdrawal', 'bounty_payment']),
    amount: faker.number.int({ min: 100, max: 100000 }),
    currency: 'usd',
    status: 'completed',
    created_at: faker.date.recent().toISOString(),
    ...overrides
  })
};

// Add more factories as needed
```

### `test-database.ts`
```typescript
/**
 * Test database utilities
 */

import { supabase } from '../../lib/supabase';

export async function clearTable(tableName: string) {
  const { error } = await supabase.from(tableName).delete().neq('id', '');
  if (error) throw error;
}

export async function seedTable(tableName: string, data: any[]) {
  const { error } = await supabase.from(tableName).insert(data);
  if (error) throw error;
}

export async function truncateAllTables() {
  const tables = [
    'messages',
    'conversations',
    'bounties',
    'transactions',
    'profiles'
  ];

  for (const table of tables) {
    await clearTable(table);
  }
}

export async function getRowCount(tableName: string): Promise<number> {
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count || 0;
}
```

---

## Quick Start Guide

### 1. Copy Template
Choose appropriate template based on test type

### 2. Replace Placeholders
- `[ServiceName]` → Actual service name
- `[methodName]` → Actual method name
- `[table-name]` → Actual database table
- `/* data */` → Real test data

### 3. Run Test
```bash
npm test -- path/to/your-test.test.ts
```

### 4. Iterate
- Add more test cases
- Improve coverage
- Refactor duplicated code into helpers

---

## Best Practices

### ✅ DO:
- Use descriptive test names: `it('should [action] when [condition]')`
- Test both happy path and error cases
- Clean up test data in `afterEach` or `afterAll`
- Mock external dependencies (Stripe, email services)
- Use test factories for consistent test data
- Keep tests independent (no shared state)

### ❌ DON'T:
- Hard-code real API keys or credentials
- Leave test data in database after tests
- Test implementation details (test behavior, not internals)
- Write tests that depend on execution order
- Ignore flaky tests (fix them!)
- Skip writing tests for "simple" code

---

## Common Patterns

### Pattern: Async Test with Timeout
```typescript
it('should complete within reasonable time', async () => {
  const promise = someAsyncOperation();
  
  // Will fail if takes > 5 seconds
  await expect(promise).resolves.toBeDefined();
}, 5000); // 5 second timeout
```

### Pattern: Testing Error Messages
```typescript
it('should throw descriptive error', async () => {
  await expect(service.method()).rejects.toThrow(
    /Expected error message pattern/
  );
});
```

### Pattern: Spy on Method Calls
```typescript
it('should call dependency with correct args', async () => {
  const spy = jest.spyOn(dependency, 'method');
  
  await service.method();
  
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'value' })
  );
  
  spy.mockRestore();
});
```

### Pattern: Test with Multiple Assertions
```typescript
it('should have correct properties', async () => {
  const result = await service.method();
  
  expect(result).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      created_at: expect.any(String),
      status: 'pending'
    })
  );
});
```

---

## Troubleshooting

### Issue: Tests are slow
**Solution:** 
- Mock external API calls
- Use in-memory database for unit tests
- Run tests in parallel: `jest --maxWorkers=4`

### Issue: Flaky tests
**Solution:**
- Add proper wait conditions
- Use `waitFor` instead of `setTimeout`
- Ensure proper cleanup between tests

### Issue: Cannot test async code
**Solution:**
```typescript
// Wrong
it('should work', () => {
  service.asyncMethod(); // Not awaited!
});

// Right
it('should work', async () => {
  await service.asyncMethod();
});
```

### Issue: Mock not working
**Solution:**
```typescript
// Mock BEFORE importing service
jest.mock('../../dependency');
import { service } from '../../service';

// Not after!
```

---

## Resources

- Jest Documentation: https://jestjs.io/docs/getting-started
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Faker.js: https://fakerjs.dev/guide/
- Stripe Testing: https://stripe.com/docs/testing

---

**Document Version:** 1.0  
**Last Updated:** 2024-01-23  
**Quick Reference for:** BOUNTYExpo Test Implementation
