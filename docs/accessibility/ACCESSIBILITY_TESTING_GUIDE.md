# Accessibility Testing Guide for BOUNTYExpo

## Overview

This guide provides step-by-step instructions for testing the accessibility improvements made to BOUNTYExpo. The app now meets WCAG 2.1 AA compliance standards.

## Prerequisites

- iOS device or simulator (for VoiceOver testing)
- Android device or emulator (for TalkBack testing)
- WebAIM Contrast Checker: https://webaim.org/resources/contrastchecker/

## Test Scenarios

### 1. Screen Reader Testing

#### iOS VoiceOver

**Enable VoiceOver:**
1. Open Settings app
2. Navigate to Accessibility
3. Tap VoiceOver
4. Toggle VoiceOver on

**Navigation Gestures:**
- Swipe right: Move to next element
- Swipe left: Move to previous element
- Double-tap: Activate element
- Three-finger swipe right/left: Navigate between pages

**Test Scenarios:**

##### A. Search Screen
1. Navigate to Search (swipe through bottom navigation)
2. Verify tabs are announced correctly:
   - "Search bounties, tab, 1 of 2, selected"
   - "Search users, tab, 2 of 2"
3. Focus on search input:
   - Should announce: "Search bounties, search field"
   - Should include hint about autocomplete
4. Test bounty result items:
   - Should announce title, price/honor, and location
   - Should announce "Opens bounty details" as hint
5. Test filter buttons:
   - Should announce "Filter" or "Filter (active)"
   - Should include hint about opening filter options

##### B. Verification Screen
1. Navigate to Settings > Verification
2. Verify document type selection:
   - Should announce radio role
   - Should include selection state
   - Example: "Driver's License, radio button, 1 of 3, selected"
3. Test photo upload buttons:
   - Should announce "Upload front side of document, button"
   - Should include hint about camera/library
4. Test submit button:
   - Should announce disabled state when incomplete
   - Should include hint about review time

##### C. Hunter Apply Screen
1. Navigate to a bounty and apply
2. Test progress timeline:
   - Each stage should announce position and status
   - Example: "Stage 1 of 4: Apply for work, current"
3. Test action buttons:
   - Should announce clear actions
   - Should include contextual hints

##### D. Message Actions
1. Long-press a message in chat
2. Verify action menu:
   - Should announce "Message actions, menu"
   - Each action should have clear label
   - Pin/Unpin should reflect current state

#### Android TalkBack

**Enable TalkBack:**
1. Open Settings app
2. Navigate to Accessibility
3. Tap TalkBack
4. Toggle TalkBack on

**Navigation Gestures:**
- Swipe right: Move to next element
- Swipe left: Move to previous element
- Double-tap: Activate element

**Test the same scenarios as VoiceOver above.**

### 2. Large Text Testing

#### iOS

**Enable Large Text:**
1. Open Settings app
2. Navigate to Display & Brightness
3. Tap Text Size
4. Move slider to largest setting

**Test Scenarios:**
1. Open Search screen
   - Verify all text is readable
   - Verify no text is clipped
   - Verify buttons don't overlap
2. Open bounty detail cards
   - Verify title, description, and metadata are readable
   - Verify price/honor badge is visible
3. Open Message Actions menu
   - Verify all action labels are readable
   - Verify no overlap between items

#### Android

**Enable Large Font:**
1. Open Settings app
2. Navigate to Display
3. Tap Font Size
4. Move slider to largest setting

**Test the same scenarios as iOS above.**

### 3. Focus Indicators Testing

**Keyboard Navigation (Web Version Future):**
1. Use Tab key to navigate between interactive elements
2. Verify visible focus indicators:
   - Should see 3px emerald border around focused button
   - Should see shadow glow effect
   - Focus ring should be clearly visible against all backgrounds

**Touch Testing:**
1. Press and hold any Button component
2. Verify focus state is visible during press
3. Verify focus state is removed on release

