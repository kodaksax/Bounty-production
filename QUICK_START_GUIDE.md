# Quick Start Guide - Implementing Audit Recommendations

**For Developers Starting Sprint 1**

This guide gets you up and running with the first critical fixes from the comprehensive audit.

---

## ⚡ Before You Start

### Required Reading (30 minutes)
1. **AUDIT_EXECUTIVE_SUMMARY.md** (10 min) - Understand the big picture
2. **AUDIT_ACTION_PLAN.md** - Sprint 1 section (20 min) - Know your tasks

### Required Tools
- Node.js 18-20
- npm/pnpm
- Docker & Docker Compose
- Git
- Code editor (VS Code recommended)

---

## 🚀 Sprint 1: Day 1 - Environment Setup

### Step 1: Clone and Install (30 minutes)

```bash
# Clone the repository
git clone https://github.com/kodaksax/Bounty-production.git
cd Bounty-production

# Install dependencies (takes ~5 minutes)
npm install --legacy-peer-deps

# Verify installation
node -v  # Should be 18.x or 20.x
npm -v   # Should be 8.x or higher
```

### Step 2: Fix Jest Installation (15 minutes)

```bash
# Install missing test dependencies
npm install --save-dev jest @types/jest ts-jest
npm install --save-dev @testing-library/react-native
npm install --save-dev @testing-library/jest-native
npm install --save-dev @testing-library/react-hooks

# Verify Jest is installed
npx jest --version
# Should output: Jest v29.7.0 or similar

# Try running tests (will likely have errors, that's expected)
npm test
```

**Expected Output:** 
- Jest should execute (not "jest: not found")
- Tests may fail, but Jest binary should work

**If It Fails:**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
npm install --save-dev jest @types/jest ts-jest
```

---

### Step 3: Fix Workspace Dependencies (30 minutes)

```bash
# Fix domain-types package
cd packages/domain-types
npm install zod
cd ../..

# Fix api-client package
cd packages/api-client
npm install react
npm install @bountyexpo/domain-types
cd ../..

# Fix api package
cd services/api
npm install --save-dev @types/jest drizzle-orm
cd ../..

# Verify all workspaces build
npm run type-check

# Expected: Should pass without errors
```

**Expected Output:**
```
> @bountyexpo/domain-types@1.0.0 type-check
> tsc --noEmit
✓ No errors

> @bountyexpo/api-client@1.0.0 type-check
> tsc --noEmit
✓ No errors

> @bountyexpo/api@1.0.0 type-check
> tsc --noEmit
✓ No errors

> bountyexpo@1.0.0 type-check
> tsc --noEmit
✓ No errors
```

**If It Fails:**
- Check that you're in the correct directory
- Verify package.json has the dependency
- Try `npm ci` instead of `npm install`

---

### Step 4: Fix Security Vulnerabilities (15 minutes)

```bash
# View current vulnerabilities
npm audit

# Update vulnerable packages
npm update drizzle-kit

# Install replacement for deprecated packages
npm install --save-dev tsx
npm uninstall @esbuild-kit/core-utils @esbuild-kit/esm-loader

# Try to fix automatically
npm audit fix

# Check remaining vulnerabilities
npm audit

# Expected: 0 critical, 0 high, possibly some moderate
```

**Acceptable Result:**
- 0 critical vulnerabilities
- 0 high vulnerabilities
- <5 moderate (document if can't fix)

---

### Step 5: Verify Environment (15 minutes)

```bash
# Start Docker services
npm run dev

# Should see:
# ✅ PostgreSQL started on port 5432
# ✅ Stripe Mock started on port 12111

# In a new terminal, verify services
docker ps
# Should show: bountyexpo-postgres, stripe-mock

# Check database connection
docker exec -it bountyexpo-postgres psql -U bountyexpo -d bountyexpo -c "SELECT version();"
# Should output PostgreSQL version

# Test API health (after starting API server)
# In another terminal:
npm run dev:api

# In yet another terminal:
curl http://localhost:3001/health
# Should return: {"status":"ok"}
```

---

## 🧪 Sprint 1: Day 2 - Write First Tests

### Step 1: Create Test for Authentication (1 hour)

Create `__tests__/unit/auth-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { authService } from '../../lib/services/auth-service';

describe('Auth Service', () => {
  beforeEach(() => {
    // Setup before each test
  });

  describe('signup', () => {
    it('should create a new user account', async () => {
      // Arrange
      const email = 'test@example.com';
      const password = 'SecurePass123!';

      // Act
      const result = await authService.signup(email, password);

      // Assert
      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email);
    });

    it('should reject weak passwords', async () => {
      // Arrange
      const email = 'test@example.com';
      const password = '123'; // Too weak

      // Act & Assert
      await expect(
        authService.signup(email, password)
      ).rejects.toThrow();
    });
  });

  describe('signin', () => {
    it('should authenticate existing user', async () => {
      // Arrange
      const email = 'existing@example.com';
      const password = 'CorrectPassword123!';

      // Act
      const result = await authService.signin(email, password);

      // Assert
      expect(result).toBeDefined();
      expect(result.session).toBeDefined();
      expect(result.session.access_token).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      // Arrange
      const email = 'test@example.com';
      const password = 'WrongPassword';

      // Act & Assert
      await expect(
        authService.signin(email, password)
      ).rejects.toThrow();
    });
  });
});
```

Run the test:
```bash
npm test -- __tests__/unit/auth-service.test.ts
```

---

### Step 2: Create Test for Bounty Creation (1 hour)

Create `__tests__/unit/bounty-service.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import { bountyService } from '../../lib/services/bounty-service';

