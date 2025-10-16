# Apple Pay Implementation Guide for BountyExpo Wallet

## Current State

The current wallet implementation uses **mock Stripe payment processing** and does **not** include Apple Pay support. This guide provides a complete roadmap for implementing native Apple Pay for iOS in-app purchases.

## Prerequisites

✅ **Already Installed** (in package.json):
- `@stripe/stripe-react-native`: "0.50.3" - Stripe React Native SDK
- `expo-apple-authentication`: "~8.0.7" - Expo Apple Authentication
- `@invertase/react-native-apple-authentication`: "^2.4.1" - React Native Apple Auth

## Why Apple Pay?

### Benefits
- **Native iOS Experience**: Seamless, trusted payment method
- **Faster Checkout**: One-tap payment with biometric authentication
- **Security**: Apple Pay doesn't share actual card numbers
- **Trust**: Users already trust Apple Pay for purchases
- **Conversion**: Higher completion rates than manual card entry

### Use Cases in BountyExpo
1. **Add Money to Wallet**: Quick deposits via Apple Pay
2. **Direct Bounty Payment**: Pay hunters directly without wallet balance
3. **Escrow Funding**: One-tap escrow creation when accepting requests

## Implementation Architecture

```
┌─────────────────────────────────────────────┐
│          Add Money Screen                   │
│  ┌───────────────────────────────────┐      │
│  │    Enter Amount: $50.00           │      │
│  └───────────────────────────────────┘      │
│                                              │
│  ┌───────────────────────────────────┐      │
│  │  [ Pay with Apple Pay 🍎 ]        │◄─────┼─── Native Apple Pay Sheet
│  └───────────────────────────────────┘      │
│                                              │
│  ┌───────────────────────────────────┐      │
│  │  [ Pay with Card 💳 ]             │◄─────┼─── Existing Stripe Card Entry
│  └───────────────────────────────────┘      │
└─────────────────────────────────────────────┘
           ▼                    ▼
    ┌──────────┐         ┌──────────┐
    │ Apple Pay│         │  Stripe  │
    │ Payment  │         │  Payment │
    └──────────┘         └──────────┘
           ▼                    ▼
    ┌─────────────────────────────┐
    │   Update Wallet Balance     │
    └─────────────────────────────┘
```

## Step-by-Step Implementation

### Step 1: Configure Apple Pay in Stripe Dashboard

1. **Login to Stripe Dashboard**
   - Go to https://dashboard.stripe.com
   - Navigate to Settings → Payment methods

2. **Enable Apple Pay**
   - Enable Apple Pay for your account
   - Register your domain(s) for web (if needed)
   - Note: Mobile apps don't need domain registration

3. **Get Merchant ID**
   - Apple Pay requires a Merchant ID from Apple Developer Portal
   - Format: `merchant.com.yourdomain.bountyexpo`

### Step 2: Configure Apple Developer Account

1. **Create Merchant ID**
   - Go to Apple Developer Portal → Certificates, Identifiers & Profiles
   - Create new Merchant ID: `merchant.com.bountyexpo.wallet`

2. **Enable Apple Pay in Xcode**
   ```xml
   <!-- In ios/BountyExpo.entitlements -->
   <key>com.apple.developer.in-app-payments</key>
   <array>
     <string>merchant.com.bountyexpo.wallet</string>
   </array>
   ```

3. **Update app.json**
   ```json
   {
     "expo": {
       "ios": {
         "bundleIdentifier": "com.bountyexpo.app",
         "merchantId": "merchant.com.bountyexpo.wallet",
         "infoPlist": {
           "NSApplePayCapability": "production"
         }
       }
     }
   }
   ```

### Step 3: Create Apple Pay Service

Create `lib/services/apple-pay-service.ts`:

