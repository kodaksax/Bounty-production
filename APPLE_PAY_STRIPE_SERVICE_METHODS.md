# Apple Pay Methods in StripeService

## Overview

As requested in the issue, the following Apple Pay methods have been added to the `StripeService` class to complement the existing `apple-pay-service.ts` implementation.

## Methods Added

### `isApplePaySupported()`

Checks if Apple Pay is supported on the current device.

**Returns:** `Promise<boolean>`

**Behavior:**
- Returns `false` immediately on non-iOS platforms
- Checks if the Stripe SDK is initialized and has Apple Pay support
- Handles different SDK versions (checks both direct method and nested ApplePay object)
- Gracefully handles errors and returns `false` on failure

**Example:**
```typescript
import { stripeService } from 'lib/services/stripe-service';

const supported = await stripeService.isApplePaySupported();
if (supported) {
  // Show Apple Pay button
}
```

### `presentApplePay(amount, description?, cartItems?)`

Presents the Apple Pay payment sheet to the user.

**Parameters:**
- `amount` (number): Amount in dollars (e.g., 10.50)
- `description` (string, optional): Description for the payment. Default: "Add Money to Wallet"
- `cartItems` (Array, optional): Custom cart items for the Apple Pay sheet

**Returns:** `Promise<{ success: boolean; error?: string; errorCode?: string }>`

**Behavior:**
- Validates amount is greater than zero before any SDK calls
- Initializes Stripe SDK if not already initialized
- Presents Apple Pay sheet with configured cart items
- Handles user cancellation separately (errorCode: 'cancelled')
- Returns structured result with success status and optional error details

**Example:**
```typescript
import { stripeService } from 'lib/services/stripe-service';

const result = await stripeService.presentApplePay(
  25.00,
  'Wallet Top-up'
);

if (result.success) {
  console.log('Payment presented successfully');
} else if (result.errorCode === 'cancelled') {
  console.log('User cancelled payment');
} else {
  console.error('Payment error:', result.error);
}
```

**Custom Cart Items Example:**
```typescript
const result = await stripeService.presentApplePay(
  35.00,
  'Order Payment',
  [
    { label: 'Item 1', amount: '20.00', type: 'final' },
    { label: 'Item 2', amount: '15.00', type: 'final' }
  ]
);
```

## Integration Status

### UI Integration
The `AddMoneyScreen` component (`components/add-money-screen.tsx`) already has full Apple Pay integration:
- Apple Pay button displays on iOS when available
- Uses `applePayService.isAvailable()` to check availability
- Uses `applePayService.processPayment()` for complete payment flow
- Handles errors, loading states, and user cancellation

### Alternative Usage
While `applePayService` provides a complete payment flow (creating payment intent, presenting Apple Pay, and confirming), the new `StripeService` methods provide lower-level access for custom implementations:

```typescript
// Complete flow with apple-pay-service (recommended for most cases)
const result = await applePayService.processPayment({
  amount: 25.00,
  description: 'Add Money'
}, authToken);

// Lower-level control with StripeService
const supported = await stripeService.isApplePaySupported();
if (supported) {
  const result = await stripeService.presentApplePay(25.00);
  // Handle payment confirmation separately
}
```

## Testing

Unit tests have been added to `__tests__/unit/services/stripe-service.test.ts`:

- ✅ Tests for iOS vs non-iOS platform detection
- ✅ Tests for SDK availability
- ✅ Tests for amount validation (zero and negative amounts)
- ✅ Tests for default description
- ✅ Tests for custom cart items
- ✅ Tests for error handling

All tests pass successfully.

## Configuration

Apple Pay requires:
1. **Merchant ID** configured in `app.json` (already done: `merchant.com.bountyexpo-workspace`)
2. **Stripe SDK initialization** with merchantIdentifier (already done in StripeService constructor)
3. **Production configuration** as per `APPLE_PAY_PRODUCTION_CONFIG.md`

## Related Files

- `/lib/services/stripe-service.ts` - Main service with new methods
- `/lib/services/apple-pay-service.ts` - Complete Apple Pay payment flow
- `/components/add-money-screen.tsx` - UI integration
- `/__tests__/unit/services/stripe-service.test.ts` - Unit tests
- `/APPLE_PAY_PRODUCTION_CONFIG.md` - Production setup guide
- `/APPLE_PAY_IMPLEMENTATION_SUMMARY.md` - Complete implementation overview

## Summary

The requested `isApplePaySupported()` and `presentApplePay()` methods have been successfully added to `StripeService`, providing an alternative interface for Apple Pay functionality. The `AddMoneyScreen` already has a complete Apple Pay button implementation using the existing `applePayService`.
