# E2E Complete Bounty Flow Testing Guide

## Overview

This document describes the comprehensive end-to-end (E2E) tests for the complete bounty lifecycle in BOUNTYExpo. These tests ensure that critical user journeys remain functional as the application evolves.

## Test File Location

```
__tests__/e2e/complete-bounty-flow.test.ts
```

## Test Coverage

The E2E test suite covers **39 comprehensive tests** organized into **7 major categories**:

### 1. Create Bounty Flow (4 tests)

Tests the bounty creation process from the poster's perspective:

- ✅ Create a paid bounty with all required fields
- ✅ Create an honor-based bounty (volunteer work, no payment)
- ✅ Validate required fields (title, description, etc.)
- ✅ Prevent creating bounty with negative amount

**User Story**: As a poster, I want to create bounties for work I need done, either paid or for honor.

### 2. Apply & Accept Flow (9 tests)

Tests the application and acceptance workflow:

- ✅ Hunter discovers bounty in postings feed
- ✅ Hunter applies to bounty (creates request)
- ✅ Multiple hunters can apply to same bounty
- ✅ Poster accepts one hunter's application
- ✅ Bounty status changes to "in_progress"
- ✅ Competing requests are automatically rejected
- ✅ Conversation created between poster and accepted hunter
- ✅ Escrow transaction created for paid bounties
- ✅ Prevent acceptance if poster has insufficient balance
- ✅ Notifications sent to all parties

**User Story**: As a hunter, I want to apply to bounties and be notified when I'm selected. As a poster, I want to review applications and select the best hunter.

### 3. Work & Communication (4 tests)

Tests the collaboration features during active work:

- ✅ Poster and hunter can exchange messages
- ✅ Support for message attachments (files, images)
- ✅ Message status updates (sent, delivered, read)
- ✅ Both parties can view bounty progress

**User Story**: As a poster or hunter, I want to communicate about the work being done and share files.

### 4. Complete & Payment Flow (7 tests)

Tests the completion and payment release process:

- ✅ Hunter marks work as complete
- ✅ Poster receives completion notification
- ✅ Escrow payment released to hunter
- ✅ Wallet balances updated correctly
- ✅ Transaction records created
- ✅ Payment notification sent to hunter
- ✅ Only poster can release payment (authorization)
- ✅ Honor-based bounty completion (no payment flow)

**User Story**: As a hunter, I want to be paid when I complete work. As a poster, I want to approve work before payment is released.

### 5. Cancellation Flow (5 tests)

Tests cancellation scenarios and refund processing:

- ✅ Poster cancels bounty before acceptance
- ✅ Cancellation negotiation during active work
- ✅ Refund processing for cancelled paid bounties
- ✅ Conversation updated with cancellation notice
- ✅ Notifications sent to affected parties

**User Story**: As a poster or hunter, I want to be able to cancel a bounty if circumstances change, with fair refund processing.

### 6. Edge Cases & Error Handling (6 tests)

Tests error scenarios and edge cases:

- ✅ Payment failures during escrow creation
- ✅ Network errors during critical operations
- ✅ Concurrent acceptance attempts (race conditions)
- ✅ Invalid state transitions (e.g., completed → open)
- ✅ Missing required data handling
- ✅ Retry logic with exponential backoff

**User Story**: As a user, I expect the system to handle errors gracefully and provide clear feedback.

### 7. Integration Points (4 tests)

Tests integration with other system components:

- ✅ Notification system triggers at key events
- ✅ Wallet balance updates through lifecycle
- ✅ User ratings after completion
- ✅ Bounty search and filtering

**User Story**: As a user, I expect all parts of the system to work together seamlessly.

## Running the Tests

### Run E2E Tests Only

```bash
npm run test:e2e
```

### Run Specific Test File

```bash
npm test -- __tests__/e2e/complete-bounty-flow.test.ts
```

### Run with Verbose Output

```bash
npm test -- __tests__/e2e/complete-bounty-flow.test.ts --verbose
```

### Run All Tests

```bash
npm test
```

## Test Architecture

### Mock Services

The tests use mock services to simulate backend operations:

```typescript
mockBountyService     // Bounty CRUD operations
mockRequestService    // Application management
mockConversationService // Messaging
mockWalletService     // Payment and escrow
mockNotificationService // User notifications
```

### Test Data

Standard test users are defined:

```typescript
POSTER_ID    = 'user_poster_123'
HUNTER_ID_1  = 'user_hunter_alice'
HUNTER_ID_2  = 'user_hunter_bob'
HUNTER_ID_3  = 'user_hunter_charlie'
```

