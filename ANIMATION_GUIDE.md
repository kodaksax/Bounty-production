# Animation Guide

This guide explains how to use the animation and theming system in BountyExpo. All components follow a consistent emerald color palette with smooth micro-interactions.

## Overview

The animation system provides:
- Consistent emerald theme tokens (emerald-600/700/800)
- Pre-built animated components for common patterns
- Smooth transitions with haptic feedback
- Accessibility considerations (reduced motion support)

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

Card component with press feedback and optional expansion.

```tsx
import { AnimatedCard } from 'components/ui/animated-card';

// Basic card with press feedback
<AnimatedCard variant="elevated" pressable onPress={() => navigate('detail')}>
  <Text>Card content</Text>
</AnimatedCard>

// Expandable card
<AnimatedCard 
  expandable 
  expanded={isExpanded}
  onToggle={() => setIsExpanded(!isExpanded)}
>
  <Text>Expandable content</Text>
</AnimatedCard>
```

**Props:**
- `variant?: 'default' | 'elevated'` - Visual style (default has subtle shadow, elevated has emerald glow)
- `pressable?: boolean` - Enable press animations
- `expandable?: boolean` - Enable expand/collapse functionality
- `expanded?: boolean` - Controlled expansion state
- `onToggle?: () => void` - Callback when toggled
- `onPress?: () => void` - Press callback (when not expandable)

**Features:**
- Spring animations on press (scales to 0.97)
- Elevation changes with interaction
- Emerald glow on elevated variant
- Smooth LayoutAnimation for expansion

### 3. Enhanced Button

All buttons now have press animations, haptic feedback, and emerald theming.

```tsx
import { Button } from 'components/ui/button';

// Primary button (emerald background)
<Button onPress={handleSubmit}>Submit</Button>

// Outline button (emerald border)
<Button variant="outline" onPress={handleCancel}>Cancel</Button>

// Destructive button (red for dangerous actions)
<Button variant="destructive" onPress={handleDelete}>Delete</Button>
```

**Variants:**
- `default` - Emerald background with white text
- `outline` - Transparent with emerald border
- `secondary` - Secondary emerald tone
- `ghost` - Transparent with emerald text
- `destructive` - Red background for dangerous actions

**Features:**
- Scale animation on press (springs to 0.95)
- Haptic feedback on press
- Emerald color scheme throughout
- Proper disabled states
- Accessibility support

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

### Haptic Feedback

Use appropriate haptic feedback for different interactions:

```tsx
import { useHapticFeedback } from 'lib/haptic-feedback';

const { triggerHaptic } = useHapticFeedback();

// Light tap for button presses
triggerHaptic('light');

// Medium for selections
triggerHaptic('medium');

// Heavy for important actions
triggerHaptic('heavy');

// Success/warning/error for notifications
triggerHaptic('success');
triggerHaptic('warning');
triggerHaptic('error');
```

### Accessibility

Support reduced motion preferences:

```tsx
import { useReducedMotion } from 'lib/accessibility-utils';

const { prefersReducedMotion, getAnimationConfig } = useReducedMotion();

// Animation config respects user preference
Animated.timing(value, {
  toValue: 1,
  ...getAnimationConfig(300), // Duration becomes 0 if reduced motion enabled
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

### Updating Existing Components

1. **Replace hardcoded colors:**
```tsx
// Before
backgroundColor: '#10b981'

// After
import { theme } from 'lib/theme';
backgroundColor: theme.colors.primary[500]
```

2. **Add press animations to interactive elements:**
```tsx
// Before
<TouchableOpacity onPress={handlePress}>
  <View style={styles.card}>
    {content}
  </View>
</TouchableOpacity>

// After
<AnimatedCard pressable onPress={handlePress}>
  {content}
</AnimatedCard>
```

3. **Update empty states:**
```tsx
// Before
{items.length === 0 && <Text>No items</Text>}

// After
{items.length === 0 && (
  <EmptyState
    icon="inbox"
    title="No items yet"
    description="Add your first item to get started"
    actionLabel="Add Item"
    onAction={handleAddItem}
  />
)}
```

## Component Index

- **AnimatedScreen** - Screen transition animations
- **AnimatedCard** - Interactive cards with press feedback
- **Button** - Enhanced buttons with emerald theme
- **EmptyState** - Animated empty states with helpful messaging
- **ThemeProvider** - Context provider for design tokens
- **useAppTheme** - Hook for accessing theme tokens
- **useHapticFeedback** - Hook for haptic feedback
- **useReducedMotion** - Hook for accessibility support

## Design Tokens Reference

### Colors
- `colors.primary[500-900]` - Emerald palette
- `colors.background.*` - Background colors
- `colors.text.*` - Text colors
- `colors.border.*` - Border colors

### Spacing
- `spacing.xs` through `spacing.4xl` - 4px to 64px

### Shadows
- `shadows.sm` through `shadows.xl` - Elevation levels
- `shadows.emerald` - Emerald glow effect

### Typography
- `typography.fontSize.*` - Font sizes
- `typography.fontWeight.*` - Font weights

### Animations
- `animations.duration.*` - Standard durations
- `animations.easing.*` - Easing functions
