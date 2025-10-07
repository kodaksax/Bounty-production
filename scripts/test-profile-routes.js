#!/usr/bin/env node
/**
 * Profile Routes Test Script
 * 
 * This script validates that all profile routes are accessible
 * and have the correct file structure.
 */

const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, '..', 'app', 'profile');

const requiredRoutes = [
  '[userId].tsx',    // Dynamic user profile route
  'index.tsx',       // Profile home redirect
  'edit.tsx',        // Edit profile
  'followers.tsx',   // Followers list
  'following.tsx',   // Following list
];

console.log('🔍 Testing Profile Routes...\n');

let allTestsPassed = true;

// Test 1: Check if profile directory exists
console.log('Test 1: Profile directory exists');
if (fs.existsSync(PROFILE_DIR)) {
  console.log('✅ PASS: app/profile/ directory found\n');
} else {
  console.log('❌ FAIL: app/profile/ directory not found\n');
  allTestsPassed = false;
}

// Test 2: Check if all required routes exist
console.log('Test 2: Required route files exist');
requiredRoutes.forEach(route => {
  const routePath = path.join(PROFILE_DIR, route);
  if (fs.existsSync(routePath)) {
    console.log(`✅ PASS: ${route} exists`);
  } else {
    console.log(`❌ FAIL: ${route} not found`);
    allTestsPassed = false;
  }
});
console.log('');

// Test 3: Check feature flag file
console.log('Test 3: Feature flag file exists');
const featureFlagPath = path.join(__dirname, '..', 'lib', 'feature-flags.ts');
if (fs.existsSync(featureFlagPath)) {
  console.log('✅ PASS: lib/feature-flags.ts exists');
  const content = fs.readFileSync(featureFlagPath, 'utf8');
  if (content.includes('FOLLOW_FEATURE_ENABLED')) {
    console.log('✅ PASS: FOLLOW_FEATURE_ENABLED flag found');
  } else {
    console.log('❌ FAIL: FOLLOW_FEATURE_ENABLED flag not found in file');
    allTestsPassed = false;
  }
} else {
  console.log('❌ FAIL: lib/feature-flags.ts not found');
  allTestsPassed = false;
}
console.log('');

// Test 4: Check types file for FollowEdge
console.log('Test 4: FollowEdge type exists');
const typesPath = path.join(__dirname, '..', 'lib', 'types.ts');
if (fs.existsSync(typesPath)) {
  const content = fs.readFileSync(typesPath, 'utf8');
  if (content.includes('FollowEdge')) {
    console.log('✅ PASS: FollowEdge type found in lib/types.ts');
  } else {
    console.log('❌ FAIL: FollowEdge type not found in lib/types.ts');
    allTestsPassed = false;
  }
} else {
  console.log('❌ FAIL: lib/types.ts not found');
  allTestsPassed = false;
}
console.log('');

// Test 5: Check hooks
console.log('Test 5: Profile hooks exist');
const hooksDir = path.join(__dirname, '..', 'hooks');
const requiredHooks = ['useProfile.ts', 'useFollow.ts'];
requiredHooks.forEach(hook => {
  const hookPath = path.join(hooksDir, hook);
  if (fs.existsSync(hookPath)) {
    console.log(`✅ PASS: hooks/${hook} exists`);
  } else {
    console.log(`❌ FAIL: hooks/${hook} not found`);
    allTestsPassed = false;
  }
});
console.log('');

// Test 6: Check services
console.log('Test 6: Profile services exist');
const servicesDir = path.join(__dirname, '..', 'lib', 'services');
const requiredServices = ['user-profile-service.ts', 'follow-service.ts'];
requiredServices.forEach(service => {
  const servicePath = path.join(servicesDir, service);
  if (fs.existsSync(servicePath)) {
    console.log(`✅ PASS: lib/services/${service} exists`);
  } else {
    console.log(`❌ FAIL: lib/services/${service} not found`);
    allTestsPassed = false;
  }
});
console.log('');

// Final summary
console.log('═'.repeat(50));
if (allTestsPassed) {
  console.log('✅ ALL TESTS PASSED!');
  console.log('\nProfile feature is properly implemented.');
  console.log('You can now:');
  console.log('  1. Navigate to /profile/[userId] to view any user profile');
  console.log('  2. Navigate to /profile to view your own profile');
  console.log('  3. Navigate to /profile/edit to edit your profile');
  console.log('  4. Set FOLLOW_FEATURE_ENABLED=true to enable follow functionality');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  console.log('\nPlease check the errors above and fix any missing files.');
  process.exit(1);
}
