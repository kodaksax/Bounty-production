# Email Verification Gate - Manual Test Script

## Prerequisites
- App running on device or simulator
- Access to test email account
- Ability to clear app data / fresh install

## Test Suite 1: Signup → Onboarding → Dashboard Flow

### Test 1.1: New User Signup with Session
**Steps:**
1. Launch app
2. Navigate to Sign Up screen
3. Enter valid email: `test+newuser@example.com`
4. Enter valid password meeting requirements (8+ chars, upper, lower, number, special)
5. Confirm password
6. Tap "Create Account"

**Expected Results:**
✅ Signup succeeds
✅ Immediately routed to `/onboarding/username` (no manual navigation needed)
✅ Session remains active (no re-login required)

### Test 1.2: Complete Onboarding
**Steps:**
1. Complete username step
2. Complete details step (optional fields)
3. Complete phone step (optional)
4. Reach "Done" screen with checkmark animation
5. Tap "Continue to Bounty"

**Expected Results:**
✅ Routed to `/tabs/bounty-app`
✅ Default tab is "bounty" (dashboard/home)
✅ Bottom navigation is visible
✅ User can navigate between tabs
✅ Session is still active (no sign-out)

---

## Test Suite 2: Email Verification Gate - Posting Bounties

### Test 2.1: Attempt to Post from Postings Screen (Unverified)
**Steps:**
1. Sign in with unverified account
2. Navigate to "Postings" tab via bottom nav
3. Select "New" tab
4. Fill in bounty form:
   - Title: "Test Bounty for Verification"
   - Description: "This is a test"
   - Amount: $50
   - Location: "Test City"
5. Tap "Post" or "Confirm" button

**Expected Results:**
✅ Alert appears with title: "Email verification required"
✅ Alert message: "Please verify your email to post bounties. We've sent a verification link to your inbox."
✅ Alert has "OK" button
✅ After dismissing alert, form data is NOT cleared
✅ Bounty is NOT created in database
✅ User remains on New tab

### Test 2.2: Attempt to Post from Multi-Step Flow (Unverified)
**Steps:**
1. Sign in with unverified account (if not already)
2. Start multi-step create bounty flow (if available)
3. Complete all steps: Title, Description, Compensation, Location
4. Reach Review step
5. Tap "Post Bounty" or "I Understand, Post Bounty"

**Expected Results:**
✅ Alert appears before escrow modal (if not for honor)
✅ Alert title: "Email verification required"
✅ Alert message: "Please verify your email to post bounties..."
✅ Bounty is NOT created
✅ User can go back and edit bounty

---

## Test Suite 3: Email Verification Gate - Applying to Bounties

### Test 3.1: Attempt to Apply from Bounty Detail (Unverified)
**Steps:**
1. Sign in with unverified account
2. Navigate to Dashboard (bounty tab)
3. Open any bounty detail modal
4. Tap "Apply for Bounty" button at bottom

**Expected Results:**
✅ Alert appears with title: "Email verification required"
✅ Alert message: "Please verify your email to apply for bounties..."
✅ Alert has "OK" button
✅ Application is NOT created
✅ Button does NOT show "Application Submitted"
✅ User remains in bounty detail modal

### Test 3.2: Apply Button State (Unverified)
**Steps:**
1. Sign in with unverified account
2. Open bounty detail for a bounty you haven't applied to

**Expected Results:**
✅ "Apply for Bounty" button is enabled (not grayed out)
✅ Button shows normal state (not "Application Submitted")
✅ Tapping button triggers verification alert

---

## Test Suite 4: Allowed Actions Without Verification

### Test 4.1: Browsing and Viewing
**Steps:**
1. Sign in with unverified account
2. Navigate to Dashboard
3. Browse bounties in feed
4. Open bounty detail modal
5. View attachments
6. Send messages in bounty detail

**Expected Results:**
✅ Can browse all bounties
✅ Can open bounty details
✅ Can view all bounty information
✅ Can send messages (if messaging is independent)
✅ No verification alerts appear

### Test 4.2: Navigation
**Steps:**
1. Sign in with unverified account
2. Navigate to each tab: Messenger, Wallet, Bounty, Postings, Profile

**Expected Results:**
✅ Can access all tabs
✅ Can view wallet balance
✅ Can view profile
✅ Can view messenger conversations
✅ No verification alerts for viewing

---

## Test Suite 5: After Email Verification

### Test 5.1: Verify Email and Retry Post
**Steps:**
1. Sign in with account
2. Check email inbox for verification link
3. Click verification link (or simulate by directly confirming in Supabase)
4. Return to app and force refresh (pull down on feed OR restart app)
5. Navigate to Postings → New
6. Fill in valid bounty form
7. Tap "Post" button

