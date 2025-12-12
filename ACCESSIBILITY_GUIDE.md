# Accessibility Guide for BOUNTYExpo

## Overview

This guide documents the accessibility features and standards implemented across the BOUNTYExpo app to ensure an inclusive and usable experience for all users, including those with disabilities.

## Design System Constants

All accessibility-related constants are centralized in `lib/constants/accessibility.ts`. This includes:

### Spacing Standards
- **Screen padding**: 16px horizontal (consistent across all screens)
- **Section spacing**: 24px vertical (major sections)
- **Element spacing**: 12px (related elements)
- **Compact spacing**: 8px (tightly related items)

### Touch Targets
- **Minimum size**: 44x44pt (WCAG 2.5.5 compliance)
- **Comfortable size**: 48x48pt (primary actions)
- All interactive elements meet or exceed these minimums

### Typography
- **Font sizes**: Range from 11px (tiny) to 24px (xlarge)
- **Line heights**: 1.2 (tight), 1.5 (normal), 1.7 (relaxed)
- **Dynamic scaling**: Support for system text size settings via `AccessibleText` component

### Color Contrast
All colors meet WCAG AA standards:
- **Text on dark backgrounds**: >4.5:1 contrast ratio
- **Large text (18pt+)**: >3:1 contrast ratio
- **UI components**: >3:1 contrast ratio

Examples:
- `#fffef5` (off-white) on dark: >15:1 ✓
- `#6ee7b7` (emerald-300) on dark: 7.4:1 ✓
- `#d1d5db` (gray-300) on dark: >10:1 ✓

### Animation Durations
- **Fast**: 150ms (micro-interactions)
- **Normal**: 250ms (standard transitions)
- **Slow**: 400ms (entrance animations)

## Accessibility Features by Screen

### Dashboard (bounty-app.tsx)
✅ Header icon/title consistent spacing (8px gap)
✅ Balance button with 44x44 minimum touch target
✅ Search bar with proper role and label
✅ Filter chips with:
  - `accessibilityRole="button"`
  - `accessibilityLabel` describing filter
  - `accessibilityState={{ selected }}` for active state
  - `accessibilityHint` for action context
✅ Category buttons support keyboard navigation states

### Wallet Screen (wallet-screen.tsx)
✅ Consistent header layout matching dashboard
✅ Add Money and Withdraw buttons with descriptive labels
✅ Payment method management with clear hints
✅ All touch targets meet 44pt minimum
✅ Standardized spacing using constants

### Postings Screen (postings-screen.tsx)
✅ Tab navigation with `accessibilityRole="tab"`
✅ Work type filters with selection states
✅ Bookmark button with clear purpose
✅ Balance display accessible
✅ Header alignment consistent with other screens

### Profile Screen (profile-screen.tsx)
✅ Share profile button with hint
✅ Settings button with clear navigation hint
✅ Header follows app-wide pattern
✅ Icon elements hidden from screen readers

### Bottom Navigation (bottom-nav.tsx)
✅ Each nav item has:
  - `accessibilityRole="button"`
  - Descriptive `accessibilityLabel`
  - `accessibilityState={{ selected }}`
  - Clear navigation hint
✅ Center button (bounty) clearly marked as main screen
✅ Haptic feedback for better tactile response
✅ Smooth animations with standardized durations
✅ All buttons exceed 44pt minimum touch target

### Bounty List Items (bounty-list-item.tsx)
✅ Comprehensive accessibility label including:
  - Bounty title
  - Poster username
  - Price or "for honor" status
  - Location/distance information
✅ `accessibilityRole="button"`
✅ Clear hint about viewing details
✅ Icons hidden from screen readers (decorative)
✅ Standardized spacing and line heights

### Empty States (empty-state.tsx)
✅ Container accessible with combined title + description
✅ Title has `accessibilityRole="header"`
✅ Action button with descriptive label and hint
✅ Icon decorative (hidden from screen readers)
✅ Smooth entrance animations with standard durations

## Components

### AccessibleText Component

A custom Text component that supports dynamic font scaling:

```tsx
import { AccessibleText, HeaderText, BodyText } from 'components/ui/accessible-text';

// Basic usage with predefined size
<AccessibleText size="body">My text</AccessibleText>

// Using preset components
<HeaderText>Section Title</HeaderText>
<BodyText>Paragraph content</BodyText>

// Custom max scale multiplier
<AccessibleText 
  size="small" 
  maxFontSizeMultiplier={1.3}
>
  Small text
</AccessibleText>
```

Features:
- Respects system text size settings
- Automatic line height calculation
- Maximum scale to prevent layout breaking
- Preset size variants

### Button Component

Comprehensive accessibility features:
- `accessibilityRole="button"`
- Auto-derives label from text children
- Supports custom `accessibilityLabel` and `accessibilityHint`
- Includes `accessibilityState={{ disabled }}`
- Haptic feedback on press
- Animated press states
- Meets 48pt minimum height
- **Focus indicators** (WCAG 2.4.7):
  - Visible 3px emerald border on focus
  - Shadow glow effect for enhanced visibility
  - Works with keyboard navigation and touch interactions

## Best Practices

### 1. Always Add Accessibility Props

```tsx
// ✅ Good
<TouchableOpacity
  onPress={handlePress}
  accessibilityRole="button"
  accessibilityLabel="Add to favorites"
  accessibilityHint="Double tap to add this bounty to your favorites"
  accessibilityState={{ selected: isFavorite }}
>
  <MaterialIcons name="favorite" />
</TouchableOpacity>

// ❌ Bad
<TouchableOpacity onPress={handlePress}>
  <MaterialIcons name="favorite" />
</TouchableOpacity>
```

### 2. Hide Decorative Icons

```tsx
// ✅ Good - icon is decorative, button has text
<TouchableOpacity accessibilityLabel="Search bounties">
  <MaterialIcons 
    name="search" 
    accessibilityElementsHidden={true} 
  />
  <Text>Search</Text>
</TouchableOpacity>

// ✅ Good - icon is functional, descriptive label provided
<TouchableOpacity accessibilityLabel="Search bounties">
  <MaterialIcons 
    name="search" 
    accessibilityElementsHidden={true} 
  />
</TouchableOpacity>
```

### 3. Use Standardized Constants

```tsx
import { SPACING, SIZING, TYPOGRAPHY } from 'lib/constants/accessibility';

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    gap: SPACING.ELEMENT_GAP,
  },
  button: {
    minHeight: SIZING.MIN_TOUCH_TARGET,
    minWidth: SIZING.MIN_TOUCH_TARGET,
  },
  title: {
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_LARGE * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
});
```

### 4. Provide Context with Hints

```tsx
// ✅ Good - context helps understanding
<TouchableOpacity
  accessibilityLabel="Delete bounty"
  accessibilityHint="This action cannot be undone"
>
  <MaterialIcons name="delete" />
</TouchableOpacity>

// ⚠️ Okay - functional but less helpful
<TouchableOpacity accessibilityLabel="Delete">
  <MaterialIcons name="delete" />
</TouchableOpacity>
```

### 5. Indicate Selection States

```tsx
// ✅ Good - with selection state
<TouchableOpacity
  accessibilityLabel="Online work filter"
  accessibilityState={{ selected: isSelected }}
  accessibilityHint={isSelected ? "Currently active" : "Tap to activate"}
>
  <Text>Online</Text>
</TouchableOpacity>

// ✅ Good - radio button selection
<TouchableOpacity
  accessibilityRole="radio"
  accessibilityLabel="Driver's License"
  accessibilityState={{ selected: selectedDocType === 'driversLicense' }}
  accessibilityHint="Select this document type for verification"
>
  <Text>Driver's License</Text>
</TouchableOpacity>
```

### 6. Use Semantic Roles

Available roles:
- `button` - Interactive buttons
- `header` - Section headers
- `link` - Navigation links
- `search` - Search inputs
- `tab` - Tab navigation items
- `menu` - Menu containers
- `menuitem` - Menu items

### 7. Group Related Content

