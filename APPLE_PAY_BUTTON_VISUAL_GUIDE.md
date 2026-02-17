# Apple Pay Button in AddMoneyScreen - Visual Guide

## Location
File: `components/add-money-screen.tsx`  
Lines: 318-338

## Description
The Apple Pay button is already fully implemented in the AddMoneyScreen component. It displays only on iOS devices when Apple Pay is available.

## Visual Appearance

```
┌─────────────────────────────────────┐
│                                     │
│         $25.00                      │  <- Amount Display (emerald bg)
│                                     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│                                     │
│   ┌─────────────────────────────┐   │
│   │    [🍎] Pay                 │   │  <- Apple Pay Button (black)
│   └─────────────────────────────┘   │
│                                     │
│   ┌─────────────────────────────┐   │
│   │    Add Money                │   │  <- Regular Button (gray)
│   └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

## Button Specifications

### Apple Pay Button
- **Background Color:** Black (#000000)
- **Text:** "Pay" 
- **Icon:** Apple icon (from MaterialIcons)
- **Size:** Full width with padding
- **Border Radius:** Rounded (full)
- **Margin Bottom:** 12px (mb-3)
- **Position:** Above the "Add Money" button

### States

#### Enabled State
```typescript
// Amount > 0 and not processing
<TouchableOpacity
  style={{ backgroundColor: '#000000' }}
  onPress={handleApplePayPress}
>
  <MaterialIcons name="apple" size={22} color="#ffffff" />
  <Text className="text-white text-base font-medium ml-2">Pay</Text>
</TouchableOpacity>
```

#### Processing State
```typescript
// While payment is being processed
<TouchableOpacity
  disabled={true}
  style={{ backgroundColor: '#000000' }}
>
  <ActivityIndicator size="small" color="#ffffff" />
  <Text className="text-white">Processing...</Text>
</TouchableOpacity>
```

#### Disabled State
```typescript
// Amount = 0 or negative
<TouchableOpacity
  disabled={true}
  // Button becomes unresponsive but visible
>
```

## Visibility Conditions

The Apple Pay button only displays when:
1. ✅ Platform.OS === 'ios'
2. ✅ isApplePayAvailable === true

```typescript
{Platform.OS === 'ios' && isApplePayAvailable && (
  <TouchableOpacity ... />
)}
```

## Behavior Flow

1. **User enters amount** → Button becomes enabled
2. **User taps Apple Pay button** → Shows system Apple Pay sheet
3. **User authorizes with Face ID/Touch ID** → Payment processes
4. **Success** → Wallet balance updates, success alert shown
5. **Cancelled** → No alert, button returns to normal state
6. **Error** → Error banner displayed above keypad

## Integration with StripeService

The button currently uses `applePayService.processPayment()` which internally:
1. Creates payment intent on backend
2. Presents Apple Pay sheet (using SDK methods similar to new StripeService methods)
3. Confirms payment
4. Verifies on backend

The new `stripeService.presentApplePay()` method can be used as an alternative for custom implementations.

## Code Snippet

```typescript
// From components/add-money-screen.tsx (lines 177-230)
const handleApplePayPress = async () => {
  const numAmount = Number.parseFloat(amount)
  if (isNaN(numAmount) || numAmount <= 0) {
    Alert.alert('Invalid Amount', 'Please enter a valid amount')
    return
  }

  if (numAmount < 0.5) {
    Alert.alert('Minimum Amount', 'Amount must be at least $0.50')
    return
  }

  setIsProcessing(true)
  setError(null)

  try {
    const result = await applePayService.processPayment({
      amount: numAmount,
      description: 'Add Money to Wallet',
    }, session?.access_token)

    if (result.success) {
      await deposit(numAmount, {
        method: 'Apple Pay',
        title: 'Added Money via Apple Pay',
        status: 'completed',
      })

      Alert.alert(
        'Success!',
        `$${numAmount.toFixed(2)} has been added to your wallet via Apple Pay.`,
        [{ text: 'OK', onPress: () => { onAddMoney?.(numAmount); onBack?.() } }]
      )
    } else if (result.errorCode === 'cancelled') {
      // User cancelled - no alert
    } else {
      setError({ message: result.error || 'Unable to process Apple Pay payment.', type: 'payment' })
    }
  } catch (err) {
    console.error('Apple Pay error:', err)
    setError(err)
  } finally {
    setIsProcessing(false)
  }
}
```

## Accessibility

- ✅ Button has proper touch target size
- ✅ Loading state provides visual feedback
- ✅ Error messages are clear and actionable
- ✅ activeOpacity provides tactile feedback (0.8)

## Platform Compatibility

| Platform | Support | Notes |
|----------|---------|-------|
| iOS | ✅ Yes | Full Apple Pay support |
| Android | ❌ No | Button not shown (uses Google Pay or cards) |
| Web | ❌ No | Not applicable for this native implementation |

## Testing Checklist

- [x] Button appears on iOS when Apple Pay is available
- [x] Button hidden on Android
- [x] Button disabled when amount is 0 or negative
- [x] Button shows loading state during processing
- [x] Button handles successful payments
- [x] Button handles user cancellation gracefully
- [x] Button displays errors in error banner
- [x] Button respects minimum amount ($0.50)

## Related Files

- `/components/add-money-screen.tsx` - Main implementation
- `/lib/services/apple-pay-service.ts` - Payment processing
- `/lib/services/stripe-service.ts` - New alternative methods
- `/APPLE_PAY_STRIPE_SERVICE_METHODS.md` - Method documentation
- `/APPLE_PAY_PRODUCTION_CONFIG.md` - Production setup

## Summary

The Apple Pay button is fully implemented and production-ready. It provides a seamless payment experience for iOS users, with proper error handling, loading states, and user feedback. The button integrates perfectly with the existing payment infrastructure and follows Apple's design guidelines.