describe('Bounty Service', () => {
  describe('createBounty', () => {
    it('should create a new bounty', async () => {
      // Arrange
      const bountyData = {
        title: 'Fix my website',
        description: 'Need help with CSS',
        amount: 50,
        user_id: 'test-user-id',
        location: 'San Francisco, CA',
      };

      // Act
      const result = await bountyService.create(bountyData);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.title).toBe(bountyData.title);
      expect(result.status).toBe('open');
    });

    it('should validate required fields', async () => {
      // Arrange
      const invalidData = {
        title: '', // Empty title
        description: 'Test',
        amount: 50,
      };

      // Act & Assert
      await expect(
        bountyService.create(invalidData as any)
      ).rejects.toThrow('Title is required');
    });
  });

  describe('updateBountyStatus', () => {
    it('should update bounty status', async () => {
      // Arrange
      const bountyId = 'test-bounty-id';
      const newStatus = 'in_progress';

      // Act
      const result = await bountyService.updateStatus(bountyId, newStatus);

      // Assert
      expect(result.status).toBe(newStatus);
    });
  });
});
```

---

### Step 3: Run All Tests (15 minutes)

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Expected output:
# PASS __tests__/unit/auth-service.test.ts
# PASS __tests__/unit/bounty-service.test.ts
# 
# Tests: 5 passed, 5 total
# Coverage: ~30%

# View coverage report
open coverage/lcov-report/index.html  # Mac
# or
xdg-open coverage/lcov-report/index.html  # Linux
```

**Target for End of Day 2:**
- [ ] At least 5 tests passing
- [ ] Jest runs without errors
- [ ] Coverage report generates
- [ ] Coverage >20%

---

## 🔐 Sprint 1: Day 3 - Fix Authentication

### Step 1: Update Index Route (30 minutes)

Edit `app/index.tsx`:

```typescript
import { Redirect } from "expo-router";
import { SignInForm } from "app/auth/sign-in-form";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuthContext } from "../hooks/use-auth-context";

export default function Index() {
  const { isLoggedIn, isLoading } = useAuthContext();

  // Show loading spinner while checking auth state
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  // Redirect to main app if already logged in
  if (isLoggedIn) {
    return <Redirect href="/tabs/bounty-app" />;
  }

  // Show login form if not logged in
  return <SignInForm />;
}
```

### Step 2: Add Loading State to Auth Context (1 hour)

Edit `hooks/use-auth-context.tsx` (or wherever auth context is defined):

```typescript
// Add isLoading to the context
interface AuthContextValue {
  isLoggedIn: boolean;
  isLoading: boolean;  // Add this
  user: User | null;
  // ... other fields
}

// In the provider:
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  // Check for existing session on mount
  const checkSession = async () => {
    setIsLoading(true);
    try {
      const session = await supabase.auth.getSession();
      if (session.data.session) {
        setUser(session.data.session.user);
        setIsLoggedIn(true);
      }
    } catch (error) {
      console.error('Session check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  checkSession();
}, []);
```

### Step 3: Test Authentication Flow (30 minutes)

```bash
# Start the app
npm start

# Test scenarios:
# 1. Open app → Should see login screen
# 2. Login → Should redirect to main app
# 3. Close app → Reopen → Should stay logged in
# 4. Logout → Should return to login screen

# Verify in console:
# No errors about "navigation context"
# No flicker between login/main screen
```

---

## 💳 Sprint 1: Day 4-8 - Payment Integration

### Step 1: Set Up Stripe Connect (Day 4)

```bash
# Get Stripe API keys from dashboard
# https://dashboard.stripe.com/test/apikeys

# Add to .env file
STRIPE_SECRET_KEY=sk_test_...
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Test Stripe connection
curl https://api.stripe.com/v1/balance \
  -u sk_test_YOUR_KEY:

# Should return your account balance
```

### Step 2: Create Stripe Connect Account (Day 4)

Edit `lib/services/stripe-service.ts`:

```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export const createConnectAccount = async (userId: string, email: string) => {
  // Create a Stripe Connect account
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email: email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      userId: userId,
    },
  });

  return account;
};

export const createAccountLink = async (accountId: string) => {
  // Create onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: 'https://yourapp.com/reauth',
    return_url: 'https://yourapp.com/return',
    type: 'account_onboarding',
  });

  return accountLink.url;
};
```

