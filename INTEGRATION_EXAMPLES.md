# Integration Examples

This document shows how to integrate the new emerald theme components into existing screens.

## Quick Start

The theme system is already integrated via `ThemeProvider` in `app/_layout.tsx`. All screens automatically have access to the theme.

## Integration Patterns

### 1. Adding Themed Empty States

**Before:**
```tsx
{bounties.length === 0 && (
  <View style={{ padding: 20 }}>
    <Text>No bounties found</Text>
  </View>
)}
```

**After:**
```tsx
import { BountyEmptyState } from 'components/ui/empty-state';

{bounties.length === 0 && (
  <BountyEmptyState 
    filter={currentFilter}
    onClearFilter={() => setFilter('all')}
  />
)}
```

### 2. Upgrading Buttons with Press Animations

**Before:**
```tsx
<TouchableOpacity 
  onPress={handleSubmit}
  style={{ backgroundColor: '#10b981', padding: 12, borderRadius: 6 }}
>
  <Text style={{ color: 'white' }}>Submit</Text>
</TouchableOpacity>
```

**After:**
```tsx
import { Button } from 'components/ui/button';

<Button onPress={handleSubmit}>
  Submit
</Button>
```

The Button component now includes:
- ✓ Press animations (scales to 0.95)
- ✓ Haptic feedback
- ✓ Emerald color scheme
- ✓ Proper disabled states
- ✓ Accessibility support

### 3. Converting Cards to Interactive Cards

**Before:**
```tsx
<TouchableOpacity onPress={() => navigate('detail')}>
  <View style={{ 
    backgroundColor: '#2d5240', 
    padding: 16, 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00912C40'
  }}>
    {content}
  </View>
</TouchableOpacity>
```

**After:**
```tsx
import { AnimatedCard } from 'components/ui/animated-card';

<AnimatedCard 
  variant="elevated" 
  pressable 
  onPress={() => navigate('detail')}
>
  {content}
</AnimatedCard>
```

Benefits:
- ✓ Spring animations on press
- ✓ Emerald glow effect on elevated variant
- ✓ Consistent theming
- ✓ Optional expansion functionality

### 4. Using Theme Tokens in Custom Styles

**Before:**
```tsx
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2d5240',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.2)',
  },
  text: {
    color: '#fffef5',
    fontSize: 16,
  }
});
```

**After:**
```tsx
import { useAppTheme } from 'hooks/use-app-theme';

function MyComponent() {
  const { colors, spacing, borderRadius } = useAppTheme();
  
  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.background.surface,
      padding: spacing.lg,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border.muted,
    },
    text: {
      color: colors.text.primary,
      fontSize: 16,
    }
  });
  
  return <View style={styles.container}>...</View>;
}
```

### 5. Adding Screen Transitions

**Before:**
```tsx
export function MyScreen() {
  return (
    <View>
      {content}
    </View>
  );
}
```

**After:**
```tsx
import { AnimatedScreen } from 'components/ui/animated-screen';

export function MyScreen() {
  return (
    <AnimatedScreen animationType="fade" duration={300}>
      <View>
        {content}
      </View>
    </AnimatedScreen>
  );
}
```

## Specific Screen Updates

### PostingsScreen

Current implementation can be enhanced:

```tsx
// In the "New" tab, replace button with themed Button:
import { Button } from 'components/ui/button';

// Replace existing buttons:
<Button 
  onPress={handlePostBounty}
  disabled={isSubmitting || !isFormValid}
>
  {isSubmitting ? 'Posting...' : 'Post Bounty'}
</Button>

// Add empty state for when there are no bounties:
{myBounties.length === 0 && (
  <BountyEmptyState 
    filter="all"
    onClearFilter={undefined}
  />
)}
```

### CreateBountyFlow

Can add screen transitions:

```tsx
import { AnimatedScreen } from 'components/ui/animated-screen';

export function CreateBountyFlow() {
  return (
    <AnimatedScreen animationType="slide" duration={300}>
      {/* existing content */}
    </AnimatedScreen>
  );
}
```

### Profile Screens

Replace static cards with interactive ones:

```tsx
import { AnimatedCard } from 'components/ui/animated-card';

// For portfolio items:
<AnimatedCard 
  variant="elevated"
  pressable
  onPress={() => viewPortfolioItem(item.id)}
  style={{ marginBottom: 16 }}
>
  <PortfolioItemContent item={item} />
</AnimatedCard>
```

## Color Reference

Always use theme tokens instead of hardcoded colors:

| Old Color | Theme Token | Usage |
|-----------|-------------|-------|
| `#00912C` | `colors.primary[500]` | Primary actions, brand color |
| `#007423` | `colors.primary[600]` | Darker emerald (shadows/glows) |
| `#00571a` | `colors.primary[700]` | Even darker emerald |
| `#1a3d2e` | `colors.background.primary` | Main background |
| `rgba(45, 82, 64, 0.75)` | `colors.background.surface` | Card backgrounds |
| `#fffef5` | `colors.text.primary` | Main text |
| `rgba(255, 254, 245, 0.8)` | `colors.text.secondary` | Secondary text |
| `rgba(0, 145, 44, 0.4)` | `colors.border.primary` | Borders |

## Testing Integration

After integrating components, verify:

1. **Visual Consistency** - All emerald colors match the theme
2. **Animations** - Press feedback works smoothly
3. **Haptics** - Button presses provide tactile feedback (on device)
4. **Accessibility** - Screen readers announce content correctly
5. **Performance** - No jank or dropped frames

## Migration Checklist

For each screen you update:

- [ ] Replace hardcoded emerald colors with theme tokens
- [ ] Update `TouchableOpacity` buttons to use `Button` component
- [ ] Add empty states where data might be missing
- [ ] Convert static cards to `AnimatedCard` where appropriate
- [ ] Add screen transitions for major navigation
- [ ] Test on device for haptic feedback
- [ ] Verify accessibility with VoiceOver/TalkBack

## See Also

- [ANIMATION_GUIDE.md](./ANIMATION_GUIDE.md) - Complete component documentation
- [examples/theme-showcase.tsx](./examples/theme-showcase.tsx) - Live examples
- [lib/theme.ts](./lib/theme.ts) - Theme token definitions