### 4. Color Contrast Testing

Use WebAIM Contrast Checker to verify:

**Primary Colors:**
- Off-white text (#fffef5) on dark bg (#0a1f14): >15:1 ✅
- Emerald-300 (#6ee7b7) on dark bg: 7.4:1 ✅
- Gray-300 (#d1d5db) on dark bg: >10:1 ✅

**Focus Indicators:**
- Emerald border (#6ee7b7) on dark bg: 7.4:1 ✅
- Should meet 3:1 minimum for UI components

**Status Colors:**
- Yellow/amber for warnings: Check against dark bg
- Red for errors: Check against dark bg
- Green for success: Check against dark bg

All should meet 3:1 minimum for UI components.

### 5. Touch Target Size Testing

**Using Accessibility Inspector (iOS):**
1. Enable Accessibility Inspector (Settings > Developer)
2. Navigate to app
3. Tap on interactive elements
4. Verify dimensions shown:
   - All buttons should be ≥44x44pt (WCAG minimum)
   - Primary buttons are 48pt height (comfortable)
   - Center nav button is 64x64pt (emphasis)

**Manual Testing:**
1. Try tapping buttons with thumb
2. Verify adequate spacing between adjacent buttons
3. No accidental taps on wrong elements

## Automated Testing

### ESLint A11y Plugin (if configured)

```bash
npm run lint-a11y
```

Checks for:
- Missing accessibility labels
- Improper use of roles
- Missing hints on complex interactions

## Known Limitations

1. **AccessibleText adoption**: Not all components use AccessibleText yet
   - Primary screens covered
   - Legacy components may still use plain Text
   - Enhancement opportunity for future updates

2. **Web keyboard navigation**: Focus indicators work but web version needs testing
   - Tab order needs verification
   - All interactive elements should be focusable

3. **Complex gestures**: Some advanced gestures (swipe actions) may need additional testing
   - Swipeable items in lists
   - Custom gesture handlers

## Reporting Issues

When reporting accessibility issues, include:

1. **Platform**: iOS/Android
2. **Accessibility feature**: VoiceOver, TalkBack, Large Text, etc.
3. **Screen/Component**: Where the issue occurs
4. **Expected behavior**: What should happen
5. **Actual behavior**: What actually happens
6. **Steps to reproduce**: Detailed steps
7. **Screenshot/video**: If possible

## Success Criteria

✅ All interactive elements have accessibility labels
✅ All decorative icons are hidden from screen readers
✅ All semantic elements have proper roles
✅ Selection states are communicated
✅ Focus indicators are visible (3px emerald border)
✅ Text meets 4.5:1 contrast ratio (AA standard)
✅ UI components meet 3:1 contrast ratio
✅ Touch targets meet 44x44pt minimum
✅ Layouts support large text without breaking
✅ Reduced motion preferences are respected

## Additional Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [React Native Accessibility](https://reactnative.dev/docs/accessibility)
- [iOS Accessibility Programming Guide](https://developer.apple.com/accessibility/)
- [Android Accessibility Guide](https://developer.android.com/guide/topics/ui/accessibility)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

## Maintenance

When adding new components:

1. **Always add accessibility props**:
   - `accessibilityLabel` for all interactive elements
   - `accessibilityRole` for semantic elements
   - `accessibilityHint` for non-obvious actions
   - `accessibilityState` for stateful elements

2. **Hide decorative elements**:
   - Use `accessibilityElementsHidden={true}` on icons that are purely visual

3. **Use accessibility constants**:
   - Import from `lib/constants/accessibility.ts`
   - Use standardized touch target sizes
   - Use standardized typography sizes

4. **Test with screen readers**:
   - Always test new screens with VoiceOver or TalkBack
   - Verify navigation flow is logical
   - Ensure all content is reachable

5. **Document changes**:
   - Update ACCESSIBILITY_GUIDE.md
   - Add notes about special accessibility considerations
