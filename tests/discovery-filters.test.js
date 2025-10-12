// tests/discovery-filters.test.js - Unit tests for discovery filtering and sorting

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

// Mock bounties for testing
function createMockBounties() {
  return [
    {
      id: 1,
      title: 'Fix React Bug',
      description: 'Need help fixing a React component',
      amount: 50,
      is_for_honor: false,
      location: 'Seattle, WA',
      work_type: 'online',
      created_at: '2025-10-10T10:00:00Z',
    },
    {
      id: 2,
      title: 'Move Furniture',
      description: 'Help moving a couch',
      amount: 100,
      is_for_honor: false,
      location: 'Portland, OR',
      work_type: 'in_person',
      created_at: '2025-10-11T10:00:00Z',
    },
    {
      id: 3,
      title: 'Code Review',
      description: 'Review my pull request',
      amount: 0,
      is_for_honor: true,
      location: 'Remote',
      work_type: 'online',
      created_at: '2025-10-12T10:00:00Z',
    },
    {
      id: 4,
      title: 'Garden Work',
      description: 'Need help with yard work',
      amount: 75,
      is_for_honor: false,
      location: 'Seattle, WA',
      work_type: 'in_person',
      created_at: '2025-10-09T10:00:00Z',
    },
    {
      id: 5,
      title: 'Website Design',
      description: 'Design a landing page',
      amount: 200,
      is_for_honor: false,
      location: 'San Francisco, CA',
      work_type: 'online',
      created_at: '2025-10-08T10:00:00Z',
    },
  ];
}

// Mock distance calculation (deterministic for testing)
function calculateDistance(location) {
  const distances = {
    'Seattle, WA': 5,
    'Portland, OR': 15,
    'Remote': 0,
    'San Francisco, CA': 50,
  };
  return distances[location] || 10;
}

// Test: Filter by amount range
runTest('Filter by amount range ($50-$100)', () => {
  const bounties = createMockBounties();
  const filtered = bounties.filter((b) => {
    if (b.is_for_honor) return true;
    const amount = Number(b.amount) || 0;
    return amount >= 50 && amount <= 100;
  });
  
  assertEqual(filtered.length, 4, 'Should include 3 bounties in range plus 1 honor bounty');
  assertTrue(filtered.some(b => b.id === 1), 'Should include bounty with $50');
  assertTrue(filtered.some(b => b.id === 2), 'Should include bounty with $100');
  assertTrue(filtered.some(b => b.id === 4), 'Should include bounty with $75');
  assertTrue(filtered.some(b => b.id === 3), 'Should include honor bounty');
});

// Test: Filter by work type
runTest('Filter by work type (online only)', () => {
  const bounties = createMockBounties();
  const filtered = bounties.filter((b) => b.work_type === 'online');
  
  assertEqual(filtered.length, 3, 'Should have 3 online bounties');
  assertTrue(filtered.every(b => b.work_type === 'online'), 'All bounties should be online');
});

// Test: Filter by distance
runTest('Filter by max distance (20 miles)', () => {
  const bounties = createMockBounties();
  const filtered = bounties.filter((b) => calculateDistance(b.location) <= 20);
  
  assertEqual(filtered.length, 4, 'Should include 4 bounties within 20 miles');
  assertTrue(!filtered.some(b => b.id === 5), 'Should exclude San Francisco bounty (50 miles)');
});

// Test: Sort by newest
runTest('Sort by newest (creation date)', () => {
  const bounties = createMockBounties();
  const sorted = [...bounties].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  
  assertEqual(sorted[0].id, 3, 'Newest bounty should be first');
  assertEqual(sorted[sorted.length - 1].id, 5, 'Oldest bounty should be last');
});

// Test: Sort by highest pay
runTest('Sort by highest pay', () => {
  const bounties = createMockBounties();
  const sorted = [...bounties].sort((a, b) => Number(b.amount) - Number(a.amount));
  
  assertEqual(sorted[0].id, 5, 'Highest paying bounty ($200) should be first');
  assertEqual(sorted[1].id, 2, 'Second highest ($100) should be second');
});

// Test: Sort by nearest
runTest('Sort by nearest (distance)', () => {
  const bounties = createMockBounties();
  const sorted = [...bounties].sort((a, b) => 
    calculateDistance(a.location) - calculateDistance(b.location)
  );
  
  // Verify sorting order is correct (ascending distances)
  const distances = sorted.map(b => calculateDistance(b.location));
  for (let i = 1; i < distances.length; i++) {
    assertTrue(distances[i] >= distances[i-1], `Distance at index ${i} should be >= previous distance`);
  }
  
  // First should be smallest, last should be largest
  assertTrue(distances[0] <= distances[distances.length - 1], 'First distance should be <= last distance');
  assertEqual(distances[distances.length - 1], 50, 'Last bounty should have 50 miles distance');
});

// Test: Combined filters (online + amount range)
runTest('Combined filters: online work with $50-$200 range', () => {
  const bounties = createMockBounties();
  const filtered = bounties.filter((b) => {
    // Work type filter
    if (b.work_type !== 'online') return false;
    
    // Amount range filter (skip honor bounties)
    if (!b.is_for_honor) {
      const amount = Number(b.amount) || 0;
      if (amount < 50 || amount > 200) return false;
    }
    
    return true;
  });
  
  assertEqual(filtered.length, 3, 'Should have 3 results (2 paid + 1 honor)');
  assertTrue(filtered.some(b => b.id === 1), 'Should include React bug ($50)');
  assertTrue(filtered.some(b => b.id === 5), 'Should include website design ($200)');
  assertTrue(filtered.some(b => b.id === 3), 'Should include honor bounty');
});

// Test: Honor bounties always pass amount filter
runTest('Honor bounties bypass amount filters', () => {
  const bounties = createMockBounties();
  const filtered = bounties.filter((b) => {
    if (b.is_for_honor) return true; // Honor bounties always included
    const amount = Number(b.amount) || 0;
    return amount >= 100; // Only $100+ bounties
  });
  
  assertEqual(filtered.length, 3, 'Should have 2 paid bounties + 1 honor');
  assertTrue(filtered.some(b => b.id === 3), 'Honor bounty should be included despite $0 amount');
});

// Test: Empty result handling
runTest('Handle empty results gracefully', () => {
  const bounties = createMockBounties();
  const filtered = bounties.filter((b) => {
    // Impossible criteria: online AND in_person
    return b.work_type === 'online' && b.work_type === 'in_person';
  });
  
  assertEqual(filtered.length, 0, 'Should return empty array for impossible criteria');
});

console.log('\n🎯 Discovery Filters Test Suite Complete');
