# Design Tokens - BOUNTYExpo

## Overview

This document defines the comprehensive design token system for BOUNTYExpo, ensuring consistent visual language, spacing, colors, and typography across all screens and components.

## Purpose

Design tokens provide a single source of truth for design decisions, enabling:
- **Consistency**: Unified visual language across the entire app
- **Maintainability**: Easy to update design system in one place
- **Scalability**: Clear patterns for adding new components
- **Accessibility**: Built-in contrast ratios and touch targets
- **Brand Alignment**: Cohesive emerald theme throughout

## Color System

### Emerald Brand Palette

The emerald color palette is the foundation of our brand identity:

| Token | Hex | Usage | Contrast (on dark) |
|-------|-----|-------|-------------------|
| emerald-50 | `#ecfdf5` | Lightest tints | - |
| emerald-100 | `#d1fae5` | Secondary text | >10:1 |
| emerald-200 | `#a7f3d0` | Muted text | >6:1 |
| emerald-300 | `#6ee7b7` | Accent text | 7.4:1 ✓ |
| emerald-400 | `#34d399` | Interactive elements | - |
| emerald-500 | `#10b981` | Primary actions | 3.1:1 |
| emerald-600 | `#059669` | **Main background** | 4.6:1 ✓ |
| emerald-700 | `#047857` | **Card backgrounds** | 6.4:1 ✓ |
| emerald-800 | `#065f46` | Surface elements | - |
| emerald-900 | `#064e3b` | Darkest emerald | - |
| emerald-950 | `#022c22` | Ultra dark overlays | - |

### Semantic Colors

Use semantic color names for clarity and consistency:

#### Background Colors
```typescript
BG_PRIMARY: '#059669'      // emerald-600 - Main app background
BG_SECONDARY: '#047857'    // emerald-700 - Card backgrounds
BG_SURFACE: '#065f46'      // emerald-800 - Surface elements
BG_OVERLAY: 'rgba(2, 44, 34, 0.55)' // emerald-950 with opacity
BG_DARK: '#022c22'         // emerald-950 - Ultra dark overlays
BG_CARD: 'rgba(4, 120, 87, 0.3)' // emerald-700 with opacity
```

#### Text Colors
```typescript
TEXT_PRIMARY: '#fffef5'    // Off-white - Main text (>15:1 contrast)
TEXT_SECONDARY: '#d1fae5'  // emerald-100 - Secondary text (>10:1 contrast)
TEXT_MUTED: '#a7f3d0'      // emerald-200 - Muted text (>6:1 contrast)
TEXT_ACCENT: '#6ee7b7'     // emerald-300 - Accent text (7.4:1 contrast)
TEXT_DISABLED: 'rgba(209, 250, 229, 0.5)' // emerald-100 at 50%
```

#### Border Colors
```typescript
BORDER_DEFAULT: '#047857'  // emerald-700
BORDER_LIGHT: '#6ee7b7'    // emerald-300
BORDER_DARK: '#022c22'     // emerald-950
BORDER_SUBTLE: 'rgba(110, 231, 183, 0.2)' // emerald-300 with opacity
```

#### Status Colors
```typescript
ERROR: '#dc2626'           // red-600 - Error states
ERROR_LIGHT: '#fca5a5'     // red-300 - Error highlights
WARNING: '#f59e0b'         // amber-500 - Warning states
WARNING_LIGHT: '#fcd34d'   // amber-300 - Warning highlights
SUCCESS: '#10b981'         // emerald-500 - Success states
SUCCESS_LIGHT: '#6ee7b7'   // emerald-300 - Success highlights
INFO: '#3b82f6'            // blue-500 - Info states
INFO_LIGHT: '#93c5fd'      // blue-300 - Info highlights
```

#### Interactive Colors
```typescript
INTERACTIVE_DEFAULT: '#10b981'  // emerald-500 - Default state
INTERACTIVE_HOVER: '#059669'    // emerald-600 - Hover state
INTERACTIVE_ACTIVE: '#047857'   // emerald-700 - Active/pressed state
INTERACTIVE_DISABLED: 'rgba(16, 185, 129, 0.4)' // emerald-500 at 40%
```

