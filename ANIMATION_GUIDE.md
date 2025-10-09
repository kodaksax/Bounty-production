# Animation Guide

This guide shows how to use the new animation components and emerald theme features in BountyExpo.

## Theme Integration

### Using the Enhanced ThemeProvider

The `ThemeProvider` now exposes the full emerald color palette and design tokens:

```tsx
import { useTheme } from 'components/theme-provider';
import { useAppTheme } from 'hooks/use-app-theme';

// Access theme in components
function MyComponent() {
  const { colors, spacing, shadows } = useAppTheme();
  
  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.background.primary,
      padding: spacing.lg,
      ...shadows.xl,
    },
    text: {
      color: colors.text.primary,
    }
  });
}
```

### Emerald Color Palette

The theme uses consistent emerald colors (emerald-600/700/800):

- **Primary Brand**: `#00912C` (emerald-600)
- **Dark Emerald**: `#007423` (emerald-700)
- **Darker Emerald**: `#00571a` (emerald-800)

These colors are used throughout for:
- Primary buttons and CTAs
- Icon highlights
- Card borders and glows
- Success states

## Animated Components

### 1. AnimatedScreen

Provides smooth enter/exit animations for screen transitions.

```tsx
import { AnimatedScreen } from 'components/ui/animated-screen';

export function MyScreen() {
  return (
    <AnimatedScreen animationType="fade" duration={300}>
      <View>
        {/* Your screen content */}
      </View>
    </AnimatedScreen>
  );
}
```

**Animation Types:**
- `fade` - Simple opacity transition (default)
- `slide` - Slide up with fade
- `scale` - Scale up with fade

**Props:**
- `animationType?: 'fade' | 'slide' | 'scale'` - Type of animation
- `duration?: number` - Animation duration in ms (default: 300)

### 2. AnimatedCard

Themeable card with optional expansion and press animations.

```tsx
import { AnimatedCard } from 'components/ui/animated-card';

// Simple card with press animation
<AnimatedCard variant="elevated" pressable onPress={() => console.log('pressed')}>
  <Text>Card content</Text>
</AnimatedCard>

// Expandable card
<AnimatedCard 
  expandable 
  expanded={isExpanded} 
  onToggle={setIsExpanded}
>
  <Text>Tap to expand/collapse</Text>
  {isExpanded && <Text>Additional content</Text>}
</AnimatedCard>
```

**Props:**
- `variant?: 'default' | 'elevated'` - Visual style with emerald theming
- `expandable?: boolean` - Enable expansion animation
- `expanded?: boolean` - Control expansion state
- `onToggle?: (expanded: boolean) => void` - Expansion callback
- `pressable?: boolean` - Enable press animation
- `onPress?: () => void` - Press callback

### 3. Enhanced Button

Buttons now have press animations and haptic feedback.

```tsx
import { Button } from 'components/ui/button';

<Button 
  variant="default" // Uses emerald-600 background
  onPress={() => console.log('pressed')}
>
  Create Bounty
</Button>
```

**Interactions:**
- Press: Scales to 0.95 with spring animation
- Release: Springs back to 1.0
- Haptic: Light feedback on press (warning for destructive)

### 4. Enhanced EmptyState

Empty states now have entrance animations and emerald theming.

```tsx
import { EmptyState, BountyEmptyState } from 'components/ui/empty-state';

// Generic empty state
<EmptyState
  icon="search-off"
  title="No results found"
  description="Try adjusting your search criteria to find what you're looking for."
  actionLabel="Clear Filters"
  onAction={() => clearFilters()}
/>

// Bounty-specific empty state
<BountyEmptyState 
  filter={currentFilter}
  onClearFilter={() => setFilter('all')}
/>
```

**Features:**
- Icon scales in with animation
- Content fades in after icon
- Emerald-themed icon background with glow
- Improved, helpful copy

## Best Practices

### Animation Performance

1. **Always use `useNativeDriver: true`** for transform and opacity animations:
```tsx
Animated.timing(value, {
  toValue: 1,
  duration: 200,
  useNativeDriver: true, // ✅ Runs on UI thread
}).start();
```

