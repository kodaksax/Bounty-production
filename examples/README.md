# Theme System Examples

This directory contains example implementations demonstrating how to use the emerald theme system and animated components.

## Files

### theme-showcase.tsx

A comprehensive showcase of all theme components and their variants. Includes:

- **Themed Containers** - Using theme tokens in custom components
- **Button Variants** - All button styles with press animations
- **Animated Cards** - Basic, elevated, pressable, and expandable cards
- **Empty States** - Generic and bounty-specific empty states
- **Screen Transitions** - Fade, slide, and scale animations

## Running the Showcase

To view the theme showcase in your app:

```tsx
import ThemeShowcase from './examples/theme-showcase';

// In your app or navigation:
<ThemeShowcase />
```

## Quick Reference

### Import Components

```tsx
import { ThemeProvider } from 'components/theme-provider';
import { useAppTheme } from 'hooks/use-app-theme';
import { AnimatedCard } from 'components/ui/animated-card';
import { AnimatedScreen } from 'components/ui/animated-screen';
import { EmptyState, BountyEmptyState } from 'components/ui/empty-state';
import { Button } from 'components/ui/button';
```

### Use Theme Tokens

```tsx
function MyComponent() {
  const { colors, spacing, shadows } = useAppTheme();
  
  return (
    <View style={{
      backgroundColor: colors.background.surface,
      padding: spacing.lg,
      ...shadows.md
    }}>
      <Text style={{ color: colors.text.primary }}>
        Hello World
      </Text>
    </View>
  );
}
```

### Common Patterns

**Button with haptic feedback:**
```tsx
<Button onPress={() => handleAction()}>
  Submit
</Button>
```

**Interactive card:**
```tsx
<AnimatedCard 
  variant="elevated" 
  pressable 
  onPress={() => navigate('detail')}
>
  <Text>Card content</Text>
</AnimatedCard>
```

**Empty state:**
```tsx
{items.length === 0 && (
  <EmptyState
    icon="inbox"
    title="No items yet"
    description="Add your first item to get started"
    actionLabel="Add Item"
    onAction={() => setShowModal(true)}
  />
)}
```

## animation-showcase.tsx

A comprehensive showcase of all animation and micro-interaction features added to BOUNTYExpo. Includes:

- **Button Press Animations** - Scale to 0.95 with haptic feedback
- **Success Animations** - Checkmark and confetti celebrations
- **Skeleton Loaders** - Bounty cards with shimmer effects
- **Empty State Animations** - Bounce entrance with floating effect
- **Accessible Touchables** - Custom interactive components

### Running the Animation Showcase

To view the animation showcase:

```tsx
import AnimationShowcase from './examples/animation-showcase';

// Add to your app navigation
<AnimationShowcase />
```

### Testing Reduced Motion

**iOS:** Settings > Accessibility > Motion > "Reduce Motion"  
**Android:** Settings > Accessibility > "Remove animations"

All animations automatically adapt to simpler appearances when reduced motion is enabled.

### Animation Examples

**Success animation:**
```tsx
import { SuccessAnimation } from 'components/ui/success-animation';

const [showSuccess, setShowSuccess] = useState(false);

<SuccessAnimation 
  visible={showSuccess} 
  icon="check-circle"
  size={80}
  color="#10b981"
/>
```

**Skeleton loader:**
```tsx
import { SkeletonCard } from 'components/ui/skeleton-card';

{loading ? <SkeletonCard /> : <BountyCard data={bounty} />}
```

**Accessible touchable:**
```tsx
import { AccessibleTouchable } from 'components/ui/accessible-touchable';

<AccessibleTouchable 
  onPress={handlePress}
  haptic="light"
  scaleOnPress={0.95}
>
  <View style={styles.customButton}>
    <Text>Custom Button</Text>
  </View>
</AccessibleTouchable>
```

## See Also

- [ANIMATION_USAGE_GUIDE.md](../ANIMATION_USAGE_GUIDE.md) - Detailed usage instructions
- [ANIMATION_VISUAL_GUIDE.md](../ANIMATION_VISUAL_GUIDE.md) - Visual specifications
- [ANIMATION_GUIDE.md](../ANIMATION_GUIDE.md) - Complete documentation
- [lib/theme.ts](../lib/theme.ts) - Theme token definitions
- [components/theme-provider.tsx](../components/theme-provider.tsx) - Theme context
