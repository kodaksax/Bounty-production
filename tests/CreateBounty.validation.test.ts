// Unit tests for Create Bounty validation logic

/**
 * Validation function for title
 */
function validateTitle(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Title is required';
  }
  if (value.length < 5) {
    return 'Title must be at least 5 characters';
  }
  if (value.length > 120) {
    return 'Title must not exceed 120 characters';
  }
  return null;
}

/**
 * Validation function for description
 */
function validateDescription(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Description is required';
  }
  if (value.length < 20) {
    return 'Description must be at least 20 characters';
  }
  return null;
}

/**
 * Validation function for amount
 */
function validateAmount(amount: number, isForHonor: boolean): string | null {
  if (isForHonor) {
    return null;
  }
  if (!amount || amount < 1) {
    return 'Amount must be at least $1';
  }
  return null;
}

/**
 * Validation function for location
 */
function validateLocation(location: string, workType: string): string | null {
  if (workType === 'in_person') {
    if (!location || location.trim().length === 0) {
      return 'Location is required for in-person work';
    }
    if (location.length < 3) {
      return 'Location must be at least 3 characters';
    }
  }
  return null;
}

// Test Suite
console.log('Running Create Bounty Validation Tests...\n');

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    failCount++;
  }
}

function assertEqual(actual: any, expected: any) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

function assertNotNull(actual: any) {
  if (actual === null) {
    throw new Error('Expected non-null value');
  }
}

function assertNull(actual: any) {
  if (actual !== null) {
    throw new Error(`Expected null but got ${JSON.stringify(actual)}`);
  }
}

// Title validation tests
test('validateTitle: rejects empty string', () => {
  const error = validateTitle('');
  assertNotNull(error);
  assertEqual(error, 'Title is required');
});

test('validateTitle: rejects whitespace only', () => {
  const error = validateTitle('   ');
  assertNotNull(error);
});

test('validateTitle: rejects string shorter than 5 chars', () => {
  const error = validateTitle('Test');
  assertNotNull(error);
  assertEqual(error, 'Title must be at least 5 characters');
});

test('validateTitle: accepts valid title', () => {
  const error = validateTitle('Help me move furniture');
  assertNull(error);
});

test('validateTitle: rejects string longer than 120 chars', () => {
  const longTitle = 'a'.repeat(121);
  const error = validateTitle(longTitle);
  assertNotNull(error);
  assertEqual(error, 'Title must not exceed 120 characters');
});

test('validateTitle: accepts string exactly 120 chars', () => {
  const title = 'a'.repeat(120);
  const error = validateTitle(title);
  assertNull(error);
});

// Description validation tests
test('validateDescription: rejects empty string', () => {
  const error = validateDescription('');
  assertNotNull(error);
  assertEqual(error, 'Description is required');
});

test('validateDescription: rejects string shorter than 20 chars', () => {
  const error = validateDescription('Short description');
  assertNotNull(error);
  assertEqual(error, 'Description must be at least 20 characters');
});

test('validateDescription: accepts valid description', () => {
  const error = validateDescription('This is a valid description that is long enough to pass validation');
  assertNull(error);
});

test('validateDescription: accepts string exactly 20 chars', () => {
  const desc = 'a'.repeat(20);
  const error = validateDescription(desc);
  assertNull(error);
});

// Amount validation tests
test('validateAmount: accepts amount for paid bounty', () => {
  const error = validateAmount(50, false);
  assertNull(error);
});

test('validateAmount: rejects zero amount for paid bounty', () => {
  const error = validateAmount(0, false);
  assertNotNull(error);
  assertEqual(error, 'Amount must be at least $1');
});

test('validateAmount: accepts any amount for honor bounty', () => {
  const error = validateAmount(0, true);
  assertNull(error);
});

test('validateAmount: rejects negative amount', () => {
  const error = validateAmount(-10, false);
  assertNotNull(error);
});

test('validateAmount: accepts minimum valid amount', () => {
  const error = validateAmount(1, false);
  assertNull(error);
});

// Balance validation tests

/**
 * Validation function for balance check
 */
function validateBalanceCheck(amount: number, balance: number, isForHonor: boolean): string | null {
  if (isForHonor) {
    return null; // Honor bounties don't need balance validation
  }
  if (amount > balance) {
    return 'Insufficient balance';
  }
  return null;
}

test('validateBalanceCheck: accepts amount within balance', () => {
  const error = validateBalanceCheck(50, 100, false);
  assertNull(error);
});

test('validateBalanceCheck: rejects amount exceeding balance', () => {
  const error = validateBalanceCheck(150, 100, false);
  assertNotNull(error);
  assertEqual(error, 'Insufficient balance');
});

test('validateBalanceCheck: accepts any amount for honor bounty', () => {
  const error = validateBalanceCheck(150, 0, true);
  assertNull(error);
});

test('validateBalanceCheck: accepts exact balance amount', () => {
  const error = validateBalanceCheck(100, 100, false);
  assertNull(error);
});

test('validateBalanceCheck: rejects when balance is zero for paid bounty', () => {
  const error = validateBalanceCheck(50, 0, false);
  assertNotNull(error);
  assertEqual(error, 'Insufficient balance');
});

// Location validation tests
test('validateLocation: requires location for in-person work', () => {
  const error = validateLocation('', 'in_person');
  assertNotNull(error);
  assertEqual(error, 'Location is required for in-person work');
});

test('validateLocation: accepts location for in-person work', () => {
  const error = validateLocation('San Francisco, CA', 'in_person');
  assertNull(error);
});

test('validateLocation: does not require location for online work', () => {
  const error = validateLocation('', 'online');
  assertNull(error);
});

test('validateLocation: rejects short location for in-person work', () => {
  const error = validateLocation('SF', 'in_person');
  assertNotNull(error);
  assertEqual(error, 'Location must be at least 3 characters');
});

test('validateLocation: accepts minimum length location', () => {
  const error = validateLocation('NYC', 'in_person');
  assertNull(error);
});

// Summary
console.log(`\n${passCount + failCount} tests run`);
console.log(`✓ ${passCount} passed`);
if (failCount > 0) {
  console.log(`✗ ${failCount} failed`);
  process.exit(1);
} else {
  console.log('\nAll tests passed! ✓');
  process.exit(0);
}