```typescript
import { Platform } from 'react-native';
import { initStripe, presentApplePay, StripeError } from '@stripe/stripe-react-native';

export interface ApplePayResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
}

class ApplePayService {
  private isInitialized = false;
  private merchantId = 'merchant.com.bountyexpo.wallet'; // Update with your Merchant ID

  async initialize(publishableKey: string): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      await initStripe({
        publishableKey,
        merchantIdentifier: this.merchantId,
        urlScheme: 'bountyexpo', // For returning from external payment
      });
      
      this.isInitialized = true;
      console.log('✅ Apple Pay service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Apple Pay:', error);
      throw error;
    }
  }

  async isApplePaySupported(): Promise<boolean> {
    // Apple Pay only works on iOS
    if (Platform.OS !== 'ios') {
      return false;
    }

    try {
      const { isApplePaySupported } = await import('@stripe/stripe-react-native');
      return await isApplePaySupported();
    } catch (error) {
      console.error('Error checking Apple Pay support:', error);
      return false;
    }
  }

  async presentApplePaySheet(
    amount: number,
    description: string = 'Add Money to Wallet'
  ): Promise<ApplePayResult> {
    try {
      if (!this.isInitialized) {
        throw new Error('Apple Pay not initialized');
      }

      // Present Apple Pay sheet
      const { error, paymentMethod } = await presentApplePay({
        cartItems: [
          {
            label: description,
            amount: amount.toFixed(2),
            type: 'final',
          },
        ],
        country: 'US',
        currency: 'USD',
        requiredShippingAddressFields: [],
        requiredBillingContactFields: ['postalAddress'],
      });

      if (error) {
        console.error('Apple Pay error:', error);
        return {
          success: false,
          error: error.message,
        };
      }

      if (!paymentMethod) {
        return {
          success: false,
          error: 'No payment method returned',
        };
      }

      // Payment method received, now confirm with backend
      return {
        success: true,
        paymentIntentId: paymentMethod.id,
      };
    } catch (error) {
      console.error('Apple Pay presentation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const applePayService = new ApplePayService();
```

### Step 4: Update Stripe Service

Modify `lib/services/stripe-service.ts` to support Apple Pay:

```typescript
// Add to StripeService class

async confirmApplePayPayment(
  paymentIntentClientSecret: string,
  billingDetails?: any
): Promise<StripePaymentIntent> {
  try {
    const { confirmApplePayPayment } = await import('@stripe/stripe-react-native');
    
    const { error, paymentIntent } = await confirmApplePayPayment(
      paymentIntentClientSecret,
      {
        billingDetails,
      }
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!paymentIntent) {
      throw new Error('Payment intent not returned');
    }

    return {
      id: paymentIntent.id,
      client_secret: paymentIntentClientSecret,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status as any,
    };
  } catch (error) {
    console.error('Error confirming Apple Pay payment:', error);
    throw this.handleStripeError(error);
  }
}
```

### Step 5: Update Add Money Screen

Modify `components/add-money-screen.tsx`:

```typescript
import { Platform } from 'react-native';
import { applePayService } from '../lib/services/apple-pay-service';

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isApplePayAvailable, setIsApplePayAvailable] = useState(false);
  const { deposit } = useWallet();
  const { processPayment, paymentMethods } = useStripe();

  // Check Apple Pay availability on mount
  useEffect(() => {
    checkApplePayAvailability();
  }, []);

  const checkApplePayAvailability = async () => {
    if (Platform.OS === 'ios') {
      const available = await applePayService.isApplePaySupported();
      setIsApplePayAvailable(available);
    }
  };

  const handleApplePayPress = async () => {
    const numAmount = Number.parseFloat(amount);
    if (!isNaN(numAmount) && numAmount > 0) {
      setIsProcessing(true);
      
      try {
        // Present Apple Pay sheet
        const result = await applePayService.presentApplePaySheet(
          numAmount,
          'Add Money to Wallet'
        );

        if (result.success) {
          // Add to local wallet balance
          await deposit(numAmount, {
            method: 'Apple Pay',
            title: 'Added Money via Apple Pay',
            status: 'completed',
          });

          Alert.alert(
            'Success!',
            `$${numAmount.toFixed(2)} has been added to your wallet via Apple Pay.`,
            [
              {
                text: 'OK',
                onPress: () => {
                  onAddMoney?.(numAmount);
                  onBack?.();
                },
              },
            ]
          );
        } else {
          Alert.alert(
            'Payment Failed',
            result.error || 'Unable to process Apple Pay payment.',
            [{ text: 'OK' }]
          );
        }
      } catch (error) {
        Alert.alert(
          'Error',
          'Something went wrong with Apple Pay. Please try again.',
          [{ text: 'OK' }]
        );
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <View className="flex-1 bg-emerald-600">
      {/* ... existing header and amount display ... */}

      {/* Payment Method Buttons */}
      <View className="px-4 mb-8">
        {/* Apple Pay Button (iOS only) */}
        {isApplePayAvailable && (
          <TouchableOpacity
            className="w-full py-4 rounded-full flex-row items-center justify-center mb-4"
            style={{ backgroundColor: '#000000' }}
            onPress={handleApplePayPress}
            disabled={Number.parseFloat(amount) <= 0 || isProcessing}
          >
            <Text className="text-white text-base font-medium mr-2">Pay with</Text>
            <MaterialIcons name="apple" size={24} color="#ffffff" />
            <Text className="text-white text-base font-medium ml-1">Pay</Text>
          </TouchableOpacity>
        )}

        {/* Credit Card Button */}
        <TouchableOpacity
          className={cn(
            "w-full py-4 rounded-full flex-row items-center justify-center",
            Number.parseFloat(amount) > 0 && !isProcessing ? "bg-gray-700" : "bg-gray-700/50"
          )}
          disabled={Number.parseFloat(amount) <= 0 || isProcessing}
          onPress={handleAddMoney}
        >
          {isProcessing ? (
            <>
              <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
              <Text className="text-white">Processing...</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="credit-card" size={20} color="#ffffff" />
              <Text className="text-white text-base font-medium ml-2">
                Pay with Card
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

### Step 6: Backend Integration

Your backend needs to create Payment Intents for Apple Pay:

```typescript
// Backend API endpoint: POST /api/create-payment-intent
app.post('/api/create-payment-intent', async (req, res) => {
  const { amount, currency = 'usd', userId } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      payment_method_types: ['card'], // Add 'apple_pay' when ready
      metadata: {
        userId,
        type: 'wallet_deposit',
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Step 7: Initialize Apple Pay in App

Update `App.tsx` or root provider:

```typescript
import { StripeProvider as StripeProviderNative } from '@stripe/stripe-react-native';

export default function App() {
  return (
    <StripeProviderNative
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''}
      merchantIdentifier="merchant.com.bountyexpo.wallet"
    >
      <WalletProvider>
        <YourApp />
      </WalletProvider>
    </StripeProviderNative>
  );
}
```

## Testing Apple Pay

### Testing in Simulator
1. **Add Test Card to Wallet**
   - iOS Simulator Settings → Wallet & Apple Pay
   - Add test Visa card: 4242 4242 4242 4242
   - Any future expiry date and any CVC

2. **Test the Flow**
   - Run app in iOS Simulator
   - Navigate to Add Money screen
   - Enter amount (e.g., $50)
   - Tap "Pay with Apple Pay"
   - Confirm with Face ID/Touch ID simulation

### Testing on Physical Device
1. **Enable Developer Mode**
   - Settings → Developer
   - Enable "Sandbox" for Apple Pay

2. **Use Test Cards**
   - Stripe provides test cards for Apple Pay
   - Add them to your physical device's Wallet app

3. **Test Real Flow**
   - Use actual biometric authentication
   - Verify payment completes
   - Check wallet balance updates

## UI/UX Best Practices

### Button Design
```typescript
// Apple Pay button should use Apple's official styling
const ApplePayButton = () => (
  <TouchableOpacity
    style={{
      backgroundColor: '#000000',
      height: 48,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
    }}
  >
    <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
       Pay
    </Text>
  </TouchableOpacity>
);
```

### Loading States
```typescript
// Show processing state during Apple Pay
{isProcessingApplePay && (
  <View style={styles.processingOverlay}>
    <ActivityIndicator size="large" color="#ffffff" />
    <Text style={{ color: '#ffffff', marginTop: 16 }}>
      Processing Apple Pay...
    </Text>
  </View>
)}
```

### Error Handling
```typescript
// Handle Apple Pay specific errors
const handleApplePayError = (error: StripeError) => {
  switch (error.code) {
    case 'canceled':
      // User canceled, no need to show error
      break;
    case 'authentication_failed':
      Alert.alert('Authentication Failed', 'Please try again with Face ID or Touch ID.');
      break;
    case 'invalid_amount':
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      break;
    default:
      Alert.alert('Payment Failed', error.message);
  }
};
```

## Security Considerations

### PCI Compliance
✅ **Apple Pay is PCI Compliant**: Apple Pay doesn't share actual card numbers with your app or server. Instead, it uses device-specific tokens.

### Best Practices
1. **Always use HTTPS** for API calls
2. **Validate amounts** on backend before creating Payment Intent
3. **Implement rate limiting** to prevent abuse
4. **Log all transactions** for audit trail
5. **Use 3D Secure** when required by card issuer

## Production Checklist

Before going live with Apple Pay:

- [ ] Register production Merchant ID in Apple Developer Portal
- [ ] Enable Apple Pay in Stripe Dashboard (production mode)
- [ ] Update app.json with production Merchant ID
- [ ] Test with real credit cards (not test cards)
- [ ] Implement webhook handling for payment confirmations
- [ ] Add transaction receipts via email
- [ ] Set up monitoring for failed payments
- [ ] Implement refund handling
- [ ] Add customer support contact for payment issues
- [ ] Review Apple Pay Human Interface Guidelines
- [ ] Submit app for App Store review with In-App Purchase enabled

## Cost Considerations

### Stripe Fees
- **Card Payments**: 2.9% + $0.30 per successful charge
- **Apple Pay**: Same rate as card payments
- **No additional fees** for Apple Pay vs card

### Apple Fees
- **No fees for Apple Pay** in apps (unlike In-App Purchases which are 30%)
- Apple Pay is free to implement and use

## Troubleshooting

### Common Issues

**Issue**: "Apple Pay not available"
**Solution**: 
- Check iOS version (requires iOS 13+)
- Verify Merchant ID in app.json
- Ensure device has cards in Wallet

**Issue**: "Payment method required"
**Solution**:
- User needs at least one card in Apple Wallet
- Prompt user to add card to Wallet app

**Issue**: "Authentication failed"
**Solution**:
- Verify Face ID/Touch ID is enabled
- Check device biometric settings

## Alternative: Google Pay for Android

For Android users, implement Google Pay similarly:

```typescript
// lib/services/google-pay-service.ts
import { GooglePay } from '@stripe/stripe-react-native';

async presentGooglePaySheet(amount: number) {
  const { error, paymentMethod } = await GooglePay.presentForPaymentIntent({
    clientSecret: paymentIntentClientSecret,
  });
  // ... handle payment
}
```

## Next Steps

1. **Short Term** (1-2 weeks):
   - Set up Merchant ID in Apple Developer Portal
   - Implement ApplePayService
   - Update Add Money screen with Apple Pay button
   - Test in simulator

2. **Medium Term** (2-4 weeks):
   - Backend Payment Intent creation
   - Webhook handling for confirmations
   - Error handling and retry logic
   - Physical device testing

3. **Long Term** (1-2 months):
   - Google Pay for Android
   - Express checkout for bounties
   - Saved payment preferences
   - Recurring payments

## Resources

### Documentation
- [Stripe Apple Pay Guide](https://stripe.com/docs/apple-pay)
- [Stripe React Native](https://stripe.com/docs/payments/accept-a-payment?platform=react-native)
- [Apple Pay Developer](https://developer.apple.com/apple-pay/)
- [Expo Apple Authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)

### Support
- Stripe Support: https://support.stripe.com
- Apple Developer Forums: https://developer.apple.com/forums/
- React Native Stripe Issues: https://github.com/stripe/stripe-react-native/issues

## Conclusion

This guide provides everything needed to implement Apple Pay in BountyExpo. The current implementation uses mock Stripe processing, but with these changes, you'll have:

✅ Native Apple Pay support on iOS
✅ Faster checkout experience
✅ Higher conversion rates
✅ Improved user trust
✅ Production-ready payment flow

**Estimated Implementation Time**: 2-3 weeks for full production-ready Apple Pay integration.
