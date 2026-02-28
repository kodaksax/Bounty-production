# Code Cleanup Guide for Production Launch

## Overview
This guide covers code cleanup tasks required before production launch, including removing debug statements, commented code, and running quality checks.

## 🧹 Console Statement Cleanup

### Current State
**Note:** To get current counts, run:
```bash
# Total non-error console statements
grep -r "console\.\(log\|warn\|debug\|info\)" app/ lib/ components/ hooks/ \
  --include="*.ts" --include="*.tsx" | wc -l
```

- **Approximate total:** ~1,959 console statements (as of initial assessment)
- **console.log statements:** ~1,500
- **console.warn statements:** ~300
- **console.error statements:** ~159 (keep these for error tracking)

### Cleanup Strategy

#### 1. Keep These Console Statements
Console.error statements should be KEPT as they're important for error tracking:
```typescript
console.error('[ComponentName] Error description:', error);
```

#### 2. Remove These Console Statements
All console.log and console.warn in production code should be removed or converted:

**Debug Logs:**
```typescript
// REMOVE these
console.log('✅ Success message');
console.log('DEBUG: variable value:', value);
console.debug('Diagnostic info');
```

**Warning Logs:**
```typescript
// CONVERT these to error tracking or remove
console.warn('Non-critical warning');
console.warn('[Component] failed to do optional thing', error);
```

#### 3. Recommended Approach

**Option A: Manual Removal (Recommended for Critical Files)**
- Review each file individually
- Decide whether to remove or convert to error tracking
- Keep console.error for production errors

**Option B: Automated with ESLint Rule**
Add to `.eslintrc.js`:
```javascript
rules: {
  'no-console': ['error', { 
    allow: ['error', 'warn'] // Only allow console.error and console.warn in production
  }],
}
```

Then run: `npm run lint -- --fix` (be careful, review changes)

**Option C: Build-Time Removal**
Use babel plugin to strip console statements in production builds:
```bash
npm install --save-dev babel-plugin-transform-remove-console
```

Add to `babel.config.js`:
```javascript
module.exports = function(api) {
  const isProduction = api.env('production');
  
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      isProduction && ['transform-remove-console', { 
        exclude: ['error', 'warn'] 
      }],
    ].filter(Boolean),
  };
};
```

### Priority Files for Manual Cleanup

High-priority files with excessive logging:

1. **app/tabs/postings-screen.tsx** - 25+ console statements
2. **app/_layout.tsx** - Runtime checks and debug logs
3. **app/tabs/bounty-app.tsx** - Initialization logs
4. **lib/services/stripe-service.ts** - Payment logging
5. **app/services/bountyService.ts** - Core business logic logging

### Example Cleanup Pattern

**Before:**
```typescript
export async function createBounty(data: BountyInput) {
  console.log('Creating bounty with data:', data);
  
  try {
    const result = await api.post('/bounties', data);
    console.log('✅ Bounty created successfully:', result.id);
    return result;
  } catch (error) {
    console.warn('Failed to create bounty:', error);
    throw error;
  }
}
```

**After:**
```typescript
export async function createBounty(data: BountyInput) {
  try {
    const result = await api.post('/bounties', data);
    // Track success event for analytics (already using Mixpanel)
    return result;
  } catch (error) {
    // Keep error logging for Sentry
    console.error('[bountyService] Failed to create bounty:', error);
    throw error;
  }
}
```

## 📝 Commented Code Removal

### Finding Commented Code
```bash
# Find files with excessive commented code
grep -r "^[[:space:]]*//" app/ --include="*.tsx" --include="*.ts" | \
  cut -d: -f1 | uniq -c | sort -rn | head -20
```

### Guidelines

#### Remove These Comments
1. **Old implementation code:**
```typescript
// const oldWay = () => { ... }
```

2. **Disabled debug code:**
```typescript
// console.log('debug info');
```

3. **Temporary workarounds:**
```typescript
// FIXME: This is a hack, replace later
```

4. **Commented imports:**
```typescript
// import { OldComponent } from './old';
```

#### Keep These Comments
1. **API documentation:**
```typescript
/**
 * Creates a new bounty with escrow protection
 * @param data - Bounty creation data
 * @returns Created bounty with ID
 */
```

2. **Important context:**
```typescript
// NOTE: We must validate amount BEFORE creating escrow
// to prevent fund locking on invalid bounties
```

3. **TODOs for future (but mark as post-launch):**
```typescript
// TODO (Post-Launch): Add support for recurring bounties
```

4. **Complex logic explanations:**
```typescript
// Calculate reputation score using weighted average:
// - Recent completions (70%)
// - Historical rating (30%)
```

### Priority Files with Commented Code

Files to review (found via grep):
1. **app/verification/upload-id.tsx** - Integration TODOs
2. **app/services/bountyService.ts** - Old implementation comments
3. **app/(admin)/analytics.tsx** - TODO for authentication

## 🔧 Linting

### Running ESLint

**Check for issues:**
```bash
npm run lint
```

**Auto-fix where possible:**
```bash
npm run lint -- --fix
```

**Check specific directory:**
```bash
npx eslint app/ --ext .ts,.tsx
```

### Common Lint Issues to Fix

1. **Unused imports:**
```typescript
// Before
import { useState, useEffect, useMemo } from 'react';
// Only using useState

// After
import { useState } from 'react';
```

2. **Unused variables:**
```typescript
// Before
const [loading, setLoading] = useState(false);
// setLoading never used

// After
const [loading] = useState(false);
// Or remove if loading is also unused
```

