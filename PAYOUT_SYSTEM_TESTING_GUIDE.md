# Payout System Manual Testing Guide

## Prerequisites

Before testing, ensure you have:
- [ ] Stripe test keys configured in `.env`
- [ ] API server running (`npm run dev` in services/api)
- [ ] Expo app running (`npx expo start`)
- [ ] Test user account created and authenticated
- [ ] Email verification completed (if required)

## Environment Setup

```bash
# In your .env file (use test keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Test Scenarios

### 1. Stripe Connect Onboarding Flow

**Objective:** Verify users can complete Stripe Connect onboarding.

**Steps:**
1. Open the Wallet screen in the app
2. Tap "Withdraw" button
3. If not onboarded, you should see a warning about Stripe Connect
4. Tap "Complete Onboarding"
5. Browser/webview should open with Stripe onboarding
6. Fill in test details:
   - Business type: Individual
   - Country: United States
   - Email: test@example.com
   - Phone: Any valid format
   - SSN: 000-00-0000 (test mode)
   - Address: Any US address
   - DOB: Any date (18+ years ago)
7. Complete all required fields
8. Return to app

**Expected Results:**
- ✅ Onboarding URL opens successfully
- ✅ Form is pre-filled where possible
- ✅ All required fields can be completed
- ✅ After completion, user returns to app
- ✅ Onboarding status updates automatically
- ✅ Warning banner disappears

**Verification:**
```bash
# Check onboarding status via API
curl http://localhost:3000/connect/verify-onboarding \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Should return:
```json
{
  "onboarded": true,
  "accountId": "acct_...",
  "payoutsEnabled": true,
  "chargesEnabled": true
}
```

---

### 2. Add Bank Account

**Objective:** Verify users can add bank accounts for withdrawals.

**Steps:**
1. Ensure Stripe Connect onboarding is complete
2. In Wallet screen, tap "Withdraw"
3. In Bank Accounts section, tap "Add"
4. Fill in bank account details:
   - Account Holder Name: "John Doe"
   - Routing Number: "110000000"
   - Account Number: "000123456789"
   - Confirm Account Number: "000123456789"
   - Account Type: Select "Checking"
5. Tap "Add Bank Account"

**Expected Results:**
- ✅ Form validates routing number (must be 9 digits)
- ✅ Form validates account numbers match
- ✅ Success message appears
- ✅ Bank account appears in list
- ✅ Account shows last 4 digits (6789)
- ✅ Bank name appears (if provided by Stripe)
- ✅ Status shows "new" or "verified"

**Verification:**
```bash
# List bank accounts via API
curl http://localhost:3000/connect/bank-accounts \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Should return:
```json
{
  "bankAccounts": [
    {
      "id": "ba_...",
      "accountHolderName": "John Doe",
      "last4": "6789",
      "bankName": "STRIPE TEST BANK",
      "accountType": "checking",
      "status": "new",
      "default": false
    }
  ]
}
```

**Error Cases to Test:**
- [ ] Invalid routing number (8 digits) → Shows error
- [ ] Invalid routing number checksum → Shows error
- [ ] Account numbers don't match → Shows error
- [ ] Empty fields → Shows validation errors

---

### 3. Withdraw Funds

**Objective:** Verify users can withdraw funds to their bank account.

**Steps:**
1. Ensure you have funds in your wallet (add test funds if needed)
2. Open Withdraw screen
3. Enter withdrawal amount (e.g., $50.00)
4. Or use quick select: Tap "50%" button
5. Select a bank account from the list (if not already selected)
6. Tap "Withdraw $50.00" button

**Expected Results:**
- ✅ Amount validates against available balance
- ✅ Quick select buttons populate amount correctly
- ✅ Bank account is selected (radio button checked)
- ✅ Withdraw button is enabled
- ✅ Success dialog appears with details
- ✅ Balance updates immediately
- ✅ Estimated arrival time shown (1-2 business days)
- ✅ Transfer ID provided

**Verification:**
```bash
# Check wallet balance
curl http://localhost:3000/wallet/balance \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check transaction history
curl http://localhost:3000/wallet/transactions \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Balance should be reduced, transactions should show withdrawal.

**Check Stripe Dashboard:**
1. Log into Stripe Dashboard (test mode)
2. Go to Connect → Accounts
3. Find the test user's account
4. Check Transfers tab
5. Verify transfer was created

**Error Cases to Test:**
- [ ] Amount exceeds balance → Shows error
- [ ] No bank account selected → Shows error
- [ ] Amount is zero or negative → Shows error
- [ ] No bank accounts added → Prompts to add one
- [ ] Not onboarded → Prompts to complete onboarding
- [ ] Email not verified → Shows verification banner

---

### 4. Multiple Bank Accounts

**Objective:** Verify users can manage multiple bank accounts.

**Steps:**
1. Add first bank account (as in Test 2)
2. Add second bank account with different details:
   - Account Holder Name: "Jane Doe"
   - Routing Number: "110000000"
   - Account Number: "000987654321"
   - Account Type: "Savings"
3. Both accounts should appear in list
4. Tap on second account to select it
5. Initiate withdrawal

**Expected Results:**
- ✅ Both accounts appear in list
- ✅ Can switch between accounts
- ✅ Selected account shows visual indicator
- ✅ Withdrawal goes to selected account
- ✅ Can remove accounts (tap X button)
- ✅ Can set one as default

