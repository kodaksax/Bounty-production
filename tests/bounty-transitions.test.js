const {
  transitionBounty,
  isValidTransition,
  getValidTransitions,
  bountyCreateSchema,
  bountyUpdateSchema,
  bountyFilterSchema
} = require('../lib/domain/bounty-transitions');

// Simple test framework
function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Assertion failed: ${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`✅ ${testName}`);
    return true;
  } catch (error) {
    console.error(`❌ ${testName}: ${error.message}`);
    return false;
  }
}

// Test valid transitions
function testValidTransitions() {
  // Test open -> in_progress (accept)
  const result1 = transitionBounty('open', 'accept');
  assertEqual(result1, { success: true, newStatus: 'in_progress' }, 'Open to in_progress via accept');

  // Test in_progress -> completed (complete)
  const result2 = transitionBounty('in_progress', 'complete');
  assertEqual(result2, { success: true, newStatus: 'completed' }, 'In_progress to completed via complete');

  // Test open -> archived (archive)
  const result3 = transitionBounty('open', 'archive');
  assertEqual(result3, { success: true, newStatus: 'archived' }, 'Open to archived via archive');

  // Test in_progress -> archived (archive)
  const result4 = transitionBounty('in_progress', 'archive');
  assertEqual(result4, { success: true, newStatus: 'archived' }, 'In_progress to archived via archive');

  // Test completed -> archived (archive)
  const result5 = transitionBounty('completed', 'archive');
  assertEqual(result5, { success: true, newStatus: 'archived' }, 'Completed to archived via archive');
}

// Test invalid transitions
function testInvalidTransitions() {
  // Test open -> completed (complete) - should fail
  const result1 = transitionBounty('open', 'complete');
  assertFalse(result1.success, 'Open to completed should fail');
  assertTrue(result1.error.includes('Cannot transition from open to completed'), 'Should have proper error message');

  // Test completed -> in_progress (accept) - should fail
  const result2 = transitionBounty('completed', 'accept');
  assertFalse(result2.success, 'Completed to in_progress should fail');

  // Test archived -> any status - should fail
  const result3 = transitionBounty('archived', 'accept');
  assertFalse(result3.success, 'Archived to any status should fail');

  const result4 = transitionBounty('archived', 'complete');
  assertFalse(result4.success, 'Archived to any status should fail');

  const result5 = transitionBounty('archived', 'archive');
  assertFalse(result5.success, 'Archived to archived should fail');
}

// Test isValidTransition helper
function testIsValidTransitionHelper() {
  assertTrue(isValidTransition('open', 'accept'), 'Open to accept should be valid');
  assertTrue(isValidTransition('in_progress', 'complete'), 'In_progress to complete should be valid');
  assertTrue(isValidTransition('open', 'archive'), 'Open to archive should be valid');
  
  assertFalse(isValidTransition('open', 'complete'), 'Open to complete should be invalid');
  assertFalse(isValidTransition('completed', 'accept'), 'Completed to accept should be invalid');
  assertFalse(isValidTransition('archived', 'accept'), 'Archived to accept should be invalid');
}

// Test getValidTransitions helper
function testGetValidTransitions() {
  assertEqual(getValidTransitions('open'), ['accept', 'archive'], 'Open should allow accept and archive');
  assertEqual(getValidTransitions('in_progress'), ['complete', 'archive'], 'In_progress should allow complete and archive');
  assertEqual(getValidTransitions('completed'), ['archive'], 'Completed should only allow archive');
  assertEqual(getValidTransitions('archived'), [], 'Archived should allow no transitions');
}

// Test Zod validation schemas
function testBountyCreateSchema() {
  // Valid bounty data
  const validBounty = {
    title: 'Test bounty title',
    description: 'This is a test bounty description that is long enough to pass validation',
    amount: 100,
    is_for_honor: false,
    location: 'Test location',
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    work_type: 'online'
  };

  const result = bountyCreateSchema.safeParse(validBounty);
  assertTrue(result.success, 'Valid bounty should pass validation');

  // Invalid bounty - title too short
  const invalidBounty1 = {
    ...validBounty,
    title: 'Test'
  };
  const result1 = bountyCreateSchema.safeParse(invalidBounty1);
  assertFalse(result1.success, 'Short title should fail validation');

  // Invalid bounty - description too short
  const invalidBounty2 = {
    ...validBounty,
    description: 'Too short'
  };
  const result2 = bountyCreateSchema.safeParse(invalidBounty2);
  assertFalse(result2.success, 'Short description should fail validation');

  // Invalid bounty - negative amount
  const invalidBounty3 = {
    ...validBounty,
    amount: -10
  };
  const result3 = bountyCreateSchema.safeParse(invalidBounty3);
  assertFalse(result3.success, 'Negative amount should fail validation');

  // Invalid bounty - invalid UUID
  const invalidBounty4 = {
    ...validBounty,
    user_id: '' // Empty user ID
  };
  const result4 = bountyCreateSchema.safeParse(invalidBounty4);
  assertFalse(result4.success, 'Empty user ID should fail validation');
}

function testBountyFilterSchema() {
  // Valid filters
  const validFilter1 = { status: 'open' };
  const result1 = bountyFilterSchema.safeParse(validFilter1);
  assertTrue(result1.success, 'Valid status filter should pass');

  const validFilter2 = { user_id: '123e4567-e89b-12d3-a456-426614174000' };
  const result2 = bountyFilterSchema.safeParse(validFilter2);
  assertTrue(result2.success, 'Valid user_id filter should pass');

  const validFilter3 = { work_type: 'in_person' };
  const result3 = bountyFilterSchema.safeParse(validFilter3);
  assertTrue(result3.success, 'Valid work_type filter should pass');

  // Invalid filters
  const invalidFilter1 = { status: 'invalid_status' };
  const result4 = bountyFilterSchema.safeParse(invalidFilter1);
  assertFalse(result4.success, 'Invalid status should fail validation');

  const invalidFilter2 = { user_id: '' }; // Empty user ID
  const result5 = bountyFilterSchema.safeParse(invalidFilter2);
  assertFalse(result5.success, 'Empty user ID should fail validation');
}

// Run all tests
function runAllTests() {
  console.log('🧪 Running bounty transition tests...\n');
  
  let passedTests = 0;
  let totalTests = 0;

  const tests = [
    ['Valid transitions', testValidTransitions],
    ['Invalid transitions', testInvalidTransitions],
    ['isValidTransition helper', testIsValidTransitionHelper],
    ['getValidTransitions helper', testGetValidTransitions],
    ['Bounty create schema validation', testBountyCreateSchema],
    ['Bounty filter schema validation', testBountyFilterSchema]
  ];

  tests.forEach(([name, testFn]) => {
    totalTests++;
    if (runTest(name, testFn)) {
      passedTests++;
    }
  });

  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('💥 Some tests failed');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testValidTransitions,
  testInvalidTransitions,
  testIsValidTransitionHelper,
  testGetValidTransitions,
  testBountyCreateSchema,
  testBountyFilterSchema
};