2. **Avoid animating layout properties** (width, height, flex) - they can't use native driver:
```tsx
// ❌ Bad - can't use native driver
Animated.timing(width, { toValue: 100, useNativeDriver: false })

// ✅ Good - uses native driver
Animated.timing(scaleX, { toValue: 1.2, useNativeDriver: true })
```

3. **Use LayoutAnimation carefully** - can cause jank on Android:
```tsx
// Configure before state changes
LayoutAnimation.configureNext({
  duration: 300,
  create: { type: LayoutAnimation.Types.easeInEaseOut },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
});
setExpanded(!expanded);
```

### Emerald Theme Consistency

1. **Use theme tokens instead of hardcoded colors:**
```tsx
// ❌ Bad
const styles = { backgroundColor: '#10b981' }

// ✅ Good
const { colors } = useAppTheme();
const styles = { backgroundColor: colors.primary[600] }
```

2. **Apply emerald glow to elevated elements:**
```tsx
const styles = {
  shadowColor: colors.primary[600], // emerald-600
  shadowOpacity: 0.3,
  shadowRadius: 12,
}
```

3. **Use consistent border colors:**
```tsx
// For subtle borders
borderColor: 'rgba(0, 145, 44, 0.2)' // emerald-600 at 20%

// For prominent borders
borderColor: 'rgba(0, 145, 44, 0.4)' // emerald-600 at 40%
```

### Micro-interactions

1. **Add haptic feedback for important actions:**
```tsx
import { useHapticFeedback } from 'lib/haptic-feedback';

const { triggerHaptic } = useHapticFeedback();

const handlePress = () => {
  triggerHaptic('light'); // or 'medium', 'heavy', 'warning'
  // ... handle action
};
```

2. **Use spring animations for natural feel:**
```tsx
Animated.spring(value, {
  toValue: 1,
  tension: 300,
  friction: 10,
  useNativeDriver: true,
}).start();
```

## Examples

### Animated Modal/Sheet Entry
```tsx
function MyModal({ visible }) {
  return (
    <AnimatedScreen animationType="slide" duration={250}>
      <View style={styles.modalContent}>
        {/* Content */}
      </View>
    </AnimatedScreen>
  );
}
```

### Card List with Press Feedback
```tsx
function BountyList({ bounties }) {
  return (
    <FlatList
      data={bounties}
      renderItem={({ item }) => (
        <AnimatedCard 
          variant="elevated" 
          pressable 
          onPress={() => navigateToBounty(item.id)}
          style={{ marginBottom: 16 }}
        >
          <Text>{item.title}</Text>
        </AnimatedCard>
      )}
    />
  );
}
```

### Themed Button Group
```tsx
const { colors } = useAppTheme();

<View style={{ flexDirection: 'row', gap: 12 }}>
  <Button variant="default">Accept</Button>
  <Button variant="outline">Decline</Button>
</View>
```

## Migration Guide

### Converting Existing Components

1. **Wrap screens with AnimatedScreen:**
```tsx
// Before
export function MyScreen() {
  return <View>...</View>;
}

// After
export function MyScreen() {
  return (
    <AnimatedScreen animationType="fade">
      <View>...</View>
    </AnimatedScreen>
  );
}
```

2. **Replace hardcoded emerald colors:**
```tsx
// Before
backgroundColor: '#10b981'

// After
import { theme } from 'lib/theme';
backgroundColor: theme.colors.primary[600]
```

3. **Add press animations to interactive cards:**
```tsx
// Before
<TouchableOpacity onPress={...}>
  <View style={cardStyle}>...</View>
</TouchableOpacity>

// After
<AnimatedCard pressable onPress={...}>
  ...
</AnimatedCard>
```

## Testing

When testing animated components:

1. **Check animation smoothness** - Should be 60fps, no jank
2. **Verify haptic feedback** - Test on physical device
3. **Test theme consistency** - All emerald colors should match
4. **Check accessibility** - Animations should respect reduced motion preferences

## Resources

- [React Native Animated API](https://reactnative.dev/docs/animated)
- [LayoutAnimation Guide](https://reactnative.dev/docs/layoutanimation)
- [Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)
- [Performance Guide](./PERFORMANCE.md)