**Set Default Bank Account:**
```bash
# Set bank account as default
curl -X POST http://localhost:3000/connect/bank-accounts/ba_.../default \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Remove Bank Account:**
```bash
# Remove bank account
curl -X DELETE http://localhost:3000/connect/bank-accounts/ba_... \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5. Edge Cases & Error Handling

**Test invalid bank account details:**
- [ ] Routing number: "123456789" (invalid checksum)
- [ ] Routing number: "12345" (too short)
- [ ] Account number: "123" (too short)
- [ ] Account numbers don't match

**Test insufficient funds:**
- [ ] Try to withdraw more than balance
- [ ] Verify error message
- [ ] Balance unchanged

**Test without email verification:**
- [ ] Create new user without verified email
- [ ] Try to withdraw
- [ ] Verify email verification banner appears
- [ ] Verify withdrawal blocked

**Test concurrent withdrawals:**
- [ ] Initiate withdrawal
- [ ] Immediately try another withdrawal
- [ ] Verify proper handling (second should fail or wait)

**Test network errors:**
- [ ] Turn off API server
- [ ] Try to add bank account
- [ ] Verify error message
- [ ] No data corruption

---

### 6. UI/UX Verification

**Visual Checks:**
- [ ] Balance displays correctly
- [ ] Amount input formatting works (dollar sign, decimals)
- [ ] Quick select buttons work (25%, 50%, 75%, Max)
- [ ] Bank account cards display properly
- [ ] Selected account has visual indicator
- [ ] Default badge shows on default account
- [ ] Status indicators are clear
- [ ] Loading states appear during API calls
- [ ] Success/error messages are clear
- [ ] Scroll works if many bank accounts

**Accessibility:**
- [ ] All buttons have labels
- [ ] Form fields have labels
- [ ] Error messages are announced
- [ ] Can navigate with keyboard (web)
- [ ] Touch targets are adequate (mobile)

**Responsive Design:**
- [ ] Works on different screen sizes
- [ ] Keyboard doesn't cover inputs
- [ ] Safe areas respected (iPhone notch, etc.)

---

### 7. Transaction History

**Objective:** Verify withdrawals appear in transaction history.

**Steps:**
1. Complete a withdrawal (as in Test 3)
2. Go back to Wallet main screen
3. Tap "Transaction History" or scroll to transactions
4. Find the withdrawal transaction

**Expected Results:**
- ✅ Withdrawal appears in list
- ✅ Shows correct amount (negative)
- ✅ Shows transaction type "withdrawal"
- ✅ Shows date/time
- ✅ Shows status "pending" or "completed"
- ✅ Shows destination bank account (last 4)
- ✅ Can tap for details (if implemented)

---

### 8. Security Validation

**Verify sensitive data handling:**
- [ ] No full account numbers in API responses
- [ ] Only last 4 digits shown in UI
- [ ] No account numbers in logs
- [ ] No routing numbers exposed unnecessarily
- [ ] Auth required for all endpoints

**Test API endpoints without auth:**
```bash
# Should return 401 Unauthorized
curl http://localhost:3000/connect/bank-accounts

curl -X POST http://localhost:3000/connect/transfer \
  -H "Content-Type: application/json" \
  -d '{"amount": 50}'
```

**Verify HTTPS in production:**
- [ ] API uses HTTPS
- [ ] No mixed content warnings
- [ ] SSL certificate valid

---

## Test Data Reference

### Valid Test Bank Accounts (Stripe Test Mode)

```
Routing Number: 110000000
Account Number: 000123456789
Account Holder: Any name
Account Type: Checking or Savings

Alternative routing numbers for testing:
- 110000000 (STRIPE TEST BANK)
- 011401533 (Routing number valid for test mode)
```

### Invalid Test Data (Should Fail)

```
Invalid Routing Numbers:
- 123456789 (invalid checksum)
- 12345 (too short)
- 1234567890 (too long)

Invalid Account Numbers:
- 123 (too short)
- Empty
```

---

## Success Criteria

All tests should pass with:
- ✅ No crashes or errors
- ✅ Clear user feedback at all steps
- ✅ Proper error messages
- ✅ Balance updates correctly
- ✅ Transactions recorded properly
- ✅ UI is responsive and accessible
- ✅ Security measures in place

---

## Troubleshooting

### "Stripe Connect account required"
- User hasn't completed onboarding
- Complete onboarding flow first

### "Bank account required"
- No bank accounts added
- Add bank account first

### "Email verification required"
- User's email not verified
- Complete email verification

### "Failed to add bank account"
- Check Stripe API key is correct
- Verify routing number is valid
- Check API server logs

### Transfer not appearing in Stripe
- Check test mode vs live mode
- Verify Connect account ID
- Check Stripe dashboard logs

---

## Reporting Issues

When reporting issues, include:
1. Step-by-step reproduction
2. Expected vs actual behavior
3. Screenshots/videos
4. Device/platform details
5. API logs (if available)
6. Stripe dashboard screenshots

---

## Automation Potential

Consider automating:
- [ ] Onboarding flow with Playwright/Detox
- [ ] Bank account addition
- [ ] Withdrawal flow
- [ ] Error cases
- [ ] API endpoint testing with Postman/Newman
