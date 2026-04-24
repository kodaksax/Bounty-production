# Payment Methods Error Fix - Documentation Index

## Quick Start

If you're experiencing payment method errors (card or bank account), start here:

1. **Read the Summary** → [`PAYMENT_METHODS_FIX_SUMMARY.md`](./PAYMENT_METHODS_FIX_SUMMARY.md)
   - Quick overview of the problem and solution
   - 5-minute read

2. **Follow the Visual Guide** → [`PAYMENT_METHODS_FIX_VISUAL_GUIDE.md`](./PAYMENT_METHODS_FIX_VISUAL_GUIDE.md)
   - See diagrams of what went wrong
   - Step-by-step fix checklist
   - Before/after error message comparison

3. **Configure Your Keys** → [`STRIPE_KEY_CONFIGURATION_GUIDE.md`](./STRIPE_KEY_CONFIGURATION_GUIDE.md)
   - Complete configuration instructions
   - Environment-specific setup
   - Troubleshooting guide

## Document Overview

### 📄 PAYMENT_METHODS_FIX_SUMMARY.md
**Audience**: Developers, Project Managers  
**Length**: ~10,000 characters  
**Contents**:
- Problem description
- Root cause analysis
- Solution approach
- Code changes summary
- Testing recommendations
- Rollback plan
- Future improvements

**When to use**: 
- Getting an overview of the fix
- Understanding the technical changes
- Planning testing and deployment

### 📊 PAYMENT_METHODS_FIX_VISUAL_GUIDE.md
**Audience**: All users (developers and non-developers)  
**Length**: ~14,000 characters  
**Contents**:
- Visual diagrams of the error
- Before/after screenshots
- Configuration flow diagrams
- Quick fix checklist
- Error messages reference
- Success indicators

**When to use**:
- First time seeing the error
- Visual learner
- Want step-by-step instructions
- Need to understand the problem quickly

### 🔧 STRIPE_KEY_CONFIGURATION_GUIDE.md
**Audience**: Developers, DevOps  
**Length**: ~7,000 characters  
**Contents**:
- Explanation of test vs live modes
- How to get Stripe keys
- Configuration for all environments
- Common errors and solutions
- Troubleshooting guide
- Quick reference tables

**When to use**:
- Setting up Stripe for the first time
- Switching between environments
- Troubleshooting configuration issues
- Reference for environment variables

## Common Scenarios

### Scenario 1: "I see the card error in the screenshots"

1. Read: [`PAYMENT_METHODS_FIX_VISUAL_GUIDE.md`](./PAYMENT_METHODS_FIX_VISUAL_GUIDE.md) (Section: "The Problem")
2. Follow: Quick Fix Checklist in the same document
3. Reference: [`STRIPE_KEY_CONFIGURATION_GUIDE.md`](./STRIPE_KEY_CONFIGURATION_GUIDE.md) for detailed configuration

**Estimated time**: 15-30 minutes to fix

### Scenario 2: "I need to set up Stripe keys from scratch"

1. Read: [`STRIPE_KEY_CONFIGURATION_GUIDE.md`](./STRIPE_KEY_CONFIGURATION_GUIDE.md)
2. Follow: "Getting Your Keys" section
3. Use: Quick Reference table for all environment variables
4. Test: Using test cards from the guide

**Estimated time**: 20-40 minutes for first-time setup

### Scenario 3: "Backend logs show KEY MODE MISMATCH"

1. Check: Backend logs for the exact warning message
2. Read: [`PAYMENT_METHODS_FIX_SUMMARY.md`](./PAYMENT_METHODS_FIX_SUMMARY.md) (Section: "How to Fix")
3. Update: Environment variables as described
4. Restart: Backend and mobile app
5. Verify: Check logs again for confirmation

**Estimated time**: 10-15 minutes

### Scenario 4: "Bank account shows 'Not Found' error"

1. Verify: Backend server is running (`cd services/api && npm run dev`)
2. Check: Mobile app `.env` has correct `EXPO_PUBLIC_API_URL`
3. Confirm: Backend has `STRIPE_SECRET_KEY` configured
4. Reference: [`STRIPE_KEY_CONFIGURATION_GUIDE.md`](./STRIPE_KEY_CONFIGURATION_GUIDE.md) (Section: "Troubleshooting")

**Estimated time**: 5-10 minutes

### Scenario 5: "I'm a developer reviewing this PR"