## Spacing System

Consistent spacing creates visual rhythm and hierarchy:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Minimal gaps, tight spacing |
| sm | 8px | Compact spacing between related elements |
| md | 12px | Standard element gaps |
| lg | 16px | Screen horizontal padding, card padding |
| xl | 24px | Section gaps, major spacing |
| 2xl | 32px | Large section separation |
| 3xl | 48px | Extra large spacing |
| 4xl | 64px | Maximum spacing |

### Common Usage Patterns

```typescript
// Screen-level spacing
SCREEN_HORIZONTAL: 16    // lg - Standard horizontal padding
SCREEN_VERTICAL: 24      // xl - Standard vertical spacing

// Element spacing
ELEMENT_GAP: 12          // md - Standard gap between related elements
SECTION_GAP: 24          // xl - Gap between major sections
COMPACT_GAP: 8           // sm - Compact spacing for tightly related items

// Component spacing
CARD_PADDING: 16         // lg - Standard padding inside cards
BUTTON_PADDING_HORIZONTAL: 24  // xl
BUTTON_PADDING_VERTICAL: 12    // md
```

## Border Radius

Establish clear radius scale for consistent component shapes:

| Token | Value | Usage |
|-------|-------|-------|
| NONE | 0 | No rounding |
| XS | 4px | Minimal rounding |
| SM | 8px | Small components |
| MD | 12px | Standard cards, buttons |
| LG | 16px | Large cards, modals |
| XL | 24px | Extra large surfaces |
| XXL | 32px | Special emphasis |
| FULL | 9999px | Pill shapes, circular |

## Typography

Consistent type scale with optimal line heights:

| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| TINY | 11px | 16px | Timestamps, captions |
| XSMALL | 12px | 18px | Metadata, labels |
| SMALL | 14px | 21px | Secondary text |
| DEFAULT | 15px | 22px | Body text |
| BODY | 16px | 24px | Primary body text |
| HEADER | 18px | 27px | Small headings |
| LARGE | 20px | 30px | Section headers |
| XLARGE | 24px | 36px | Page titles |

### Font Weights
- **Regular**: 400 - Body text
- **Medium**: 500 - Subtle emphasis
- **Semibold**: 600 - Subheadings
- **Bold**: 700 - Headings, emphasis

## Shadows & Elevation

Emerald-tinted shadows for consistent depth:

### Shadow Levels

```typescript
// No shadow
NONE: {
  shadowColor: 'transparent',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
}

// Small shadow - subtle depth
SM: {
  shadowColor: '#059669',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.15,
  shadowRadius: 2,
  elevation: 2,
}

// Medium shadow - standard cards
MD: {
  shadowColor: '#059669',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.2,
  shadowRadius: 6,
  elevation: 4,
}

// Large shadow - elevated components
LG: {
  shadowColor: '#059669',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.25,
  shadowRadius: 15,
  elevation: 8,
}

// Extra large shadow - modals, overlays
XL: {
  shadowColor: '#059669',
  shadowOffset: { width: 0, height: 20 },
  shadowOpacity: 0.3,
  shadowRadius: 25,
  elevation: 12,
}

// Glow effect - emphasis, focus states
GLOW: {
  shadowColor: '#059669',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.4,
  shadowRadius: 20,
  elevation: 6,
}
```

## Sizing

Standard sizes for consistent touch targets and UI elements:

### Touch Targets (WCAG 2.5.5 compliance)
```typescript
MIN_TOUCH_TARGET: 44         // Minimum 44x44 touch target
COMFORTABLE_TOUCH_TARGET: 48 // Comfortable for primary actions
```

### Button Heights
```typescript
BUTTON_HEIGHT_DEFAULT: 48    // Standard buttons
BUTTON_HEIGHT_COMPACT: 40    // Compact contexts
BUTTON_HEIGHT_LARGE: 56      // Emphasis/primary actions
```

### Icon Sizes
```typescript
ICON_SMALL: 16
ICON_MEDIUM: 20
ICON_LARGE: 24
ICON_XLARGE: 32
```

