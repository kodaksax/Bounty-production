# Comprehensive Payment Management System Architecture

## Overview

This document describes the complete architecture of the BountyExpo payment management system, which provides secure, PCI-compliant payment processing with support for multiple payment methods including credit cards, debit cards, ACH/bank accounts, Apple Pay, and Google Pay.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Payment Method Types](#payment-method-types)
3. [Core Components](#core-components)
4. [Payment Flows](#payment-flows)
5. [Security & Compliance](#security--compliance)
6. [Accessibility](#accessibility)
7. [Error Handling](#error-handling)
8. [Testing Strategy](#testing-strategy)

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Mobile App (React Native)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Payment Methods │  │   Add Money      │  │   Withdraw   │  │
│  │     Modal        │  │   Screen         │  │   Screen     │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘  │
│           │                     │                     │          │
│           └─────────────────────┼─────────────────────┘          │
│                                 │                                │
│                    ┌────────────▼────────────┐                   │
│                    │   Stripe Context        │                   │
│                    │   (Payment State)       │                   │
│                    └────────────┬────────────┘                   │
│                                 │                                │
│                    ┌────────────▼────────────┐                   │
│                    │   Stripe Service        │                   │
│                    │   (Business Logic)      │                   │
│                    └────────────┬────────────┘                   │
│                                 │                                │
└─────────────────────────────────┼────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  Stripe React Native SDK  │
                    │  (PCI Compliant Tokeniza- │
                    │   tion & Payment Sheet)   │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     Backend API           │
                    │  (Fastify + Stripe API)   │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │      Stripe Platform      │
                    │  - Payment Processing     │
                    │  - Connect Accounts       │
                    │  - Webhooks               │
                    └───────────────────────────┘
```

### Component Hierarchy

```
PaymentMethodsModal (Parent)
├── AddCardModal (Card Payments)
│   ├── Manual Card Entry Form
│   └── PaymentElementWrapper (Stripe Payment Sheet)
│       ├── Apple Pay Button (iOS)
│       ├── Google Pay Button (Android)
│       └── Card Input with 3DS
├── AddBankAccountModal (ACH Payments)
│   ├── Account Holder Name Input
│   ├── Routing Number Input (with validation)
│   ├── Account Number Input (with confirmation)
│   └── Account Type Selection (Checking/Savings)
└── Payment Methods List
    ├── Card Display Items
    └── Bank Account Display Items
```

## Payment Method Types

### 1. Credit/Debit Cards

**Supported Networks:**
- Visa
- Mastercard
- American Express
- Discover
- Diners Club
- JCB

**Features:**
- PCI-compliant tokenization via Stripe Payment Sheet
- 3D Secure authentication support
- Card validation (Luhn algorithm)
- Expiry date validation
- CVV/CVC validation
- Manual card entry fallback for development

**Implementation:**
- Component: `AddCardModal`
- Service: `stripeService.createPaymentMethod()`
- Backend: `/payments/create-setup-intent`

### 2. ACH/Bank Accounts

**Supported Types:**
- Checking accounts
- Savings accounts

**Features:**
- Routing number validation (ABA checksum)
- Account number confirmation
- Micro-deposit verification (1-2 business days)
- Secure tokenization
- ACH debit/credit support

**Implementation:**
- Component: `AddBankAccountModal`
- Service: Backend tokenization via Stripe
- Backend: `/payments/bank-accounts`

### 3. Apple Pay (iOS)

**Requirements:**
- iOS device with Apple Pay capability
- Registered Apple Pay Merchant ID
- Valid merchant certificate

**Features:**
- Native Apple Pay sheet
- Touch ID/Face ID authentication
- Saved cards from Wallet app
- One-tap payments

**Implementation:**
- Service: `applePayService.processPayment()`
- SDK: `@stripe/stripe-react-native`
- Configuration: Apple Developer Portal setup required

### 4. Google Pay (Android)

**Requirements:**
- Android device with Google Pay
- Google Pay merchant account
- Play Services integration

**Features:**
- Native Google Pay sheet
- Biometric authentication
- Saved cards from Google account
- One-tap payments

**Implementation:**
- SDK: `@stripe/stripe-react-native`
- Configuration: Google Pay API setup required

## Core Components

### 1. PaymentMethodsModal

**Purpose:** Central hub for managing all payment methods

**Key Features:**
- Tabbed interface (Cards vs Bank Accounts)
- Add new payment methods
- View existing payment methods
- Remove payment methods
- Set default payment method
- Drag-to-dismiss gesture support

**Props:**
```typescript
interface PaymentMethodsModalProps {
  isOpen: boolean
  onClose: () => void
  preferredType?: 'card' | 'bank_account'
}
```

**Accessibility:**
- ARIA roles for tabs and buttons
- Screen reader announcements
- Keyboard navigation support
- Touch target sizes (44x44pt minimum)

### 2. AddCardModal

**Purpose:** Add new credit/debit cards

**Modes:**
1. **Payment Element Mode (Recommended):**
   - Uses Stripe Payment Sheet
   - PCI-compliant (Stripe handles card data)
   - Supports Apple Pay and Google Pay
   - Built-in 3D Secure authentication

2. **Manual Entry Mode (Fallback):**
   - Custom form for card details
   - Client-side validation
   - Visual card preview
   - Used in development/testing

**Props:**
```typescript
interface AddCardModalProps {
  onBack: () => void
  onSave?: (cardData: CardData) => void
  embedded?: boolean
  usePaymentElement?: boolean
}
```

**Validation:**
- Card number (Luhn algorithm)
- Expiry date (not expired, valid month/year)
- CVV (3-4 digits)
- Cardholder name (required)

### 3. AddBankAccountModal

**Purpose:** Add ACH bank accounts

**Features:**
- Account holder name input
- Routing number validation (ABA checksum)
- Account number with confirmation
- Account type selection (Checking/Savings)
- Security notice (encryption, no storage of full numbers)

**Props:**
```typescript
interface AddBankAccountModalProps {
  onBack: () => void
  onSave?: (bankData: BankAccountData) => void
  embedded?: boolean
}
```

**Validation:**
- Routing number: 9 digits + checksum validation
- Account number: 4-17 digits, must match confirmation
- Account holder name: required, alphanumeric
- Account type: checking or savings

### 4. PaymentElementWrapper

**Purpose:** Wrapper for Stripe Payment Sheet integration

**Features:**
- Native Payment Sheet initialization
- Apple Pay/Google Pay configuration
- Error handling with user-friendly messages
- Loading states
- Trust indicators (SSL, PCI DSS)

**Props:**
```typescript
interface PaymentElementWrapperProps {
  clientSecret: string
  mode: 'payment' | 'setup'
  amount?: number
  currency?: string
  onSuccess: (result: PaymentResult) => void
  onError: (error: PaymentElementError) => void
  onCancel?: () => void
  showApplePay?: boolean
  showGooglePay?: boolean
  buttonText?: string
  isProcessing?: boolean
  merchantDisplayName?: string
}
```

### 5. AddMoneyScreen

**Purpose:** Add funds to wallet using any payment method

**Features:**
- Amount input with numeric keypad
- Payment method selection
- Apple Pay integration (iOS)
- Google Pay integration (Android)
- Card payment via Stripe
- Real-time balance updates
- Transaction history tracking

**Payment Flow:**
1. User enters amount
2. User selects payment method or uses Apple/Google Pay
3. Payment Intent created on backend
4. Payment processed via Stripe
5. Webhook updates wallet balance
6. User receives confirmation

### 6. WithdrawScreen

**Purpose:** Withdraw funds from wallet to bank account or card

**Features:**
- Withdrawal amount input with slider
- Balance visualization
- Stripe Connect integration for bank transfers
- Email verification requirement
- Processing time estimates
- Transaction tracking

**Payment Flow:**
1. User enters withdrawal amount
2. Email verification check
3. Payment method selection (bank preferred)
4. Stripe Connect transfer initiated
5. Status tracking (1-3 business days)
6. User receives confirmation

## Payment Flows

### Add Money Flow

```
┌──────────────┐
│  User Opens  │
│  Add Money   │
│   Screen     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Enter Amount │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────┐
│ Select Payment Method            │
│ - Existing Card                  │
│ - Apple Pay (iOS)                │
│ - Google Pay (Android)           │
│ - Add New Payment Method         │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────┐
│  Backend Creates │
│  Payment Intent  │
└──────┬───────────┘
       │
       ▼
┌──────────────────────┐
│  Stripe Processes    │
│  Payment (3DS if     │
│  required)           │
└──────┬───────────────┘
       │
       ▼
┌──────────────────┐
│  Webhook Updates │
│  Wallet Balance  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Show Success    │
│  Message         │
└──────────────────┘
```

### Withdraw Flow

```
┌──────────────┐
│  User Opens  │
│   Withdraw   │
│   Screen     │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  Check Email     │
│  Verification    │
└──────┬───────────┘
       │ (verified)
       ▼
┌──────────────────┐
│  Enter Withdraw  │
│  Amount          │
└──────┬───────────┘
       │
       ▼
┌──────────────────────────┐
│  Select Destination      │
│  - Bank Account          │
│    (Stripe Connect)      │
│  - Payment Method        │
│    (Card Refund)         │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────┐
│  Backend Creates │
│  Transfer        │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Stripe Initiates│
│  Payout/Transfer │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Update Wallet   │
│  Balance         │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Show Pending    │
│  Status (1-3     │
│  business days)  │
└──────────────────┘
```

### Add Payment Method Flow

```
┌──────────────────┐
│  User Opens      │
│  Payment Methods │
│  Modal           │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Select Type:    │
│  - Card          │
│  - Bank Account  │
└──────┬───────────┘
       │
       ├─────────────┐
       │             │
       ▼             ▼
┌──────────────┐  ┌─────────────────┐
│  Add Card    │  │  Add Bank       │
│  Modal       │  │  Account Modal  │
└──────┬───────┘  └─────┬───────────┘
       │                │
       ▼                ▼
┌──────────────┐  ┌─────────────────┐
│ Setup Intent │  │ Create Bank     │
│ (Stripe)     │  │ Token           │
└──────┬───────┘  └─────┬───────────┘
       │                │
       ▼                ▼
┌──────────────┐  ┌─────────────────┐
│ Payment      │  │ Micro-deposit   │
│ Sheet        │  │ Verification    │
└──────┬───────┘  └─────┬───────────┘
       │                │
       └────────┬───────┘
                │
                ▼
       ┌────────────────┐
       │  Save Payment  │
       │  Method to     │
       │  Customer      │
       └────────┬───────┘
                │
                ▼
       ┌────────────────┐
       │  Refresh List  │
       │  Show Success  │
       └────────────────┘
```

## Security & Compliance

### PCI DSS Compliance

**Level:** Service Provider Level 1 (via Stripe)

**Key Measures:**
1. **No Direct Card Storage:**
   - All card data tokenized by Stripe
   - App never touches raw card data in production
   - Stripe Payment Sheet handles PCI scope

2. **Encrypted Communication:**
   - All API calls over HTTPS/TLS 1.2+
   - Certificate pinning (recommended for production)
   - No sensitive data in logs

3. **Secure Tokenization:**
   - Stripe tokens replace card numbers
   - Tokens are single-use (PaymentIntents) or reusable (SetupIntents)
   - Bank account tokens via Stripe bank account tokens

4. **Access Control:**
   - JWT-based authentication
   - Session management via Supabase Auth
   - Payment method ownership verification

### Data Protection

**Sensitive Data Handling:**

| Data Type | Storage | Transmission | Access Control |
|-----------|---------|--------------|----------------|
| Card Numbers | Never stored (Stripe token only) | Encrypted HTTPS | User-specific tokens |
| CVV/CVC | Never stored | Encrypted HTTPS | Not persisted |
| Bank Account Numbers | Last 4 digits only | Encrypted HTTPS | User-specific tokens |
| Routing Numbers | Tokenized | Encrypted HTTPS | Validated via checksum |
| Payment Intent IDs | Database | Encrypted HTTPS | User-scoped queries |

**Encryption:**
- In Transit: TLS 1.2+ (all API communication)
- At Rest: Stripe platform encryption (AES-256)
- Tokens: Stripe-managed secure token storage

### Fraud Prevention

**Implemented Measures:**

1. **Stripe Radar:**
   - Machine learning fraud detection
   - Real-time risk scoring
   - Automatic blocking of high-risk payments

2. **3D Secure Authentication:**
   - Strong Customer Authentication (SCA)
   - Required for European cards (PSD2 compliance)
   - Optional challenge flow for others

3. **Velocity Checks:**
   - Rate limiting on payment attempts
   - Duplicate payment prevention (idempotency)
   - Transaction amount limits

4. **Email Verification:**
   - Required for withdrawals
   - Prevents account takeover withdrawals
   - Adds identity verification layer

5. **Behavioral Analysis:**
   - Track payment patterns
   - Flag unusual activity
   - Alert on large transactions

### Compliance Requirements

**KYC/AML (Know Your Customer / Anti-Money Laundering):**
- Stripe Connect onboarding for payouts
- Identity verification for high-value transactions
- Transaction monitoring and reporting

**PSD2 (Payment Services Directive 2) - Europe:**
- Strong Customer Authentication via 3D Secure
- Secure communication standards
- Customer authentication requirements

**GDPR (General Data Protection Regulation):**
- User consent for data processing
- Right to access payment history
- Right to deletion (tokenized data)
- Data portability

**Financial Regulations:**
- Anti-Money Laundering (AML) compliance
- Know Your Customer (KYC) requirements
- Transaction reporting thresholds
- Sanctions screening

## Accessibility

### WCAG 2.1 Level AA Compliance

**Implemented Features:**

1. **Keyboard Navigation:**
   - All interactive elements keyboard accessible
   - Tab order follows logical flow
   - Focus indicators visible
   - Escape key dismisses modals

2. **Screen Reader Support:**
   - ARIA labels on all buttons and inputs
   - ARIA roles for custom components
   - Live regions for dynamic content
   - Descriptive error messages

3. **Visual Accessibility:**
   - Color contrast ratios ≥ 4.5:1 for text
   - Color contrast ratios ≥ 3:1 for UI components
   - No reliance on color alone
   - Text resizing support (up to 200%)

4. **Touch Targets:**
   - Minimum 44x44pt touch target size
   - Adequate spacing between targets
   - Large, easy-to-tap buttons
   - Swipe gestures have alternatives

5. **Form Accessibility:**
   - Labels associated with inputs
   - Error messages linked to fields
   - Validation states announced
   - Autocomplete attributes where applicable

6. **Focus Management:**
   - Focus trapped in modals
   - Focus returned on modal close
   - Skip links where appropriate
   - Focus visible on all interactive elements

### Testing Tools

**Recommended Tools:**
- iOS VoiceOver
- Android TalkBack
- Accessibility Scanner (Android)
- Accessibility Inspector (iOS)
- axe DevTools

## Error Handling

### Error Types & Handling

**1. Card Errors:**

| Error Code | User Message | Recovery Action |
|------------|-------------|-----------------|
| `card_declined` | "Your card was declined. Please try a different card." | Prompt for alternate payment method |
| `insufficient_funds` | "Your card has insufficient funds." | Prompt to add funds or use different card |
| `expired_card` | "This card has expired. Please use a different card." | Prompt for updated card |
| `incorrect_cvc` | "The security code is incorrect." | Allow retry with correct CVC |
| `authentication_required` | "Additional authentication required. Please try again." | Retry with 3DS flow |

**2. Network Errors:**

| Scenario | User Message | Recovery Action |
|----------|-------------|-----------------|
| Timeout | "Connection timed out. Please check your internet connection." | Retry button with exponential backoff |
| No Connection | "No internet connection. Please check your network." | Show offline indicator |
| Server Error | "Service temporarily unavailable. Please try again." | Retry with longer timeout |

**3. Validation Errors:**

| Field | Validation | Error Message |
|-------|-----------|---------------|
| Card Number | Luhn algorithm, length | "Please enter a valid card number" |
| Expiry Date | Not expired, valid month | "This card has expired" |
| CVV | 3-4 digits | "Please enter a valid security code" |
| Routing Number | 9 digits, checksum | "Invalid routing number" |
| Account Number | 4-17 digits, match | "Account numbers must match" |

**4. Business Logic Errors:**

| Error | User Message | Recovery Action |
|-------|-------------|-----------------|
| Duplicate Payment | "This payment is already being processed." | Wait or cancel existing |
| Insufficient Balance | "Insufficient wallet balance for this withdrawal." | Adjust amount |
| Email Not Verified | "Please verify your email before withdrawing funds." | Resend verification email |
| Payment Method Required | "Please add a payment method first." | Navigate to add payment method |

### Error Recovery Patterns

**1. Retry with Exponential Backoff:**
```typescript
async function retryOperation(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation()
    } catch (error) {
      if (i === maxRetries - 1) throw error
      await sleep(Math.min(1000 * Math.pow(2, i), 10000))
    }
  }
}
```

**2. Graceful Degradation:**
- Payment Sheet unavailable → Manual card entry
- Apple/Google Pay unavailable → Card payment
- Network slow → Show loading with progress

**3. User Communication:**
- Clear, non-technical error messages
- Actionable recovery steps
- Contact support option
- Error context (but no sensitive data)

## Testing Strategy

### Unit Tests

**Components:**
- PaymentMethodsModal rendering
- AddCardModal validation logic
- AddBankAccountModal routing number checksum
- PaymentElementWrapper SDK integration

**Services:**
- stripeService.createPaymentMethod()
- stripeService.validateCardNumber()
- Routing number validation algorithm
- Payment error handling

### Integration Tests

**Flows:**
- Add card end-to-end
- Add bank account end-to-end
- Process payment with card
- Process payment with Apple Pay
- Initiate withdrawal to bank
- Handle 3D Secure authentication

**API Integration:**
- Create Payment Intent
- Create Setup Intent
- List payment methods
- Remove payment method
- Create bank account token
- Initiate Stripe Connect transfer

### Accessibility Tests

**Manual Testing:**
- Screen reader navigation (VoiceOver/TalkBack)
- Keyboard navigation
- Color contrast verification
- Touch target size verification
- Focus management

**Automated Testing:**
- axe-core integration
- Accessibility Scanner (Android)
- Accessibility Inspector (iOS)

### Security Tests

**Vulnerability Assessment:**
- OWASP Mobile Top 10
- PCI DSS requirements checklist
- SSL/TLS configuration
- Token handling review
- Authentication flow review

**Penetration Testing:**
- API endpoint security
- Authentication bypass attempts
- Payment manipulation attempts
- Sensitive data exposure checks

### Performance Tests

**Metrics:**
- Payment method load time < 2s
- Payment processing time < 3s
- Modal open/close animation 60fps
- Memory usage during payment flows

### End-to-End Tests

**Critical Paths:**
1. New user adds first card
2. User adds money to wallet
3. User withdraws from wallet
4. User manages multiple payment methods
5. User handles payment failure gracefully

## Best Practices

### For Developers

1. **Never Log Sensitive Data:**
   ```typescript
   // ❌ Bad
   console.log('Card number:', cardNumber)
   
   // ✅ Good
   console.log('Card added:', 'ending in', last4)
   ```

2. **Always Use Idempotency Keys:**
   ```typescript
   // ✅ Good
   const idempotencyKey = generateIdempotencyKey(userId, amount, purpose)
   await createPaymentIntent(amount, { idempotencyKey })
   ```

3. **Handle All Error Cases:**
   ```typescript
   // ✅ Good
   try {
     await processPayment()
   } catch (error) {
     if (error.type === 'card_error') {
       showCardError(error)
     } else if (error.type === 'network_error') {
       showNetworkError(error)
     } else {
       showGenericError()
     }
   }
   ```

4. **Test in Multiple Environments:**
   - Development (test keys)
   - Staging (test keys with production-like data)
   - Production (live keys, real payments)

5. **Keep Stripe SDK Updated:**
   - Monitor for security updates
   - Test major version upgrades in staging
   - Review breaking changes carefully

### For Security

1. **Rotate API Keys Regularly**
2. **Monitor Stripe Dashboard for Anomalies**
3. **Enable Stripe Radar Pro for Advanced Fraud Detection**
4. **Implement Rate Limiting on Payment Endpoints**
5. **Use Webhook Signing Secrets**
6. **Regular Security Audits**

### For UX

1. **Progressive Disclosure:** Show only necessary information
2. **Clear Feedback:** Always inform users of payment status
3. **Quick Recovery:** Make it easy to fix errors
4. **Trust Signals:** Display security badges and SSL indicators
5. **Mobile First:** Design for thumb-friendly interactions

## Future Enhancements

### Planned Features

1. **Payment Method Management:**
   - Set default payment method
   - Nickname payment methods
   - Payment method expiry notifications

2. **Additional Payment Methods:**
   - PayPal integration
   - Venmo integration
   - Cryptocurrency support

3. **Enhanced Security:**
   - Biometric authentication for payments
   - Device fingerprinting
   - Behavioral analytics

4. **Improved UX:**
   - Save card details for faster checkout
   - Payment method recommendations
   - Transaction categorization

5. **International Support:**
   - Multi-currency support
   - Local payment methods (SEPA, iDEAL, etc.)
   - Currency conversion
   - Regional compliance (Australia, Canada, etc.)

## Support & Resources

### Documentation
- [Stripe API Documentation](https://stripe.com/docs/api)
- [Stripe React Native SDK](https://stripe.dev/stripe-react-native/)
- [PCI DSS Requirements](https://www.pcisecuritystandards.org/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

### Internal Resources
- Backend API Documentation: `/services/api/README.md`
- Stripe Integration Guide: `/STRIPE_INTEGRATION.md`
- Security Guide: `/PAYMENT_INTEGRATION_SECURITY_GUIDE.md`

### Support Contacts
- Engineering: engineering@bountyexpo.com
- Security: security@bountyexpo.com
- Stripe Support: https://support.stripe.com

## Changelog

### Version 2.0.0 (Current)
- Added ACH/bank account support
- Enhanced payment methods modal with tabs
- Improved accessibility (WCAG 2.1 AA)
- Added comprehensive error handling
- Implemented idempotency for payments
- Added detailed architecture documentation

### Version 1.0.0
- Initial implementation
- Card payments via Stripe
- Apple Pay and Google Pay support
- Basic payment methods management
- Add money and withdraw flows