1. Read: [`PAYMENT_METHODS_FIX_SUMMARY.md`](./PAYMENT_METHODS_FIX_SUMMARY.md)
2. Review: Code changes in the "Files Modified" table
3. Check: Testing recommendations
4. Verify: Documentation is complete

**Estimated time**: 20-30 minutes for full review

## File Structure

```
Bounty-production/
├── PAYMENT_METHODS_FIX_SUMMARY.md         ← Start here for overview
├── PAYMENT_METHODS_FIX_VISUAL_GUIDE.md    ← Visual learners start here
├── STRIPE_KEY_CONFIGURATION_GUIDE.md      ← Reference for configuration
├── PAYMENT_METHODS_FIX_README.md          ← This file (navigation guide)
│
├── lib/services/
│   └── stripe-service.ts                   ← Key mode detection
├── components/
│   ├── add-card-modal.tsx                  ← Enhanced error handling
│   ├── add-bank-account-modal.tsx          ← Better error messages
│   └── payment-element-wrapper.tsx         ← Mode mismatch detection
└── services/api/src/routes/
    └── payments.ts                          ← Backend validation
```

## Key Concepts

### Test Mode vs Live Mode

**Test Mode** (Development):
- Keys: `sk_test_...`, `pk_test_...`
- Use test credit cards (e.g., 4242 4242 4242 4242)
- No real money charged
- For development and testing

**Live Mode** (Production):
- Keys: `sk_live_...`, `pk_live_...`
- Use real credit cards only
- Real money charged
- For production only

**Golden Rule**: Both backend and frontend must use keys from the **same mode**.

### Environment Variables

| Variable | Where | Mode Prefix | Example |
|----------|-------|-------------|---------|
| `STRIPE_SECRET_KEY` | Backend | `sk_test_` or `sk_live_` | Used to create PaymentIntents |
| `STRIPE_PUBLISHABLE_KEY` | Backend (optional) | `pk_test_` or `pk_live_` | For backend validation |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Frontend | `pk_test_` or `pk_live_` | Used by Stripe SDK in app |

### The Error

**What you see**:
```
No such setupintent: 'seti_1XXX...'; a similar object exists in live mode, 
but a test mode key was used to make this request.
```

**What it means**:
- Backend created a SetupIntent in **live mode** (using `sk_live_...`)
- Frontend tried to access it in **test mode** (using `pk_test_...`)
- Stripe API rejected the request because modes don't match

**How to fix**:
Make sure both keys are from the same mode (both test OR both live).

## Additional Resources

### Stripe Documentation
- [API Keys](https://stripe.com/docs/keys)
- [Testing](https://stripe.com/docs/testing)
- [React Native SDK](https://stripe.com/docs/payments/accept-a-payment?platform=react-native)

### Stripe Dashboard
- [Dashboard Home](https://dashboard.stripe.com)
- [API Keys Page](https://dashboard.stripe.com/apikeys)
- [Webhooks](https://dashboard.stripe.com/webhooks)

### Internal Documentation
- Backend setup: `services/api/README.md`
- Mobile app setup: `README.md`
- General Stripe integration: `STRIPE_INTEGRATION.md`

## Support

### Getting Help

1. **Check the documentation** (you're here!)
2. **Review backend logs** for warnings and errors
3. **Verify environment variables** are set correctly
4. **Test with test keys** first before using live keys
5. **Check Stripe Dashboard** for any issues with your account

### Common Mistakes

❌ **Don't do this**:
```bash
# Backend
STRIPE_SECRET_KEY="sk_live_..."

# Frontend
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

✅ **Do this instead**:
```bash
# Backend
STRIPE_SECRET_KEY="sk_test_..."

# Frontend
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

### Verification Checklist

- [ ] Backend logs show: `[payments] Stripe configured in test mode` (or live mode)
- [ ] No warnings about "KEY MODE MISMATCH"
- [ ] Both keys start with the same prefix (`_test_` or `_live_`)
- [ ] Can add payment methods without errors
- [ ] Test cards work (in test mode)

## Contributing

If you find issues with this fix or documentation:

1. Open an issue on GitHub
2. Include error messages and logs
3. Mention which document needs clarification
4. Suggest improvements

## Version History

- **v1.0** (Current): Initial implementation
  - Key mode detection
  - Enhanced error messages
  - Comprehensive documentation

---

**Last Updated**: 2026-01-02  
**Status**: ✅ Complete and ready for use  
**Questions?**: Check the documentation or open a GitHub issue
