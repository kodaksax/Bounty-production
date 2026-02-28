# Animation & Micro-interactions Usage Guide

This guide explains how to use the new animation components and micro-interactions added to BOUNTYExpo.

## Table of Contents
- [Skeleton Loaders](#skeleton-loaders)
- [Success Animations](#success-animations)
- [Empty State Animations](#empty-state-animations)
- [Button Animations](#button-animations)
- [Accessibility Considerations](#accessibility-considerations)

## Skeleton Loaders

### SkeletonCard Component

Use `SkeletonCard` to show loading states for bounty cards:

```tsx
import { SkeletonCard, SkeletonCardList } from '../components/ui/skeleton-card';

// Single skeleton card
function BountyList() {
  const [loading, setLoading] = useState(true);
  
  if (loading) {
    return <SkeletonCard />;
  }
  
  return <BountyCard data={bountyData} />;
}

// Multiple skeleton cards
function BountyListScreen() {
  const [loading, setLoading] = useState(true);
  
  if (loading) {
    return <SkeletonCardList count={5} />;
  }
  
  return <FlatList data={bounties} renderItem={renderBounty} />;
}
```

### Other Skeleton Components

```tsx
import { 
  PostingCardSkeleton,
  ConversationItemSkeleton,
  TransactionItemSkeleton,
  ProfileSkeleton
} from '../components/ui/skeleton-loaders';

// Use in your loading states
{isLoading ? <PostingCardSkeleton /> : <PostingCard data={data} />}
```

## Success Animations

### SuccessAnimation Component

Show a success checkmark animation for completed actions:

```tsx
import { SuccessAnimation } from '../components/ui/success-animation';

function PaymentScreen() {
  const [showSuccess, setShowSuccess] = useState(false);
  
  const handlePayment = async () => {
    try {
      await processPayment();
      setShowSuccess(true);
      
      // Hide after animation completes
      setTimeout(() => {
        setShowSuccess(false);
        navigate('/success');
      }, 2000);
    } catch (error) {
      // Handle error
    }
  };
  
  return (
    <View>
      {/* Your content */}
      
      <SuccessAnimation
        visible={showSuccess}
        icon="check-circle"
        size={80}
        color="#10b981"
        onComplete={() => console.log('Animation complete')}
      />
    </View>
  );
}
```

### ConfettiAnimation Component

Add celebratory confetti for special moments:

```tsx
import { ConfettiAnimation } from '../components/ui/success-animation';

function BountyCompletionScreen() {
  const [showConfetti, setShowConfetti] = useState(false);
  
  const handleComplete = async () => {
    await completeBounty();
    setShowConfetti(true);
    
    setTimeout(() => {
      setShowConfetti(false);
    }, 3000);
  };
  
  return (
    <View>
      {/* Your content */}
      
      <ConfettiAnimation
        visible={showConfetti}
        onComplete={() => console.log('Celebration complete!')}
      />
    </View>
  );
}
```

## Empty State Animations

The `EmptyState` component now includes enhanced animations:

```tsx
import { EmptyState } from '../components/ui/empty-state';

function BountyListScreen() {
  const { bounties, loading } = useBounties();
  
  if (loading) {
    return <SkeletonCardList />;
  }
  
  if (bounties.length === 0) {
    return (
      <EmptyState
        icon="search-off"
        title="No Bounties Found"
        description="Start by creating your first bounty or browse available opportunities!"
        actionLabel="Create Bounty"
        onAction={() => navigate('/create-bounty')}
        size="md"
        variant="default"
      />
    );
  }
  
  return <FlatList data={bounties} renderItem={renderBounty} />;
}
```

The icon will:
- Bounce in with a spring animation
- Settle to normal size
- Have a subtle continuous float effect
- Respect reduced motion preferences

## Button Animations

### Using the Button Component

The existing `Button` component already has:
- Scale to 0.95 on press
- Haptic feedback
- Smooth spring animations

```tsx
import { Button } from '../components/ui/button';

function MyScreen() {
  return (
    <Button
      variant="default"
      size="lg"
      onPress={handlePress}
      accessibilityLabel="Submit form"
    >
      Submit
    </Button>
  );
}
```

### Using AccessibleTouchable

For custom interactive elements, use `AccessibleTouchable`:

```tsx
import { AccessibleTouchable } from '../components/ui/accessible-touchable';

function CustomButton() {
  return (
    <AccessibleTouchable
      onPress={handlePress}
      haptic="light"
      animate={true}
      scaleOnPress={0.95}
      accessibilityLabel="Custom action"
    >
      <View style={styles.customButton}>
        <Text>Custom Button</Text>
      </View>
    </AccessibleTouchable>
  );
}
```

### AccessibleIconButton

For icon-only buttons:

```tsx
import { AccessibleIconButton } from '../components/ui/accessible-touchable';
import { MaterialIcons } from '@expo/vector-icons';

function SettingsButton() {
  return (
    <AccessibleIconButton
      size="md"
      onPress={openSettings}
      haptic="medium"
      accessibilityLabel="Open settings"
    >
      <MaterialIcons name="settings" size={24} color="#10b981" />
    </AccessibleIconButton>
  );
}
```

## Screen Transitions

Screen transitions are configured in the layout files:

```tsx
// app/my-feature/_layout.tsx
import { Stack } from 'expo-router';

export default function MyFeatureLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#1a3d2e' },
        animation: 'slide_from_right', // or 'slide_from_bottom' for modals
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen 
        name="modal"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
```

## Accessibility Considerations

All animations respect user preferences:

### Reduced Motion Support

All animation components check `AccessibilityInfo.isReduceMotionEnabled()`:

```tsx
// Automatically handled in components
const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

useEffect(() => {
  const checkMotionPreference = async () => {
    const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
    setPrefersReducedMotion(isReduceMotionEnabled);
  };
  checkMotionPreference();
}, []);
```

### Haptic Feedback

All interactive elements should provide haptic feedback for non-visual confirmation:

```tsx
import { hapticFeedback } from '../lib/haptic-feedback';

// Light tap
hapticFeedback.light();

// Success notification
hapticFeedback.success();

// Error notification
hapticFeedback.error();

// Warning
hapticFeedback.warning();

// Selection (toggles, pickers)
hapticFeedback.selection();
```

### Minimum Touch Targets

The `AccessibleTouchable` component enforces minimum 44x44pt touch targets by default:

```tsx
<AccessibleTouchable
  enforceMinSize={true} // default
  // ... other props
>
  <SmallIcon /> {/* Will be wrapped in 44x44 touchable area */}
</AccessibleTouchable>
```

## Best Practices

1. **Always provide loading states**: Use skeleton loaders instead of spinners
2. **Show success feedback**: Use success animations for important completions
3. **Respect accessibility**: All animations support reduced motion preferences
4. **Provide haptic feedback**: All interactive elements should have tactile response
5. **Use consistent animations**: Follow the established patterns (0.95 scale for press)
6. **Test on devices**: Animations may look different on physical devices vs simulators

## Performance Tips

1. **Use react-native-reanimated for animations**: Runs on UI thread for 60fps
2. **Minimize animation complexity**: Keep animations simple and purposeful
3. **Cleanup animations**: Always stop animations in cleanup functions
4. **Test with reduced motion**: Ensure fallbacks work properly

## Examples in Codebase

- **Payout Screen**: `app/postings/[bountyId]/payout.tsx` - Success animations with confetti
- **Empty States**: `components/ui/empty-state.tsx` - Enhanced entrance animations
- **Buttons**: `components/ui/button.tsx` - Press animations with haptics
- **Skeletons**: `components/ui/skeleton-loaders.tsx` - Comprehensive loading states
