#!/usr/bin/env node

/**
 * Validation Script for Onboarding Redirect Logic
 * 
 * This script validates the routing logic to ensure it handles all cases correctly:
 * - New users (onboarding_completed = false)
 * - Completed users (onboarding_completed = true)  
 * - Legacy users (onboarding_completed = undefined)
 * - Users without username
 */

// Simulate the routing logic from app/index.tsx
function determineRoute(profile) {
  const hasUsername = profile?.username
  const onboardingFlag = profile?.onboarding_completed
  
  // User needs to complete onboarding if:
  // 1. No username exists, OR
  // 2. onboarding_completed flag is explicitly false
  // 
  // undefined means old profile (completed before flag existed) - let them through
  const needsOnboarding = !hasUsername || onboardingFlag === false
  
  if (needsOnboarding) {
    return '/onboarding/username'
  } else {
    return '/tabs/bounty-app'
  }
}

// Test cases
const testCases = [
  {
    name: 'New user (onboarding_completed = false)',
    profile: { username: 'user123', onboarding_completed: false },
    expected: '/onboarding/username',
    reason: 'Flag is explicitly false'
  },
  {
    name: 'Completed user (onboarding_completed = true)',
    profile: { username: 'user456', onboarding_completed: true },
    expected: '/tabs/bounty-app',
    reason: 'Completed onboarding'
  },
  {
    name: 'Legacy user (onboarding_completed = undefined)',
    profile: { username: 'olduser', onboarding_completed: undefined },
    expected: '/tabs/bounty-app',
    reason: 'Treat undefined as completed (legacy)'
  },
  {
    name: 'User without username (completed flag true)',
    profile: { username: '', onboarding_completed: true },
    expected: '/onboarding/username',
    reason: 'No username means needs onboarding'
  },
  {
    name: 'User with null username',
    profile: { username: null, onboarding_completed: true },
    expected: '/onboarding/username',
    reason: 'No username means needs onboarding'
  },
  {
    name: 'No profile',
    profile: null,
    expected: '/onboarding/username',
    reason: 'No profile means needs onboarding'
  },
  {
    name: 'Empty profile object',
    profile: {},
    expected: '/onboarding/username',
    reason: 'No username or flag means needs onboarding'
  },
  {
    name: 'Legacy user with empty username',
    profile: { username: '', onboarding_completed: undefined },
    expected: '/onboarding/username',
    reason: 'No username takes precedence'
  }
]

// Run tests
console.log('🧪 Testing Onboarding Redirect Logic\n')
console.log('='.repeat(60))

let passed = 0
let failed = 0

testCases.forEach((test, index) => {
  const result = determineRoute(test.profile)
  const success = result === test.expected
  
  if (success) {
    passed++
    console.log(`✅ Test ${index + 1}: ${test.name}`)
    console.log(`   Expected: ${test.expected}`)
    console.log(`   Result:   ${result}`)
    console.log(`   Reason:   ${test.reason}`)
  } else {
    failed++
    console.log(`❌ Test ${index + 1}: ${test.name}`)
    console.log(`   Expected: ${test.expected}`)
    console.log(`   Result:   ${result}`)
    console.log(`   Reason:   ${test.reason}`)
    console.log(`   ⚠️  FAILED!`)
  }
  console.log('')
})

console.log('='.repeat(60))
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`)

if (failed === 0) {
  console.log('✨ All tests passed! Logic is correct.')
  process.exit(0)
} else {
  console.log('❌ Some tests failed. Please review the logic.')
  process.exit(1)
}