3. **Missing dependencies in useEffect:**
```typescript
// Before
useEffect(() => {
  fetchData(userId);
}, []); // userId not in deps

// After
useEffect(() => {
  fetchData(userId);
}, [userId]);
```

4. **Any type usage:**
```typescript
// Before
const data: any = response.data;

// After
const data: BountyData = response.data;
```

## 📊 Type Checking

### Running TypeScript Compiler

**Check all files:**
```bash
npx tsc --noEmit
```

**Check specific directory:**
```bash
npx tsc --noEmit --project tsconfig.json
```

**Check with verbose output:**
```bash
npx tsc --noEmit --pretty
```

### Common Type Issues to Fix

1. **Implicit any:**
```typescript
// Before
function process(data) { ... }

// After
function process(data: BountyInput): Promise<Bounty> { ... }
```

2. **Null/undefined checks:**
```typescript
// Before
const name = user.profile.name; // Could be null

// After
const name = user.profile?.name ?? 'Anonymous';
```

3. **Type assertions:**
```typescript
// Before
const element = document.getElementById('root') as HTMLElement;

// After (in React Native, this shouldn't exist - remove web-specific code)
```

4. **Strict mode violations:**
```typescript
// Before
let value: string;
console.log(value); // Used before assigned

// After
let value: string | undefined;
// Or initialize: let value = '';
```

## 🎯 Production Checklist

### Before Building

- [ ] Run linter: `npm run lint`
- [ ] Fix all lint errors (ignore warnings if minor)
- [ ] Run type check: `npx tsc --noEmit`
- [ ] Fix all type errors
- [ ] Remove or suppress console.log/console.warn
- [ ] Remove commented code blocks
- [ ] Remove TODO/FIXME comments (or mark as post-launch)
- [ ] Test all critical flows manually
- [ ] Verify no debug/development code in production

### During Build

- [ ] Use production profile: `eas build --platform all --profile production`
- [ ] Verify environment variables are production values
- [ ] Check build warnings for issues
- [ ] Test production build on real device before submission

### After Build

- [ ] Install and test production build
- [ ] Verify no console output in release build
- [ ] Check crash reporting (Sentry) is working
- [ ] Verify analytics (Mixpanel) events fire
- [ ] Test payment flow end-to-end
- [ ] Submit to TestFlight/Play Beta for final validation

## 🛠️ Automated Cleanup Script

### Create Cleanup Script

Create `scripts/cleanup-for-production.js`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧹 Starting production cleanup...\n');

// 1. Run linter
console.log('📋 Running ESLint...');
try {
  execSync('npm run lint', { stdio: 'inherit' });
  console.log('✅ Linting passed\n');
} catch (error) {
  console.log('⚠️  Linting found issues. Review and fix before proceeding.\n');
}

// 2. Run type checker
console.log('📊 Running TypeScript compiler...');
try {
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ Type checking passed\n');
} catch (error) {
  console.log('⚠️  Type checking found issues. Review and fix before proceeding.\n');
}

// 3. Check for console statements (excluding console.error)
console.log('🔍 Checking for console statements...');
try {
  const result = execSync(
    'grep -r "console\\.(log\\|warn\\|debug\\|info)" app/ lib/ components/ --include="*.ts" --include="*.tsx" | wc -l',
    { encoding: 'utf-8' }
  ).trim();
  
  const count = parseInt(result);
  if (count > 0) {
    console.log(`⚠️  Found ${count} console statements (excluding console.error)`);
    console.log('   Review and remove debug logging before production build.\n');
  } else {
    console.log('✅ No non-error console statements found\n');
  }
} catch (error) {
  console.log('ℹ️  Could not check console statements\n');
}

// 4. Check for TODOs and FIXMEs
console.log('📝 Checking for TODO/FIXME comments...');
try {
  const result = execSync(
    'grep -r "TODO\\|FIXME" app/ lib/ components/ --include="*.ts" --include="*.tsx" | wc -l',
    { encoding: 'utf-8' }
  ).trim();
  
  const count = parseInt(result);
  if (count > 0) {
    console.log(`ℹ️  Found ${count} TODO/FIXME comments`);
    console.log('   Review and address or mark as post-launch.\n');
  } else {
    console.log('✅ No TODO/FIXME comments found\n');
  }
} catch (error) {
  console.log('ℹ️  Could not check TODO/FIXME comments\n');
}

console.log('🎉 Production cleanup check complete!');
console.log('\nNext steps:');
console.log('1. Address any issues found above');
console.log('2. Run: eas build --platform all --profile production');
console.log('3. Test production build thoroughly');
console.log('4. Submit to app stores\n');
```

Make executable:
```bash
chmod +x scripts/cleanup-for-production.js
```

Run:
```bash
node scripts/cleanup-for-production.js
```

## 📚 Additional Resources

- [ESLint Documentation](https://eslint.org/docs/latest/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [React Native Performance](https://reactnative.dev/docs/performance)
- [Expo Production Considerations](https://docs.expo.dev/distribution/introduction/)

## ⚠️ Important Notes

1. **Don't remove all console.error:** These are needed for Sentry error tracking
2. **Test after cleanup:** Always test the app after removing logging
3. **Use version control:** Commit before major cleanup operations
4. **Review carefully:** Don't blindly auto-fix - some logging may be intentional
5. **Consider build-time removal:** Babel plugin is safer than manual removal

---

**Ready to proceed?** Follow the checklist above and ensure all quality checks pass before building for production.