### Step 3: Implement Escrow Flow (Day 5-6)

Update `lib/services/payment-service.ts`:

```typescript
export const createEscrow = async (
  bountyId: string,
  amount: number,
  posterId: string,
  hunterId: string
) => {
  // Create payment intent with transfer_data
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount * 100, // Convert to cents
    currency: 'usd',
    metadata: {
      bountyId,
      posterId,
      hunterId,
      type: 'escrow',
    },
    // Hold the funds
    capture_method: 'manual',
  });

  // Save escrow record in database
  const escrow = await db.insert(escrowTable).values({
    bountyId,
    amount,
    posterId,
    hunterId,
    stripePaymentIntentId: paymentIntent.id,
    status: 'held',
  });

  return { escrow, paymentIntent };
};

export const releaseEscrow = async (escrowId: string) => {
  // Get escrow record
  const escrow = await db.query.escrows.findFirst({
    where: eq(escrows.id, escrowId),
  });

  if (!escrow) throw new Error('Escrow not found');

  // Capture the payment
  await stripe.paymentIntents.capture(escrow.stripePaymentIntentId);

  // Update escrow status
  await db.update(escrowTable)
    .set({ status: 'released' })
    .where(eq(escrows.id, escrowId));

  // Create transfer to hunter's connected account
  const transfer = await stripe.transfers.create({
    amount: escrow.amount * 100,
    currency: 'usd',
    destination: escrow.hunterStripeAccountId,
    metadata: {
      bountyId: escrow.bountyId,
      escrowId: escrowId,
    },
  });

  return transfer;
};
```

### Step 4: Test Payment Flow (Day 7-8)

```bash
# Use Stripe test cards
# https://stripe.com/docs/testing#cards

# Success card: 4242 4242 4242 4242
# Decline card: 4000 0000 0000 0002

# Test scenarios:
# 1. Create bounty
# 2. Hunter accepts
# 3. Escrow created (funds held)
# 4. Work completed
# 5. Funds released to hunter

# Verify in Stripe dashboard:
# - Payment intent created
# - Funds captured
# - Transfer completed
```

---

## ✅ Sprint 1 Success Criteria

By end of Week 2, you should have:

- [ ] Jest tests running (`npm test` works)
- [ ] Workspace packages building (`npm run type-check` passes)
- [ ] 0 critical security vulnerabilities
- [ ] Auth state persists across app restarts
- [ ] Real Stripe payment flow working (test mode)
- [ ] 5+ tests passing
- [ ] Coverage report generating

---

## 🚨 Common Issues & Solutions

### Issue: "jest: not found"
**Solution:**
```bash
npm install --save-dev jest
npx jest --version  # Should work now
```

### Issue: "Cannot find module 'react'"
**Solution:**
```bash
cd packages/api-client
npm install react
cd ../..
```

### Issue: "Type check fails in workspaces"
**Solution:**
```bash
# Install missing dependencies in each workspace
npm install -w @bountyexpo/domain-types zod
npm install -w @bountyexpo/api-client react
npm install -w @bountyexpo/api -D @types/jest
```

### Issue: "Database connection failed"
**Solution:**
```bash
# Restart Docker services
npm run dev:stop
npm run dev

# Check if PostgreSQL is running
docker ps | grep postgres
```

### Issue: "Stripe API key invalid"
**Solution:**
- Verify you copied the full key (starts with `sk_test_`)
- Check for trailing spaces in .env file
- Restart API server after changing .env

---

## 📚 Additional Resources

### Documentation to Read
1. `COMPREHENSIVE_AUDIT_REPORT.md` - Full technical details
2. `AUDIT_ACTION_PLAN.md` - Complete sprint breakdown
3. `README.md` - Project setup guide
4. `STRIPE_INTEGRATION_BACKEND.md` - Payment integration details

### External Resources
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Stripe Connect Guide](https://stripe.com/docs/connect)
- [React Native Testing Library](https://callstack.github.io/react-native-testing-library/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

---

## 🆘 Getting Unstuck

**If you're stuck for >1 hour:**

1. **Check the audit reports** - Your issue may be documented
2. **Search existing documentation** - 100+ MD files available
3. **Check git history** - See how things were implemented
4. **Ask for help** - Share error messages and what you've tried

**Before asking for help, provide:**
- What you were trying to do
- What command you ran
- Full error message
- What you've tried so far

---

## 🎯 Daily Standup Template

**What I did yesterday:**
- Installed Jest and test dependencies
- Fixed workspace build issues
- Started writing first tests

**What I'm doing today:**
- Writing auth service tests
- Fixing authentication state persistence
- Setting up Stripe Connect

**Blockers:**
- None / [Describe blocker]

**Questions:**
- None / [Ask question]

---

**Good luck with Sprint 1! 🚀**

Remember: The goal is progress, not perfection. Get the critical fixes done, then move to Sprint 2.

---

**Created:** December 21, 2025  
**Last Updated:** December 21, 2025  
**For:** Sprint 1 Implementation Team