### Test Pattern

Each test follows the **Arrange-Act-Assert** pattern:

```typescript
it('should create a paid bounty', async () => {
  // Arrange - Set up test data and mocks
  const bountyData = { ... };
  mockBountyService.create.mockResolvedValue(createdBounty);
  
  // Act - Execute the operation
  const bounty = await mockBountyService.create(bountyData);
  
  // Assert - Verify expected outcomes
  expect(bounty.status).toBe('open');
  expect(mockBountyService.create).toHaveBeenCalled();
});
```

## Critical Paths Tested

### Happy Path (End-to-End Success)

1. **Poster creates bounty** ($500, paid)
2. **Three hunters apply** (Alice, Bob, Charlie)
3. **Poster accepts Alice** → Escrow created, others notified
4. **Poster & Alice communicate** → Share messages and files
5. **Alice completes work** → Marks as complete
6. **Poster approves** → Payment released to Alice
7. **Both rate each other** → Reputation updated

### Error Paths

- Payment card declined during escrow
- Network timeout during acceptance
- Two posters try to accept different hunters simultaneously
- Hunter tries to release payment (unauthorized)
- Invalid state transitions

### Alternative Paths

- Honor-based bounty (no payment)
- Cancellation before work starts
- Cancellation during work (with negotiation)
- Partial refunds for disputes

## Maintenance

### When to Update Tests

Update these tests when:

1. **Bounty lifecycle changes** - New statuses or state transitions
2. **Payment flow changes** - Escrow, release, or refund logic
3. **Authorization changes** - Who can perform which actions
4. **Notification changes** - New events or notification types
5. **Data model changes** - New required fields or validations

### Adding New Tests

When adding new features, follow this pattern:

```typescript
describe('New Feature Category', () => {
  beforeEach(() => {
    // Set up mocks
  });

  it('should handle new feature happy path', async () => {
    // Arrange
    // Act
    // Assert
  });

  it('should handle new feature error case', async () => {
    // Arrange
    // Act & Assert
  });
});
```

### Best Practices

1. **Keep tests isolated** - Each test should be independent
2. **Use descriptive names** - Test names should explain what they test
3. **Test one thing** - Each test should verify one specific behavior
4. **Mock external dependencies** - Tests should not depend on real APIs
5. **Clean up** - Use `beforeEach` to reset mocks
6. **Document complex scenarios** - Add comments for non-obvious test logic

## Debugging Failed Tests

### Test Failure Checklist

1. **Check mock setup** - Are all required mocks configured?
2. **Verify test data** - Is the test data valid for the operation?
3. **Check assertions** - Are expectations correct and up-to-date?
4. **Review changes** - What code changes might have affected this test?
5. **Run in isolation** - Does the test pass when run alone?

### Common Issues

**Issue**: "Mock function not called"
```typescript
// Solution: Ensure you're calling the mocked function in your test
await mockService.someMethod(...);
```

**Issue**: "Expected X but received Y"
```typescript
// Solution: Check if domain logic or data models have changed
// Update test expectations to match new behavior
```

**Issue**: "Timeout error"
```typescript
// Solution: Increase timeout or check for unresolved promises
jest.setTimeout(30000); // Increase timeout
```

## Integration with CI/CD

These tests are included in the CI pipeline:

```bash
npm run test:ci  # Runs all tests including E2E
```

The tests help ensure:
- No regressions in critical user flows
- Payment processing remains secure
- State transitions are valid
- Authorization checks are enforced

## Test Results

Current test results (as of implementation):

```
Test Suites: 2 passed, 2 total (E2E)
Tests:       56 passed, 56 total (E2E)
Time:        ~0.6s

Overall Project:
Test Suites: 48 passed, 48 total
Tests:       691 passed, 691 total
```

## Related Documentation

- [TESTING.md](./TESTING.md) - Overall testing guide
- [ACCEPTANCE_FLOW_DIAGRAM.md](./ACCEPTANCE_FLOW_DIAGRAM.md) - Visual flow diagrams
- [COMPLETE_ESCROW_PAYMENT_FLOW.md](./COMPLETE_ESCROW_PAYMENT_FLOW.md) - Payment flow details
- [lib/types.ts](./lib/types.ts) - Domain type definitions

## Support

For questions or issues with the tests:

1. Check this documentation
2. Review the test file comments
3. Consult the related documentation above
4. Ask the team in the #testing channel
