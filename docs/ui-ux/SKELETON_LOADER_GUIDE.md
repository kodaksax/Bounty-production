# Skeleton Loader Implementation Guide

## Overview

This guide documents the implementation of animated skeleton loaders throughout the BOUNTYExpo application. Skeleton loaders provide a modern, professional loading experience by showing placeholders that mimic the final content layout.

## Core Principles

1. **Seamless Transitions**: Skeleton components smoothly fade out as actual content fades in
2. **Layout Preservation**: Skeletons match the exact layout of the content they're loading
3. **Performance**: All animations use native driver for 60fps performance
4. **Consistency**: All loading states follow the same emerald theme and animation patterns

## Implementation Components

### 1. Base Skeleton Component (`components/ui/skeleton.tsx`)

The foundation for all skeleton elements with built-in pulse animation.

**Features:**
- Smooth opacity pulsing (0.3 ↔ 1.0 over 800ms)
- Uses React Native Animated API with native driver
- Customizable via className prop
- Emerald theme colors (bg-muted with emerald tint)

**Usage:**
```tsx
import { Skeleton } from 'components/ui/skeleton';

<Skeleton className="h-4 w-32 bg-emerald-700/40" />
```

### 2. Skeleton Wrapper (`components/ui/skeleton-wrapper.tsx`)

Handles fade transitions between skeleton and actual content.

**Features:**
- Parallel fade-out (skeleton) and fade-in (content) animations
- Configurable fade duration (default: 300ms)
- Prevents layout shift using absolute positioning
- Zero-configuration usage

**Usage:**
```tsx
import { SkeletonWrapper } from 'components/ui/skeleton-wrapper';

<SkeletonWrapper 
  loading={isLoading} 
  skeleton={<PostingCardSkeleton />}
  fadeDuration={300}
>
  <BountyCard {...bounty} />
</SkeletonWrapper>
```

### 3. Pre-built Skeleton Components (`components/ui/skeleton-loaders.tsx`)

#### PostingCardSkeleton
Mimics the layout of bounty cards in the main feed.

**Layout:**
- Avatar (10×10, rounded-full)
- Username and timestamp
- Title line
- 2 description lines (varying width)
- Amount and location footer

#### TransactionItemSkeleton
Mimics wallet transaction list items.

**Layout:**
- Transaction icon (10×10, rounded-lg)
- Transaction title and timestamp
- Amount (right-aligned)

#### ConversationItemSkeleton
Mimics conversation list items in messenger.

**Layout:**
- Avatar (12×12, rounded-full)
- Name and timestamp header
- Last message preview

#### ChatMessageSkeleton
Mimics individual chat messages.

**Layout:**
- Message bubble (max-width: 80%)
- 2 text lines of varying width
- User/other styling variants

## Integration Examples

### Bounty Feed (Main Screen)

**File:** `app/tabs/bounty-app.tsx`

**Before:**
```tsx
ListEmptyComponent={() => (
  <Text>Loading bounties...</Text>
)}
```

**After:**
```tsx
ListEmptyComponent={() => (
  {isLoadingBounties ? (
    <View style={{ width: '100%' }}>
      <PostingsListSkeleton count={5} />
    </View>
  ) : (
    <EmptyState />
  )}
)}
```

**Loading More:**
```tsx
ListFooterComponent={() => (
  loadingMore ? (
    <View style={{ paddingVertical: 8 }}>
      <PostingsListSkeleton count={2} />
    </View>
  ) : null
)}
```

### Transaction History

**File:** `components/transaction-history-screen.tsx`

**Before:**
```tsx
{isLoading && (
  <View className="flex justify-center items-center py-10">
    <View className="h-8 w-8 rounded-full border-2 border-white border-t-transparent animate-spin" />
  </View>
)}
```

**After:**
```tsx
{isLoading && currentPage === 1 ? (
  <View className="py-6">
    <TransactionsListSkeleton count={5} />
  </View>
) : /* ... */}
```

### Messenger Conversations

**File:** `app/tabs/messenger-screen.tsx`

Already implemented with skeleton loaders:
```tsx
const ListEmptyComponent = useCallback(() => {
  if (loading) {
    return (
      <View className="px-4 py-6">
        <ConversationsListSkeleton count={5} />
      </View>
    );
  }
  // ... empty state
}, [loading]);
```

## Animation Specifications

### Pulse Animation
- **Duration:** 800ms per cycle
- **Opacity Range:** 0.3 → 1.0 → 0.3
- **Easing:** Linear (Animated.timing)
- **Loop:** Infinite

### Fade Transition
- **Duration:** 300ms (configurable)
- **Type:** Parallel (skeleton fade-out + content fade-in)
- **Native Driver:** Enabled for performance

## Color Palette

All skeleton components use the emerald theme:

- **Primary Background:** `rgba(4, 120, 87, 0.2)` to `rgba(4, 120, 87, 0.4)`
- **Skeleton Elements:** `bg-emerald-700/40` (emerald-700 at 40% opacity)
- **Maintains consistency** with the app's emerald-600/700/800 color scheme

## Best Practices

### 1. Match Content Layout
Always ensure skeleton components mirror the actual content:
- Same number of lines
- Same element sizes
- Same spacing and padding

### 2. Appropriate Count
Show enough skeletons to fill the viewport:
- **Initial Load:** 5 items for full-screen lists
- **Pagination:** 2-3 items for "loading more"
- **Small Lists:** Match expected item count

### 3. Loading State Management
```tsx
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  fetchData().then(() => {
    setIsLoading(false); // Triggers fade transition
  });
}, []);
```

### 4. Accessibility
Skeleton loaders improve perceived performance but should:
- Not block interaction once content is ready
- Provide screen reader announcements when loading completes
- Support reduced motion preferences

## Performance Considerations

### Native Driver
All animations use `useNativeDriver: true`:
```tsx
Animated.timing(opacity, {
  toValue: 1,
  duration: 300,
  useNativeDriver: true, // ✅ Better performance
})
```

### Optimization Tips
1. **Memoize Skeleton Components:** Use `React.memo()` for skeleton components
2. **Avoid Premature Optimization:** Don't add skeletons to instant operations
3. **Test on Real Devices:** Animations perform differently on simulator vs. device

## Testing Checklist

- [ ] Skeleton appears immediately on load
- [ ] Pulse animation runs smoothly
- [ ] Content fades in smoothly when data loads
- [ ] Skeleton fades out simultaneously
- [ ] No layout shift during transition
- [ ] Matches emerald theme colors
- [ ] Works on both iOS and Android
- [ ] Performance is 60fps on target devices

## Future Enhancements

Potential improvements to consider:

1. **Shimmer Effect:** Add horizontal shimmer animation
2. **Progressive Loading:** Show skeletons section-by-section
3. **Content-Based Skeletons:** Generate skeletons from content metadata
4. **Suspense Integration:** React Suspense support when available in React Native

## Related Files

- `components/ui/skeleton.tsx` - Base skeleton component
- `components/ui/skeleton-wrapper.tsx` - Fade transition wrapper
- `components/ui/skeleton-loaders.tsx` - Pre-built skeleton components
- `app/tabs/bounty-app.tsx` - Main feed implementation
- `components/transaction-history-screen.tsx` - Wallet implementation
- `app/tabs/messenger-screen.tsx` - Messenger implementation

## References

- [React Native Animated API](https://reactnative.dev/docs/animated)
- [Material Design Loading Patterns](https://material.io/design/communication/data-loading.html)
- [ANIMATION_GUIDE.md](./ANIMATION_GUIDE.md) - BOUNTYExpo animation standards
