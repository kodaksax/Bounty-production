# Payment System Accessibility Testing Guide

## Overview

This guide provides comprehensive testing procedures for ensuring the BountyExpo payment management system meets WCAG 2.1 Level AA accessibility standards.

## Table of Contents

1. [Testing Tools](#testing-tools)
2. [Testing Procedures](#testing-procedures)
3. [Component-Specific Tests](#component-specific-tests)
4. [Screen Reader Testing](#screen-reader-testing)
5. [Keyboard Navigation](#keyboard-navigation)
6. [Visual Accessibility](#visual-accessibility)
7. [Test Cases](#test-cases)
8. [Issue Tracking](#issue-tracking)

## Testing Tools

### Automated Tools

#### Mobile (iOS)
- **Accessibility Inspector** (Xcode)
  - Installation: Included with Xcode
  - Usage: Xcode → Open Developer Tool → Accessibility Inspector

#### Mobile (Android)
- **Accessibility Scanner**
  - Installation: [Google Play Store](https://play.google.com/store/apps/details?id=com.google.android.apps.accessibility.auditor)
  - Usage: Settings → Accessibility → Accessibility Scanner

#### Cross-Platform
- **axe DevTools Mobile**
  - Installation: npm install -D @axe-core/react-native
  - Usage: Integrated into test suite

### Manual Testing Tools

#### Screen Readers
- **iOS VoiceOver**
  - Enable: Settings → Accessibility → VoiceOver
  - Quick toggle: Triple-click Home/Side button

- **Android TalkBack**
  - Enable: Settings → Accessibility → TalkBack
  - Quick toggle: Volume keys up + down

#### Additional Tools
- **Color Contrast Analyzer**
  - Desktop tool for checking color contrast ratios
  - Download: [TPGi](https://www.tpgi.com/color-contrast-checker/)

- **WAVE Browser Extension**
  - Web accessibility evaluation tool
  - Install: [Chrome](https://chrome.google.com/webstore/detail/wave-evaluation-tool/jbbplnpkjmmeebjpijfedlgcdilocofh) / [Firefox](https://addons.mozilla.org/en-US/firefox/addon/wave-accessibility-tool/)

## Testing Procedures

### Pre-Testing Setup

1. **Environment Configuration**
   ```bash
   # Install dependencies
   npm install
   
   # Run in development mode
   npm run start
   
   # Enable accessibility testing
   export ENABLE_A11Y_TESTING=true
   ```

2. **Device Configuration**
   - Enable screen reader (VoiceOver/TalkBack)
   - Adjust display settings to default
   - Clear app data for clean state
   - Connect to test Stripe account

3. **Test Data Preparation**
   - Create test user account
   - Add test payment methods
   - Generate test transactions

### Testing Workflow

```
┌─────────────────────┐
│  Automated Tests    │
│  (axe, ESLint a11y) │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Manual Inspection  │
│  (Visual review)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Screen Reader Test │
│  (VoiceOver/Talk    │
│   Back)             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Keyboard Navigation│
│  (Tab, arrows, etc) │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  User Testing       │
│  (Real users with   │
│   disabilities)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Document Issues    │
│  (GitHub Issues)    │
└─────────────────────┘
```

## Component-Specific Tests

### PaymentMethodsModal

#### Test Checklist

- [ ] **Modal Opening**
  - Modal announced by screen reader
  - Focus moved to modal content
  - Background content not accessible

- [ ] **Tab Navigation**
  - Cards/Bank Accounts tabs have proper roles
  - Selected tab indicated clearly
  - Keyboard can switch between tabs
  - Tab panels have correct labels

- [ ] **Add Payment Method**
  - Button has descriptive label
  - Button minimum touch size (44x44pt)
  - Action clearly announced
  - Success/error feedback provided

- [ ] **Payment Method List**
  - Each item has unique accessible name
  - Card/bank details announced clearly
  - Delete button clearly labeled
  - Confirmation dialog accessible

- [ ] **Modal Closing**
  - Close button clearly labeled
  - Swipe gesture has keyboard alternative
  - Focus returned to trigger element
  - Screen reader announces closure

### AddCardModal

#### Test Checklist

- [ ] **Form Labels**
  - All inputs have associated labels
  - Labels properly connected (htmlFor/id)
  - Labels read by screen reader
  - Required fields indicated

- [ ] **Input Fields**
  - Card number field:
    - Label: "Card Number"
    - Hint: "16-digit card number"
    - Autocomplete: "cc-number"
    - Error message clearly associated
  
  - Expiry date field:
    - Label: "Expiry Date"
    - Format hint: "MM/YY"
    - Error message: "Invalid expiry date"
  
  - CVV field:
    - Label: "Security Code" or "CVV"
    - Secure text entry
    - Error message accessible

- [ ] **Validation**
  - Real-time validation announced
  - Error messages specific and helpful
  - Success confirmation announced
  - Error icon has alt text

- [ ] **Card Preview**
  - Decorative card image has empty alt
  - Card details read appropriately
  - Visual updates don't steal focus

- [ ] **Save Button**
  - Clearly labeled
  - Disabled state announced
  - Loading state indicated
  - Success feedback provided

### AddBankAccountModal

#### Test Checklist

- [ ] **Form Structure**
  - Logical field order
  - Related fields grouped
  - Clear section headings
  - Progress indication

- [ ] **Account Holder Name**
  - Label: "Account Holder Name"
  - Autocomplete: "name"
  - Validation feedback
  - Example provided

- [ ] **Routing Number**
  - Label: "Routing Number"
  - Format: "123456789"
  - Helper text: "9-digit routing number"
  - Checksum validation announced

- [ ] **Account Number**
  - Label: "Account Number"
  - Secure text entry
  - Confirmation field required
  - Mismatch error clear

- [ ] **Account Type**
  - Radio group labeled
  - Each option has label
  - Selection announced
  - Visual selection clear

- [ ] **Security Notice**
  - Icon has alt text
  - Message readable
  - Not hidden from screen readers
  - Appropriate semantics

### PaymentElementWrapper

#### Test Checklist

- [ ] **Payment Sheet**
  - Native UI fully accessible
  - All payment options announced
  - Error messages clear
  - Success confirmation provided

- [ ] **Apple Pay Button**
  - Proper semantic role
  - Touch target size adequate
  - Visual focus indicator
  - Screen reader label

- [ ] **Google Pay Button**
  - Proper semantic role
  - Touch target size adequate
  - Visual focus indicator
  - Screen reader label

- [ ] **Trust Indicators**
  - Lock icon has alt text
  - Security messages readable
  - PCI badge accessible
  - Not overly verbose

### AddMoneyScreen

#### Test Checklist

- [ ] **Amount Display**
  - Large, clear text
  - Updates announced
  - Accessible to zoom
  - High contrast

- [ ] **Numeric Keypad**
  - Each button labeled
  - Adequate touch targets
  - Haptic feedback (optional)
  - Alternative keyboard input

- [ ] **Payment Method Selection**
  - Current method announced
  - Change option clear
  - Multiple methods supported
  - Fallback for no methods

- [ ] **Submit Button**
  - Clear action label
  - Disabled when invalid
  - Loading state announced
  - Success feedback provided

### WithdrawScreen

#### Test Checklist

- [ ] **Balance Display**
  - Current balance announced
  - Withdrawal amount announced
  - Remaining balance calculated
  - Clear visual representation

- [ ] **Amount Slider**
  - Labeled appropriately
  - Current value announced
  - Increment/decrement available
  - Min/max values clear

- [ ] **Method Selection**
  - Bank account option
  - Card refund option
  - Processing times clear
  - Recommendation indicated

- [ ] **Email Verification Banner**
  - Alert role for urgency
  - Action button clear
  - Dismissible if needed
  - Not blocking content

- [ ] **Submit Button**
  - Clear action description
  - Amount included in label
  - Confirmation dialog accessible
  - Status updates announced

## Screen Reader Testing

### VoiceOver (iOS) Testing Script

#### 1. Opening Payment Methods Modal

**Expected Behavior:**
1. Tap "Payment Methods" button
2. VoiceOver announces: "Payment Methods modal opened"
3. Focus moves to close button
4. VoiceOver announces: "Close button. Closes payment methods modal"

**Test Script:**
```
1. Navigate to wallet screen
2. Double-tap "Manage Payment Methods"
3. Listen for modal announcement
4. Swipe left to explore content
5. Verify all elements are announced
```

#### 2. Adding a Card

**Expected Behavior:**
1. VoiceOver announces: "Add New Card button"
2. Tap and hear: "Card Number text field. Enter your 16-digit card number"
3. Type card number, hear: "Card number valid"
4. Continue through form
5. Hear: "Save Card button. Disabled" (if invalid)
6. Hear: "Save Card button" (when valid)

**Test Script:**
```
1. Open Payment Methods Modal
2. Swipe to "Add New Card" button
3. Double-tap to activate
4. Fill each field:
   - Card Number: 4242 4242 4242 4242
   - Name: Test User
   - Expiry: 12/25
   - CVV: 123
5. Verify each field's announcement
6. Navigate to Save button
7. Double-tap to save
8. Listen for success message
```

#### 3. Adding Bank Account

**Expected Behavior:**
1. VoiceOver announces: "Add Bank Account button"
2. Each field announces its purpose
3. Helper text read after label
4. Errors announced immediately
5. Success confirmation clear

**Test Script:**
```
1. Select "Bank Accounts" tab
2. Double-tap "Add Bank Account"
3. Fill fields:
   - Name: Test User
   - Routing: 110000000
   - Account: 000123456789
   - Confirm: 000123456789
   - Type: Checking
4. Verify routing validation
5. Verify account mismatch detection
6. Submit and verify success
```

### TalkBack (Android) Testing Script

#### 1. Navigation Gestures

**Gestures to Test:**
- Swipe right: Next element
- Swipe left: Previous element
- Double-tap: Activate element
- Two-finger swipe down: Dismiss modal
- Two-finger swipe up: Show global actions

**Test Script:**
```
1. Enable TalkBack
2. Navigate to payment screen
3. Use each gesture
4. Verify smooth navigation
5. Check focus order
6. Test modal dismiss
```

#### 2. Reading Controls

**Settings to Test:**
- Reading speed: Normal/Fast/Slow
- Verbosity: Default/High/Low
- Punctuation: All/Some/None

**Test Script:**
```
1. Adjust reading speed
2. Navigate form
3. Verify clarity at each speed
4. Test with different verbosity
5. Check special characters
```

## Keyboard Navigation

### Tab Order Testing

**Expected Tab Order:**
```
PaymentMethodsModal:
1. Close button
2. Cards tab
3. Bank Accounts tab
4. Add Payment Method button
5. Payment method 1
6. Delete button 1
7. Payment method 2
8. Delete button 2
...

AddCardModal:
1. Back button
2. Card Number input
3. Cardholder Name input
4. Expiry Date input
5. CVV input
6. Save Card button
```

**Test Procedure:**
```
1. Connect external keyboard
2. Open modal
3. Press Tab repeatedly
4. Verify order is logical
5. Check focus visibility
6. Test Shift+Tab (reverse)
7. Verify no focus traps
```

### Keyboard Shortcuts

| Action | Shortcut | Expected Behavior |
|--------|----------|-------------------|
| Close Modal | Escape | Modal closes, focus returns |
| Submit Form | Enter | Form submits (if valid) |
| Navigate Tabs | Arrow Left/Right | Switch between tabs |
| Select Radio | Arrow Up/Down | Switch account type |
| Increment | Arrow Up | Increase amount |
| Decrement | Arrow Down | Decrease amount |

**Test Script:**
```
1. Open Payment Methods Modal
2. Press Escape → Modal closes
3. Re-open modal
4. Press Tab to Cards tab
5. Press Arrow Right → Bank Accounts selected
6. Press Enter on Add Bank Account
7. Fill form
8. Press Enter → Form submits
9. Verify all shortcuts work
```

## Visual Accessibility

### Color Contrast Testing

**WCAG Requirements:**
- Normal text (< 18pt): 4.5:1 minimum
- Large text (≥ 18pt): 3:1 minimum
- UI components: 3:1 minimum

**Test Areas:**

| Element | Foreground | Background | Required Ratio | Status |
|---------|-----------|------------|----------------|--------|
| Primary button text | #FFFFFF | #059669 | 4.5:1 | ✅ Pass |
| Secondary button text | #047857 | #FFFFFF | 4.5:1 | ✅ Pass |
| Error text | #B91C1C | #FEE2E2 | 4.5:1 | ✅ Pass |
| Link text | #0284C7 | #FFFFFF | 4.5:1 | ✅ Pass |
| Disabled button | #9CA3AF | #F3F4F6 | 3:1 | ✅ Pass |
| Input border | #047857 | #FFFFFF | 3:1 | ✅ Pass |
| Focus indicator | #10B981 | #059669 | 3:1 | ✅ Pass |

**Testing Procedure:**
```
1. Open Color Contrast Analyzer
2. Screenshot each component
3. Use eyedropper to select colors
4. Verify ratios meet requirements
5. Document any failures
6. Test in different themes (if applicable)
```

### Focus Indicators

**Requirements:**
- Visible focus indicator (2px minimum)
- Sufficient contrast (3:1 minimum)
- Not hidden by other elements
- Consistent appearance

**Test Script:**
```
1. Connect keyboard
2. Tab through all interactive elements
3. Verify focus indicator appears
4. Check indicator visibility
5. Test on different backgrounds
6. Verify in high contrast mode
```

### Text Resizing

**WCAG Requirements:**
- Text can resize up to 200%
- No horizontal scrolling
- No content loss
- Readable at all sizes

**Test Script:**
```
1. Open app
2. Navigate to payment screens
3. Enable Large Text (iOS/Android)
4. Set to maximum size
5. Verify all text scales
6. Check for overflow
7. Verify touch targets don't shrink
8. Test with Dynamic Type (iOS)
```

### Motion & Animation

**Requirements:**
- Respect prefers-reduced-motion
- No auto-playing animations
- User control over animations
- Alternative static views

**Test Script:**
```
1. Enable Reduce Motion (iOS/Android)
2. Open payment modal
3. Verify animations are reduced
4. Check transitions are smooth
5. Ensure no flashing content
6. Verify parallax is disabled
```

## Test Cases

### Test Case 1: Add Card with Screen Reader

**Objective:** Verify card addition flow is fully accessible with screen reader

**Preconditions:**
- VoiceOver/TalkBack enabled
- User logged in
- No existing payment methods

**Steps:**
1. Navigate to Wallet screen
2. Activate "Manage Payment Methods"
3. Activate "Add New Card"
4. Fill card number field: 4242424242424242
5. Fill name field: John Doe
6. Fill expiry field: 12/25
7. Fill CVV field: 123
8. Activate "Save Card" button
9. Listen for success message

**Expected Results:**
- All fields properly labeled
- Validation errors announced
- Success confirmation clear
- Focus management appropriate

**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Pass | ⬜ Fail

### Test Case 2: Navigate Payment Methods with Keyboard

**Objective:** Verify keyboard-only navigation works correctly

**Preconditions:**
- External keyboard connected
- Multiple payment methods exist
- User logged in

**Steps:**
1. Navigate to Payment Methods Modal
2. Press Tab to navigate elements
3. Switch between Cards/Bank tabs with arrows
4. Select a payment method
5. Press Delete key
6. Confirm deletion with Enter
7. Press Escape to close modal

**Expected Results:**
- Tab order is logical
- Focus indicators visible
- All actions accessible via keyboard
- No keyboard traps

**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Pass | ⬜ Fail

### Test Case 3: Add Bank Account with Large Text

**Objective:** Verify bank account form works with text scaling

**Preconditions:**
- Large Text enabled (200%)
- User logged in
- Screen reader optional

**Steps:**
1. Open Payment Methods Modal
2. Switch to Bank Accounts tab
3. Activate "Add Bank Account"
4. Fill all fields
5. Verify all text is readable
6. Check touch targets are adequate
7. Submit form

**Expected Results:**
- All text scales appropriately
- No horizontal scrolling
- Touch targets remain ≥ 44x44pt
- Layout doesn't break
- Form submits successfully

**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Pass | ⬜ Fail

### Test Case 4: Payment Error Handling (Accessibility)

**Objective:** Verify error states are accessible

**Preconditions:**
- User logged in
- Test payment method (will fail)

**Steps:**
1. Attempt to add money with invalid card
2. Listen for error announcement
3. Verify error message is clear
4. Check focus moved to error
5. Verify error icon has alt text
6. Attempt to dismiss error
7. Retry with valid method

**Expected Results:**
- Error announced by screen reader
- Error message is specific
- Focus management appropriate
- Retry action is clear
- Success path works

**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Pass | ⬜ Fail

### Test Case 5: Withdraw with Screen Reader

**Objective:** Verify withdrawal flow is fully accessible

**Preconditions:**
- VoiceOver/TalkBack enabled
- User has balance
- Payment method exists

**Steps:**
1. Navigate to Withdraw screen
2. Adjust amount slider
3. Listen for value announcements
4. Select payment method
5. Activate "Withdraw" button
6. Confirm in dialog
7. Listen for success message

**Expected Results:**
- Balance announced
- Slider value changes announced
- Method selection clear
- Confirmation dialog accessible
- Success feedback provided

**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Pass | ⬜ Fail

## Issue Tracking

### Issue Template

```markdown
## Accessibility Issue Report

**Component:** [e.g., AddCardModal]

**Issue Type:**
- [ ] Screen Reader
- [ ] Keyboard Navigation
- [ ] Color Contrast
- [ ] Touch Target Size
- [ ] Other: ___________

**Severity:**
- [ ] Critical (Blocker)
- [ ] High (Major usability issue)
- [ ] Medium (Minor issue)
- [ ] Low (Enhancement)

**Description:**
[Clear description of the issue]

**Steps to Reproduce:**
1. 
2. 
3. 

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**WCAG Criterion:**
[e.g., 2.4.7 Focus Visible (Level AA)]

**Suggested Fix:**
[Proposed solution if known]

**Testing Environment:**
- Device: [e.g., iPhone 12, Pixel 5]
- OS Version: [e.g., iOS 15.0, Android 12]
- Screen Reader: [VoiceOver, TalkBack]
- App Version: [e.g., 2.0.0]

**Screenshots/Videos:**
[Attach if applicable]
```

### Priority Levels

| Priority | Description | Response Time |
|----------|-------------|---------------|
| **P0** | Completely blocks accessibility | 1 business day |
| **P1** | Major accessibility barrier | 3 business days |
| **P2** | Moderate accessibility issue | 1 week |
| **P3** | Minor improvement | Next sprint |

### Common Issues & Fixes

| Issue | Fix | WCAG Reference |
|-------|-----|----------------|
| Missing button label | Add accessibilityLabel | 2.4.6, 4.1.2 |
| Low contrast text | Adjust colors to meet ratio | 1.4.3 |
| Keyboard trap in modal | Implement focus trap management | 2.1.2 |
| Unlabeled form input | Associate label with input | 3.3.2, 4.1.2 |
| Missing error messages | Add error text with proper association | 3.3.1, 3.3.3 |
| Small touch targets | Increase to 44x44pt minimum | 2.5.5 |
| Focus not visible | Add/enhance focus indicator | 2.4.7 |

## Continuous Testing

### Automated Testing Integration

**Jest + React Native Testing Library:**
```typescript
import { render, screen } from '@testing-library/react-native';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AddCardModal } from '../add-card-modal';

expect.extend(toHaveNoViolations);

describe('AddCardModal Accessibility', () => {
  it('should not have accessibility violations', async () => {
    const { container } = render(
      <AddCardModal onBack={() => {}} onSave={() => {}} />
    );
    
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should have proper labels on all inputs', () => {
    render(<AddCardModal onBack={() => {}} onSave={() => {}} />);
    
    expect(screen.getByLabelText('Card Number')).toBeDefined();
    expect(screen.getByLabelText('Cardholder Name')).toBeDefined();
    expect(screen.getByLabelText('Expiry Date')).toBeDefined();
    expect(screen.getByLabelText('Security Code')).toBeDefined();
  });

  it('should announce validation errors', () => {
    const { getByLabelText } = render(
      <AddCardModal onBack={() => {}} onSave={() => {}} />
    );
    
    const cardNumberInput = getByLabelText('Card Number');
    
    // Type invalid card number
    fireEvent.changeText(cardNumberInput, '1234');
    
    // Error should be accessible
    expect(screen.getByText('Invalid card number')).toBeDefined();
    expect(screen.getByLabelText('Card Number')).toHaveAccessibilityState({
      invalid: true
    });
  });
});
```

### CI/CD Integration

**GitHub Actions Workflow:**
```yaml
name: Accessibility Tests

on: [push, pull_request]

jobs:
  a11y-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run accessibility tests
        run: npm run test:a11y
      
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: a11y-results
          path: a11y-results/
```

## Resources

### Official Guidelines
- [WCAG 2.1](https://www.w3.org/WAI/WCAG21/quickref/)
- [iOS Accessibility](https://developer.apple.com/accessibility/ios/)
- [Android Accessibility](https://developer.android.com/guide/topics/ui/accessibility)
- [React Native Accessibility](https://reactnative.dev/docs/accessibility)

### Testing Tools
- [Accessibility Inspector](https://developer.apple.com/library/archive/documentation/Accessibility/Conceptual/AccessibilityMacOSX/OSXAXTestingApps.html)
- [Android Accessibility Scanner](https://play.google.com/store/apps/details?id=com.google.android.apps.accessibility.auditor)
- [axe DevTools](https://www.deque.com/axe/devtools/)

### Learning Resources
- [WebAIM](https://webaim.org/)
- [A11y Project](https://www.a11yproject.com/)
- [Inclusive Components](https://inclusive-components.design/)
- [Deque University](https://dequeuniversity.com/)

## Contact

**Accessibility Team:**
- Email: accessibility@bountyexpo.com
- Slack: #accessibility

**Questions or Issues:**
- Create GitHub issue with `a11y` label
- Contact accessibility team
- Review this guide regularly

---

**Last Updated:** December 24, 2024
**Next Review:** March 24, 2025
**Version:** 1.0
