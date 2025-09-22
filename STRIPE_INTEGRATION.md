# Stripe Integration for Wallet Functionality

## Overview

This implementation integrates Stripe payment processing into the wallet functionality of the bountyexpo app. It provides secure payment method management and payment processing for adding money to user wallets.

## Features

- ✅ Secure payment method storage using Stripe Elements
- ✅ Credit card input with validation and formatting
- ✅ Payment processing for adding money to wallet
- ✅ Payment method management (add, delete, set default)
- ✅ Proper error handling and loading states
- ✅ Integration with existing wallet UI

## Setup Requirements

### 1. Stripe Account Setup
1. Create a Stripe account at https://stripe.com
2. Get your publishable key from the Stripe dashboard
3. Set up your webhook endpoints for handling payment events

### 2. Environment Configuration
Copy `.env.example` to `.env` and update with your actual values:

```bash
cp .env.example .env
```

Update the following variables:
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`: Your Stripe publishable key
- `EXPO_PUBLIC_API_BASE_URL`: Your backend API URL

### 3. Backend API Requirements

Your backend API should implement the following endpoints:

#### Create Setup Intent
```
POST /api/stripe/setup-intent
Body: { customerId?: string }
Response: { client_secret: string, ... }
```

#### Create Payment Intent
```
POST /api/stripe/payment-intent
Body: { amount: number, currency: string, customerId?: string, paymentMethodId?: string }
Response: { client_secret: string, amount: number, currency: string, status: string }
```

#### Get Payment Methods
```
GET /api/stripe/payment-methods?customerId={customerId}
Response: { paymentMethods: PaymentMethodData[] }
```

#### Delete Payment Method
```
DELETE /api/stripe/payment-methods/{paymentMethodId}
Response: { success: boolean }
```

#### Set Default Payment Method
```
POST /api/stripe/default-payment-method
Body: { customerId: string, paymentMethodId: string }
Response: { success: boolean }
```

## Components

### StripeAddCardModal
- Uses Stripe's CardField component for secure card input
- Handles setup intent creation and confirmation
- Validates card information before submission
- Shows loading states during processing

### PaymentMethodsModal (Enhanced)
- Displays user's saved payment methods from Stripe
- Allows deletion and setting default payment methods
- Integrates with StripeAddCardModal for adding new cards

### AddMoneyScreen (Enhanced)
- Processes payments using Stripe's payment intents
- Confirms payments with saved payment methods
- Updates wallet balance upon successful payment

## Security Considerations

- ✅ Card information is handled by Stripe Elements (PCI compliant)
- ✅ No sensitive card data stored in the app
- ✅ Payment processing requires backend confirmation
- ✅ All API calls should be authenticated
- ✅ Webhook endpoints should verify Stripe signatures

## Testing

### Test Cards
Use Stripe's test card numbers for development:
- `4242 4242 4242 4242` - Visa (succeeds)
- `4000 0000 0000 0002` - Visa (declined)
- `4000 0000 0000 9995` - Visa (insufficient funds)

### Development Mode
Set `EXPO_PUBLIC_STRIPE_TEST_MODE=true` in your `.env` file to use test mode.

## Error Handling

The integration includes comprehensive error handling:
- Network errors
- Stripe API errors
- Validation errors
- User-friendly error messages

## Next Steps

1. Implement the backend API endpoints
2. Set up Stripe webhooks for payment confirmation
3. Add payment history tracking
4. Implement refund functionality
5. Add support for other payment methods (Apple Pay, Google Pay)

## File Structure

```
lib/services/
  stripe-service.ts       # Core Stripe service functions

components/
  stripe-add-card-modal.tsx    # Stripe-powered card input
  payment-methods-modal.tsx    # Enhanced with Stripe integration
  add-money-screen.tsx         # Enhanced with payment processing

app/
  _layout.tsx                  # Stripe initialization
```