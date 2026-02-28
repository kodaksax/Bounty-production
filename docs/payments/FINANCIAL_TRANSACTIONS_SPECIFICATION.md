# Financial Transactions Specification

This document provides a comprehensive specification for the financial transaction functionalities in the BountyExpo app, covering payment intents, balance management, withdrawals, and service fee handling.

## Table of Contents

1. [Overview](#overview)
2. [Add Money Flow](#add-money-flow)
3. [Withdrawal Flow](#withdrawal-flow)
4. [Service Fee Structure](#service-fee-structure)
5. [Balance Management](#balance-management)
6. [Error Handling](#error-handling)
7. [API Endpoints](#api-endpoints)

---

## Overview

The BountyExpo app supports the following financial operations:

| Operation | Description | Fee |
|-----------|-------------|-----|
| **Add Money** | Add funds to wallet via Stripe | None |
| **Withdrawal** | Transfer funds to bank account | None (Stripe fees apply) |
| **Bounty Escrow** | Hold funds when bounty is accepted | None |
| **Bounty Release** | Release funds when bounty is completed | Platform fee deducted |
| **Bounty Refund** | Return funds when bounty is cancelled | Partial fee retention |

### Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Mobile App         │────▶│  Backend Server  │────▶│  Stripe API     │
│  (React Native)     │     │  (Express.js)    │     │                 │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
         │                          │
         │                          │
         ▼                          ▼
┌─────────────────────┐     ┌──────────────────┐
│  Wallet Context     │     │  Supabase DB     │
│  (Local State)      │     │  (Persistence)   │
└─────────────────────┘     └──────────────────┘
```

---

## Add Money Flow

### Overview

Users can add money to their wallet using credit/debit cards or Apple Pay. The process involves creating a PaymentIntent, confirming payment through Stripe SDK, and updating the wallet balance via webhooks.

### Flow Diagram

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  User enters │       │  Backend     │       │  Stripe      │       │  Webhook     │
│  amount      │──────▶│  creates     │──────▶│  processes   │──────▶│  updates     │
│              │       │  PaymentIntent│      │  payment     │       │  balance     │
└──────────────┘       └──────────────┘       └──────────────┘       └──────────────┘
```

### Implementation Details

#### 1. Frontend (add-money-screen.tsx)

**Input Validation:**
- Amount must be > $0
- Amount must be ≤ $99,999.99
- Amount validated to 2 decimal places
- Minimum for Apple Pay: $0.50

**Payment Intent Creation:**
```typescript
// Call backend to create PaymentIntent
const response = await fetch(`${API_BASE_URL}/payments/create-payment-intent`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({
    amountCents: Math.round(numAmount * 100),
    currency: 'usd',
    metadata: {
      purpose: 'wallet_deposit',
      amount: numAmount
    }
  })
});

const { clientSecret, paymentIntentId } = await response.json();
```

**Payment Confirmation:**
```typescript
// Use Stripe SDK to confirm payment
const result = await processPayment(numAmount, paymentMethods[0]?.id);

if (result.success) {
  // Local balance update (webhook also updates server-side)
  await deposit(numAmount, { 
    method: 'Credit Card',
    title: 'Added Money via Stripe',
    status: 'completed'
  });
}
```

#### 2. Backend (server/index.js)

**POST /payments/create-payment-intent:**
```javascript
// Validate amount
if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
  return res.status(400).json({ 
    error: 'Invalid amount. Must be a positive number in cents.' 
  });
}

// Create or get Stripe customer
let customerId = profile?.stripe_customer_id;
if (!customerId) {
  const customer = await stripe.customers.create({
    email: profile.email,
    metadata: { user_id: userId }
  });
  customerId = customer.id;
}

// Create PaymentIntent
const paymentIntent = await stripe.paymentIntents.create({
  amount: amountCents,
  currency: currency,
  customer: customerId,
  metadata: { user_id: userId, ...metadata },
  automatic_payment_methods: { enabled: true },
});
```

#### 3. Webhook Handler

**payment_intent.succeeded:**
- Creates wallet transaction in database
- Updates user balance atomically via RPC
- Falls back to direct update if RPC unavailable

**3D Secure Support:**
- `payment_intent.requires_action`: Informational, handled by client SDK
- `payment_intent.payment_failed`: Logs failure for analytics

---

## Withdrawal Flow

### Overview

Users can withdraw funds to their bank account via Stripe Connect. First-time users must complete Stripe Connect onboarding.

### Prerequisites

1. User has available balance
2. User has completed Stripe Connect onboarding
3. Connected account is verified (payouts_enabled = true)

### Flow Diagram

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Check Connect   │────▶│  Enter Amount    │────▶│  Initiate        │
│  Status          │     │  Select Method   │     │  Transfer        │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │                                                 │
         │                                                 │
         ▼                                                 ▼
┌──────────────────┐                           ┌──────────────────┐
│  Start Onboarding│                           │  Webhook Updates │
│  (if needed)     │                           │  Status          │
└──────────────────┘                           └──────────────────┘
```

### Implementation Details

#### 1. Frontend (withdraw-screen.tsx)

**Withdraw Button:**
The withdrawal screen includes a "Withdraw" button at the bottom:
```tsx
<TouchableOpacity
  onPress={handleWithdraw}
  style={[
    styles.bottomButton,
    withdrawalAmount > 0 && (selectedMethod || hasConnectedAccount) && !isProcessing
      ? styles.bottomButtonActive 
      : styles.bottomButtonInactive,
  ]}
  disabled={withdrawalAmount <= 0 || (!selectedMethod && !hasConnectedAccount) || isProcessing}
>
  <Text style={styles.bottomButtonText}>
    Withdraw ${withdrawalAmount.toFixed(2)}
  </Text>
</TouchableOpacity>
```

**Input Validation:**
- Amount must be > $0
- Amount cannot exceed available balance
- User must have Connect account OR selected payment method

**Withdrawal Process:**
```typescript
const handleWithdraw = async () => {
  // Validate amount
  if (withdrawalAmount <= 0) {
    Alert.alert('Invalid Amount', 'Please enter a valid withdrawal amount.');
    return;
  }

  if (withdrawalAmount > balance) {
    Alert.alert('Insufficient Balance', 'You cannot withdraw more than your current balance.');
    return;
  }

  // Use Stripe Connect transfer
  const response = await fetch(`${API_BASE_URL}/connect/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      amount: withdrawalAmount,
      currency: 'usd'
    })
  });

  const { transferId, transactionId, estimatedArrival } = await response.json();
  
  // Refresh wallet balance
  await refresh();
};
```

#### 2. Backend Endpoints

**POST /connect/create-account-link:**
- Creates Stripe Express Connect account
- Returns onboarding URL
- Stores account ID in user profile

**POST /connect/verify-onboarding:**
- Checks account status with Stripe
- Returns onboarding completion status

**POST /connect/transfer:**
```javascript
// Validate amount and balance
if (profile.balance < amount) {
  return res.status(400).json({ error: 'Insufficient balance' });
}

// Create transfer to connected account
const transfer = await stripe.transfers.create({
  amount: Math.round(amount * 100),
  currency: 'usd',
  destination: profile.stripe_connect_account_id,
  metadata: { user_id: userId }
});

// Create withdrawal transaction
await supabase.from('wallet_transactions').insert({
  user_id: userId,
  type: 'withdrawal',
  amount: -amount,
  description: 'Withdrawal to bank account',
  status: 'pending',
  stripe_transfer_id: transfer.id,
});

// Deduct from balance
await supabase.from('profiles')
  .update({ balance: profile.balance - amount })
  .eq('id', userId);
```

**POST /connect/retry-transfer:**
- Allows retry of failed transfers (max 3 attempts)
- Refunds balance if retry fails
- Uses optimistic locking to prevent race conditions

---

## Service Fee Structure

### Fee Collection Points

Service fees are collected during the **bounty completion process**, NOT at withdrawal. This ensures:
1. Fees are deducted before funds reach the hunter
2. Clear visibility of fees at the point of earning
3. Full withdrawal amount goes to the user without hidden deductions

### Fee Calculation

| Scenario | Platform Fee | Calculation |
|----------|-------------|-------------|
| Bounty Completion | 10% | Hunter receives (bounty_amount × 0.90) |
| Bounty Cancellation (Early) | 5% | Poster receives (escrow × 0.95) |
| Bounty Cancellation (After Work) | 15% | Poster receives (escrow × 0.85) |
| Direct Withdrawal | 0% | User receives full balance |

### Implementation

**Bounty Completion Fee (lib/wallet-context.tsx):**
```typescript
const PLATFORM_FEE_PERCENTAGE = 0.10; // 10% platform fee

const releaseFunds = useCallback(async (bountyId, hunterId, title) => {
  const escrowTx = transactions.find(
    tx => tx.type === 'escrow' && 
          String(tx.details.bounty_id) === String(bountyId) && 
          tx.escrowStatus === 'funded'
  );

  const grossAmount = Math.abs(escrowTx.amount);
  const platformFee = grossAmount * PLATFORM_FEE_PERCENTAGE;
  const netAmount = grossAmount - platformFee;

  // Log platform fee
  await logTransaction({
    type: 'platform_fee',
    amount: -platformFee,
    details: { 
      title: 'Platform Service Fee',
      bounty_id: String(bountyId),
      fee_percentage: PLATFORM_FEE_PERCENTAGE * 100
    },
  });

  // Release net amount to hunter
  await logTransaction({
    type: 'release',
    amount: netAmount,
    details: { 
      title,
      bounty_id: String(bountyId),
      counterparty: hunterId,
      gross_amount: grossAmount,
      platform_fee: platformFee,
    },
  });
}, [transactions, logTransaction, persistTransactions]);
```

**Displaying Fees to Users:**
```typescript
// In bounty completion UI
<View>
  <Text>Bounty Amount: ${grossAmount.toFixed(2)}</Text>
  <Text>Platform Fee (10%): -${platformFee.toFixed(2)}</Text>
  <Text style={{ fontWeight: 'bold' }}>You Receive: ${netAmount.toFixed(2)}</Text>
</View>
```

---

## Balance Management

### Balance Sources

1. **Deposits**: Add money via card or Apple Pay
2. **Bounty Earnings**: Released funds from completed bounties (minus fees)
3. **Refunds**: Returned escrow from cancelled bounties

### Balance Displays

Balance is synchronized across all app sections:

| Location | Component | Data Source |
|----------|-----------|-------------|
| Wallet Screen | WalletScreen | `useWallet().balance` |
| Profile Section | ProfileScreen | `useWallet().balance` |
| Bounty Details | BountyDetailModal | `useWallet().balance` |
| Transaction History | TransactionHistoryScreen | `useWallet().transactions` |

### Balance Sync Architecture

```typescript
// lib/wallet-context.tsx
export const WalletProvider = ({ children }) => {
  const [balance, setBalance] = useState(0);
  
  // Local storage persistence
  const persist = async (value) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  };
  
  // API sync
  const refreshFromApi = async (accessToken) => {
    const response = await fetch(`${API_BASE_URL}/wallet/balance`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const { balance } = await response.json();
    setBalance(balance);
    await persist(balance);
  };
  
  return (
    <WalletContext.Provider value={{ balance, refreshFromApi, ... }}>
      {children}
    </WalletContext.Provider>
  );
};
```

### Atomic Balance Updates

Server-side balance updates use atomic RPC functions to prevent race conditions:

```sql
-- increment_balance RPC function
CREATE OR REPLACE FUNCTION increment_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS void AS $$
BEGIN
  UPDATE profiles 
  SET balance = balance + p_amount 
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- decrement_balance RPC function
CREATE OR REPLACE FUNCTION decrement_balance(p_user_id UUID, p_amount NUMERIC)
RETURNS void AS $$
BEGIN
  UPDATE profiles 
  SET balance = GREATEST(0, balance - p_amount) 
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Error Handling

### Add Money Errors

| Error | User Message | Recovery Action |
|-------|--------------|-----------------|
| Card declined | "Your card was declined" | Try different card |
| Insufficient funds | "Insufficient funds on card" | Use different payment |
| 3DS failed | "Authentication failed" | Retry payment |
| Network error | "Connection error" | Retry later |

### Withdrawal Errors

| Error | User Message | Recovery Action |
|-------|--------------|-----------------|
| Insufficient balance | "Insufficient balance" | Add money first |
| Connect not set up | "Please connect bank account" | Complete onboarding |
| Transfer failed | "Transfer failed" | Retry or contact support |
| Max retries reached | "Maximum retries reached" | Contact support |

### Error Display Pattern

```typescript
// ErrorBanner component
{error && (
  <ErrorBanner
    error={getUserFriendlyError(error)}
    onDismiss={() => setError(null)}
    onAction={error.type === 'payment' ? () => handleRetry() : undefined}
    actionLabel="Retry"
  />
)}
```

---

## API Endpoints

### Payment Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/payments/create-payment-intent` | POST | Create PaymentIntent for deposit |
| `/payments/confirm` | POST | Confirm payment with 3DS support |
| `/payments/methods` | GET | List saved payment methods |
| `/payments/methods` | POST | Attach new payment method |
| `/payments/methods/:id` | DELETE | Remove payment method |

### Wallet Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wallet/balance` | GET | Get current balance |
| `/wallet/transactions` | GET | Get transaction history |

### Connect Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/connect/create-account-link` | POST | Create Connect onboarding link |
| `/connect/verify-onboarding` | POST | Verify onboarding status |
| `/connect/transfer` | POST | Initiate withdrawal transfer |
| `/connect/retry-transfer` | POST | Retry failed transfer |

### Webhook Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/stripe` | POST | Handle all Stripe events |

---

## Security Considerations

1. **Authentication**: All endpoints require valid JWT token
2. **Rate Limiting**: Payment endpoints limited to 10 requests per 15 minutes
3. **Webhook Verification**: All webhooks verified with Stripe signature
4. **Amount Validation**: All amounts validated server-side
5. **Atomic Operations**: Balance updates use atomic RPC functions
6. **Error Handling**: No sensitive information exposed in error messages

---

## Testing

### Test Cards

| Card Number | Scenario |
|-------------|----------|
| 4242 4242 4242 4242 | Successful payment |
| 4000 0000 0000 0002 | Card declined |
| 4000 0025 0000 3155 | 3D Secure required |

### Test Flows

1. **Add Money**: Enter amount → Confirm → Check balance updated
2. **Withdrawal**: Enter amount → Select method → Confirm → Check balance deducted
3. **3DS**: Use 3DS test card → Complete authentication → Verify success
4. **Failed Transfer**: Simulate failure → Verify refund → Retry transfer

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12 | Initial specification |
| 1.1 | 2024-12 | Added service fee structure, error handling |