### Avatar Sizes
```typescript
AVATAR_SMALL: 32
AVATAR_MEDIUM: 48
AVATAR_LARGE: 80
AVATAR_XLARGE: 96
```

## Animation

Consistent timing for smooth interactions:

### Durations
```typescript
ANIMATION_FAST: 150ms      // Quick transitions
ANIMATION_NORMAL: 250ms    // Standard animations
ANIMATION_SLOW: 400ms      // Deliberate, emphasizing changes
```

### Easing
- **Ease Out**: Entering elements (spring-like)
- **Ease In**: Exiting elements
- **Ease In-Out**: State changes

## Usage Guidelines

### DO ✅

1. **Use semantic color names** instead of specific shades:
   ```typescript
   // Good
   backgroundColor: COLORS.BG_PRIMARY
   
   // Avoid
   backgroundColor: '#059669'
   ```

2. **Use spacing constants** instead of arbitrary values:
   ```typescript
   // Good
   padding: SPACING.CARD_PADDING
   gap: SPACING.ELEMENT_GAP
   
   // Avoid
   padding: 15
   gap: 10
   ```

3. **Use typography scale** for consistent text sizing:
   ```typescript
   // Good
   fontSize: TYPOGRAPHY.SIZE_BODY
   lineHeight: getLineHeight(TYPOGRAPHY.SIZE_BODY)
   
   // Avoid
   fontSize: 17
   lineHeight: 24
   ```

4. **Use border radius tokens** for consistent shapes:
   ```typescript
   // Good
   borderRadius: RADIUS.MD
   
   // Avoid
   borderRadius: 11
   ```

5. **Use shadow presets** for depth:
   ```typescript
   // Good
   ...SHADOWS.MD
   
   // Avoid
   shadowColor: '#000'
   shadowOpacity: 0.15
   ```

### DON'T ❌

1. Don't use hardcoded color values
2. Don't create arbitrary spacing values
3. Don't mix px and spacing tokens
4. Don't use inconsistent border radii
5. Don't create custom shadows without emerald tint

## Accessibility Considerations

All design tokens are optimized for accessibility:

1. **Color Contrast**: All text colors meet WCAG AA standards (4.5:1 for normal text, 3.0:1 for large text)
2. **Touch Targets**: Minimum 44x44px per WCAG 2.5.5
3. **Spacing**: Adequate whitespace for readability and tap accuracy
4. **Animation**: Respects user's reduced motion preferences
5. **Focus States**: Clear focus indicators using emerald accents

## Implementation

### In React Native Components

```typescript
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, SHADOWS } from 'lib/constants/accessibility';

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.BG_PRIMARY,
    padding: SPACING.CARD_PADDING,
    borderRadius: RADIUS.MD,
    ...SHADOWS.MD,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    fontWeight: '700',
    marginBottom: SPACING.ELEMENT_GAP,
  },
  button: {
    backgroundColor: COLORS.INTERACTIVE_DEFAULT,
    paddingHorizontal: SPACING.BUTTON_PADDING_HORIZONTAL,
    paddingVertical: SPACING.BUTTON_PADDING_VERTICAL,
    borderRadius: RADIUS.FULL,
  },
});
```

### In Tailwind Classes

```tsx
<View className="bg-background p-lg rounded-md shadow-emerald-md">
  <Text className="text-text-primary text-lg font-bold mb-md">
    Title
  </Text>
  <TouchableOpacity className="bg-emerald-500 px-xl py-md rounded-full">
    <Text className="text-text-primary">Button</Text>
  </TouchableOpacity>
</View>
```

## Maintenance

When updating design tokens:

1. Update `lib/constants/accessibility.ts`
2. Update `tailwind.config.js`
3. Update this documentation
4. Run visual regression tests
5. Update component library showcase

## Resources

- **Implementation**: `lib/constants/accessibility.ts`
- **Tailwind Config**: `tailwind.config.js`
- **Component Examples**: `examples/theme-showcase.tsx`
- **Animation Guide**: `ANIMATION_GUIDE.md`
- **Theme Documentation**: `THEME_IMPLEMENTATION_SUMMARY.md`

---

*Last Updated: 2025-11-15*
*Version: 2.0 - Comprehensive design token system*