```tsx
// ✅ Good - grouped container with combined label
<View
  accessible={true}
  accessibilityLabel={`${title}. ${description}`}
  accessibilityRole="text"
>
  <Text accessibilityRole="header">{title}</Text>
  <Text>{description}</Text>
</View>
```

## Testing Accessibility

### Manual Testing
1. **Screen Reader**: Enable VoiceOver (iOS) or TalkBack (Android)
   - Navigate through each screen
   - Verify all interactive elements are reachable
   - Confirm labels are descriptive and contextual

2. **Large Text**: Enable largest system text size
   - Check for text clipping
   - Verify layouts adapt gracefully
   - Ensure important content remains visible

3. **Touch Targets**: Use accessibility inspector
   - Verify all buttons are at least 44x44pt
   - Check that adjacent buttons have adequate spacing

4. **Color Contrast**: Use contrast checker tools
   - Verify text meets 4.5:1 ratio (or 3:1 for large text)
   - Check UI component contrast (3:1 minimum)

### Automated Testing
```bash
# Run accessibility audit (if available)
npm run a11y-audit

# Check for missing accessibility props
npm run lint-a11y
```

## Common Issues and Solutions

### Issue: Text Too Small
**Solution**: Use `AccessibleText` component with appropriate size, or set `fontSize` with `allowFontScaling={true}`

### Issue: Touch Target Too Small
**Solution**: Add `minWidth` and `minHeight` using `SIZING.MIN_TOUCH_TARGET`

### Issue: Missing Labels
**Solution**: Always provide `accessibilityLabel` for TouchableOpacity/buttons

### Issue: Icons Without Context
**Solution**: Either hide decorative icons with `accessibilityElementsHidden={true}` or provide descriptive labels

### Issue: Unclear Button Purpose
**Solution**: Add `accessibilityHint` to explain what will happen

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [React Native Accessibility](https://reactnative.dev/docs/accessibility)
- [iOS Accessibility](https://developer.apple.com/accessibility/)
- [Android Accessibility](https://developer.android.com/guide/topics/ui/accessibility)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

## Changelog

### 2024-12 (Current Release - Phase 2)
- **Button Component**: Added visible focus indicators for keyboard navigation (WCAG 2.4.7)
  - 3px emerald border with high contrast
  - Shadow glow effect for visibility
  - Elevated appearance on focus
- **Verification Screen**: Comprehensive accessibility labels and hints for all interactive elements
  - Document type selection with radio roles and states
  - Photo upload buttons with clear context
  - Submit button with disabled state
- **Search Screen**: Enhanced with semantic labels and context
  - Bounty and user result cards with comprehensive descriptions
  - Tab navigation with proper roles and selection states
  - Search input with autocomplete hints
  - Filter controls with active state indicators
- **Hunter Flow**: Added accessibility to application tracking
  - Progress timeline with stage status announcements
  - Bounty card with combined label for context
  - Action buttons with clear hints
- **Message Actions**: Modal actions properly labeled
  - Pin/unpin with state-aware labels
  - Copy, report, block with clear purposes
  - Menu role for action sheet container

### 2024-12 (Initial Release)
- Created centralized accessibility constants
- Standardized spacing across all screens
- Added comprehensive accessibility labels to navigation
- Implemented minimum touch target sizes
- Created AccessibleText component for dynamic scaling
- Documented color contrast ratios
- Added animation duration standards
- Improved empty state accessibility
- Enhanced bottom navigation with clear roles and states

## Maintaining Accessibility

When adding new components:
1. Import and use constants from `lib/constants/accessibility.ts`
2. Add appropriate `accessibilityLabel`, `accessibilityRole`, and `accessibilityHint`
3. Ensure touch targets meet 44x44pt minimum
4. Hide decorative icons from screen readers
5. Test with VoiceOver/TalkBack enabled
6. Verify color contrast meets AA standards
7. Support dynamic text scaling

When reviewing PRs:
- Check for accessibility props on interactive elements
- Verify touch target sizes
- Test with screen reader if possible
- Ensure consistent spacing using constants
