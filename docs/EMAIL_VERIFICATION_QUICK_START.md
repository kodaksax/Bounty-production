# Email Verification Gate - Quick Start Guide

## For Developers

### Using the Email Verification Status

```typescript
import { useAuthContext } from 'hooks/use-auth-context'

function MyComponent() {
  const { isEmailVerified } = useAuthContext()
  
  // Check before allowing restricted actions
  if (!isEmailVerified) {
    Alert.alert(
      'Email verification required',
      "Please verify your email to continue."
    )
    return
  }
  
  // Proceed with action...
}
```

### Resending Verification Email

```typescript
import { resendVerification } from 'lib/services/auth-service'

async function handleResendEmail() {
  const { session } = useAuthContext()
  const result = await resendVerification(session?.user?.email)
  
  if (result.success) {
    Alert.alert('Success', result.message)
  } else {
    Alert.alert('Error', result.message)
  }
}
```

### Adding New Gates

To add a gate to any new action:

1. Import the hook:
```typescript
import { useAuthContext } from 'hooks/use-auth-context'
```

2. Destructure the flag:
```typescript
const { isEmailVerified } = useAuthContext()
```

3. Add the check:
```typescript
const handleMyAction = async () => {
  // Email verification gate
  if (!isEmailVerified) {
    Alert.alert(
      'Email verification required',
      "Please verify your email to [action]."
    )
    return
  }
  
  // Your action code...
}
```

## For Testers

### Quick Test (5 minutes)

1. **Test Signup Flow:**
   ```
   Sign up → Should route to /onboarding/username
   Complete onboarding → Should route to /tabs/bounty-app
   ```

2. **Test Post Gate (Unverified):**
   ```
   Navigate to Postings → New
   Fill form and tap Post
   → Should show "Email verification required" alert
   → Bounty should NOT be created
   ```

3. **Test Apply Gate (Unverified):**
   ```
   Open any bounty detail
   Tap "Apply for Bounty"
   → Should show "Email verification required" alert
   → Application should NOT be created
   ```

4. **Test After Verification:**
   ```
   Verify email (check inbox or Supabase dashboard)
   Restart app
   Try posting → Should succeed
   Try applying → Should succeed
   ```

## For Product Managers

### User Impact

**Before Verification:**
- ✅ Can sign up and onboard
- ✅ Can browse all bounties
- ✅ Can view bounty details
- ✅ Can chat (messages)
- ✅ Can view wallet
- ❌ Cannot post bounties
- ❌ Cannot apply to bounties

**After Verification:**
- ✅ All restrictions removed
- ✅ Can post bounties
- ✅ Can apply to bounties

### Metrics to Track

1. **Verification Rate:**
   - % of users who verify within 24h
   - % of users who verify within 7d

2. **Conversion:**
   - % of blocked attempts that convert after verification
   - Time from block to conversion

3. **Drop-off:**
   - % of users who abandon after seeing alert
   - % who never verify

4. **Support:**
   - Reduction in spam/abuse tickets
   - Increase in "help me verify" tickets

## For Support Team

### Common Issues

**"I verified but still can't post/apply"**
1. Have user sign out and sign back in
2. Check Supabase Auth dashboard for `email_confirmed_at`
3. If still issues, restart app completely

**"I never received verification email"**
1. Check spam folder
2. Use resend verification function (when implemented in UI)
3. Verify email address is correct in profile

**"Why do I need to verify?"**
Explain: "Email verification ensures a safe marketplace and reduces spam. It only takes a minute!"

**"Can I browse without verifying?"**
Yes! Users can browse, view details, and explore the app. Only posting and applying require verification.

## Configuration

### Environment Variables
None required. Uses existing Supabase configuration.

### Feature Flags
No feature flags. Gate is active for all users.

### Customization
To customize the alert message, edit these files:
- `app/tabs/postings-screen.tsx` (lines 234-240, 250-256)
- `components/bountydetailmodal.tsx` (lines 135-141)
- `app/screens/CreateBounty/StepReview.tsx` (lines 25-32)

## Rollback Plan

If issues arise, the feature can be temporarily disabled:

1. **Quick disable (emergency):**
   Edit `providers/auth-provider.tsx`:
   ```typescript
   // Line 18: Force verification to true
   const [isEmailVerified, setIsEmailVerified] = useState<boolean>(true) // Was: false
   ```

2. **Proper rollback:**
   ```bash
   git revert 2a3969f  # Revert implementation commit
   git revert a1235c9  # Revert gate commit
   ```

3. **Partial disable:**
   Comment out specific gates in:
   - PostingsScreen (posting)
   - BountyDetailModal (applying)
   - CreateBounty/StepReview (multi-step)

## Resources

- **Full Documentation:** `docs/AUTH_EMAIL_VERIFICATION_GATE.md`
- **Test Plan:** `tests/email-verification-gate.test.md`
- **Implementation Summary:** `IMPLEMENTATION_SUMMARY_EMAIL_VERIFICATION.md`
- **Architecture:** See `README.md` and `COPILOT_AGENT.md`

## Questions?

For implementation questions, refer to:
- Technical details: `docs/AUTH_EMAIL_VERIFICATION_GATE.md`
- Testing: `tests/email-verification-gate.test.md`
- Code: Check inline comments marked with `// Email verification gate:`