**Expected Results:**
✅ No alert appears
✅ Confirmation card shows (if enabled)
✅ Bounty is created successfully
✅ Success message appears
✅ Bounty appears in "My Postings" tab
✅ User routed to bounty feed

### Test 5.2: Verify Email and Retry Apply
**Steps:**
1. Verify email (if not already done in 5.1)
2. Force app refresh or restart
3. Navigate to Dashboard
4. Open any bounty detail
5. Tap "Apply for Bounty"

**Expected Results:**
✅ No verification alert appears
✅ Application is submitted
✅ Success alert shows: "Application Submitted"
✅ Button state changes to "Application Submitted"
✅ User can view application in "In Progress" tab

---

## Test Suite 6: Edge Cases

### Test 6.1: Rapid Tap During Verification Check
**Steps:**
1. Sign in with unverified account
2. Fill bounty form
3. Tap "Post" button multiple times rapidly

**Expected Results:**
✅ Alert appears only once
✅ Only one API call is made (if logged)
✅ No duplicate bounties created

### Test 6.2: Network Error During Verification Check
**Steps:**
1. Sign in with unverified account
2. Enable airplane mode or disconnect network
3. Try to post bounty

**Expected Results:**
✅ Either: verification alert appears (if cached state is unverified)
✅ Or: network error alert appears before verification check
✅ No bounty is created

### Test 6.3: Session Expires While Unverified
**Steps:**
1. Sign in with unverified account
2. Wait for session to expire (or manually invalidate)
3. Try to post bounty

**Expected Results:**
✅ User is redirected to sign-in screen
✅ Or: Auth error appears
✅ No bounty is created

---

## Test Suite 7: Developer Experience

### Test 7.1: Console Logging
**Steps:**
1. Open browser/React Native debugger console
2. Sign in with unverified account
3. Try to post and apply

**Expected Results:**
✅ `isEmailVerified: false` is logged on auth state change
✅ Verification check happens before API calls
✅ No errors or warnings in console

### Test 7.2: TypeScript Types
**Steps:**
1. Open VS Code or IDE
2. Navigate to `hooks/use-auth-context.tsx`
3. Verify `isEmailVerified` is in `AuthData` type

**Expected Results:**
✅ TypeScript recognizes `isEmailVerified` property
✅ No type errors when using `const { isEmailVerified } = useAuthContext()`

---

## Test Results Log

| Test ID | Date | Tester | Pass/Fail | Notes |
|---------|------|--------|-----------|-------|
| 1.1     |      |        |           |       |
| 1.2     |      |        |           |       |
| 2.1     |      |        |           |       |
| 2.2     |      |        |           |       |
| 3.1     |      |        |           |       |
| 3.2     |      |        |           |       |
| 4.1     |      |        |           |       |
| 4.2     |      |        |           |       |
| 5.1     |      |        |           |       |
| 5.2     |      |        |           |       |
| 6.1     |      |        |           |       |
| 6.2     |      |        |           |       |
| 6.3     |      |        |           |       |
| 7.1     |      |        |           |       |
| 7.2     |      |        |           |       |

---

## Debugging Tips

### Issue: Alert not showing
- Check: Is `useAuthContext()` imported and used?
- Check: Is `isEmailVerified` destructured from context?
- Check: Console log `isEmailVerified` value before check
- Check: Is auth provider wrapping the app?

### Issue: User claims email is verified but still sees alert
- Check: Supabase Auth dashboard → Users → email_confirmed_at field
- Check: Console log `session?.user?.email_confirmed_at`
- Force user to sign out and sign back in
- Clear app cache/data and restart

### Issue: Bounty created despite alert
- Check: Is `return` statement after `Alert.alert()`?
- Check: Is verification check before `bountyService.create()`?
- Check: Are there multiple post handlers (ensure all have gate)?

---

## Automated Test Stubs (Future Implementation)

```typescript
// Example Jest test for PostingsScreen
describe('Email Verification Gate - Posting', () => {
  it('should show alert when unverified user tries to post', async () => {
    // Mock useAuthContext to return isEmailVerified: false
    jest.spyOn(require('hooks/use-auth-context'), 'useAuthContext')
      .mockReturnValue({ isEmailVerified: false })
    
    // Render PostingsScreen
    const { getByText } = render(<PostingsScreen {...props} />)
    
    // Fill form and tap post
    fireEvent.press(getByText('Post'))
    
    // Expect Alert.alert to be called
    expect(Alert.alert).toHaveBeenCalledWith(
      'Email verification required',
      expect.any(String),
      expect.any(Array)
    )
  })
})
```

## References
- Implementation Doc: `/docs/AUTH_EMAIL_VERIFICATION_GATE.md`
- Auth Context: `/hooks/use-auth-context.tsx`
- Auth Provider: `/providers/auth-provider.tsx`
- Auth Service: `/lib/services/auth-service.ts`
