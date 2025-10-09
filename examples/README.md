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

## See Also

- [ANIMATION_GUIDE.md](../ANIMATION_GUIDE.md) - Complete documentation
- [lib/theme.ts](../lib/theme.ts) - Theme token definitions
- [components/theme-provider.tsx](../components/theme-provider.tsx) - Theme context
