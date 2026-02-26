# BountyExpo UI Enhancement Plan

## Overview

This document provides a comprehensive, structured plan to systematically update and enhance all aspects of the BountyExpo user interface. It defines specific goals for usability, aesthetic improvements, and cross-device responsiveness, and proposes a phased implementation approach that is consistent with the existing codebase patterns.

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Enhancement Goals](#2-enhancement-goals)
3. [Design System Enhancements](#3-design-system-enhancements)
4. [Layout & Responsiveness](#4-layout--responsiveness)
5. [Visual Styling Improvements](#5-visual-styling-improvements)
6. [Usability Improvements](#6-usability-improvements)
7. [Accessibility Enhancements](#7-accessibility-enhancements)
8. [Performance Optimization](#8-performance-optimization)
9. [Phased Implementation Roadmap](#9-phased-implementation-roadmap)
10. [Component-Level Guidelines](#10-component-level-guidelines)
11. [Testing & Validation Strategy](#11-testing--validation-strategy)
12. [Design Tokens Reference](#12-design-tokens-reference)

---

## 1. Current State Audit

### 1.1 Strengths

The current UI has a solid foundation with several well-implemented patterns:

| Area | Status | Notes |
|------|--------|-------|
| **Theme System** | ✅ Strong | `lib/theme.ts` defines a complete emerald design system with color palette, spacing, typography, shadows, and glass-morphism tokens |
| **Accessibility Constants** | ✅ Strong | `lib/constants/accessibility.ts` centralizes WCAG-compliant spacing, sizing, typography, and color constants |
| **Button Component** | ✅ Strong | Spring animations, haptic feedback, focus indicators, disabled states, and multiple variants |
| **Skeleton Loaders** | ✅ Strong | Consistent skeleton patterns for loading states across all major screens |
| **Empty States** | ✅ Strong | Animated, accessible empty state component with context-aware messaging |
| **Animations** | ✅ Strong | `AnimatedScreen`, `AnimatedSection`, `AnimatedCard` components with configurable transitions |
| **Bottom Navigation** | ✅ Strong | Accessible with proper roles, haptic feedback, and selection states |
| **Image Handling** | ✅ Good | `OptimizedImage` component with CDN-aware thumbnailing and priority loading |
| **FlatList Optimization** | ✅ Good | `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize` props applied to key lists |

### 1.2 Areas for Improvement

| Area | Priority | Description |
|------|----------|-------------|
| **Screen Layout Consistency** | High | Header patterns vary across screens; some use hardcoded offsets (`headerTopPad = Math.max(insets.top - 50, 0)`) instead of standardized layout components |
| **Dark Mode Support** | High | Theme system defines tokens but lacks a complete dark/light mode toggle implementation |
| **PostingsScreen List Rendering** | High | Uses `.map()` for lists instead of `FlatList`, causing performance issues with many items |
| **Tailwind Config** | Medium | `tailwind.config.js` extends nothing; custom emerald tokens from `lib/theme.ts` are not registered as Tailwind utilities |
| **Responsive Spacing** | Medium | Some screens use hardcoded pixel values instead of spacing constants from `lib/constants/accessibility.ts` |
| **Form UX** | Medium | Validation error presentation and field focus transitions are inconsistent across forms |
| **Modal & Sheet Patterns** | Medium | Multiple modal component types (`dialog.tsx`, `sheet.tsx`, `drawer.tsx`) with overlapping use cases and no unified pattern guide |
| **Typography Scale** | Medium | Font sizes mix `lib/theme.ts` tokens and `lib/constants/accessibility.ts` constants; one authoritative source is needed |
| **Color Contrast in Status Badges** | Low | Some status badge color combinations have not been audited against WCAG AA for small text |
| **Reduced Motion Support** | Low | `useReducedMotion` is not consistently applied across all animated components |

---

## 2. Enhancement Goals

### 2.1 Usability Goals

- **G-U1**: All primary actions reachable with one thumb at the bottom of any screen.
- **G-U2**: No more than 3 taps to reach any feature from the home screen.
- **G-U3**: Every loading, error, and empty state is handled with clear messaging and a recovery action.
- **G-U4**: Form validation errors appear inline, adjacent to the offending field, within 300ms of leaving the field.
- **G-U5**: All destructive actions (delete, cancel, archive) require explicit confirmation with a clearly labelled dialog.
- **G-U6**: Offline state is communicated clearly with a dismissible banner; queued actions show a pending indicator.

### 2.2 Aesthetic Goals

- **G-A1**: The emerald brand palette (`#00912C` primary) is applied consistently across all interactive elements with no off-brand accent colors.
- **G-A2**: Every elevation level (flat → card → modal → overlay) uses the corresponding shadow preset from `lib/theme.ts`.
- **G-A3**: Glass-morphism is applied only to elevated/floating surfaces (modals, bottom sheets, tooltips), not to flat list items.
- **G-A4**: Typography uses a maximum of three weights (400, 600, 700) per screen to maintain hierarchy without visual noise.
- **G-A5**: Icons are consistently sized (16 / 20 / 24 / 32 px from `SIZING` constants) and sourced exclusively from the `@expo/vector-icons` `MaterialIcons` set.

### 2.3 Responsiveness Goals

- **G-R1**: All screens adapt correctly to safe-area insets on both iOS (notch/Dynamic Island) and Android (punch-hole / status bar).
- **G-R2**: Content does not overlap the bottom navigation bar; all screens apply sufficient `paddingBottom` to clear the 60 px nav height.
- **G-R3**: Text does not overflow card boundaries when the system font size is set to the largest accessibility level (5× scale).
- **G-R4**: Layout is tested and functional on screen widths from 360 px (budget Android) to 430 px (iPhone Pro Max).
- **G-R5**: Image aspect ratios are preserved across all device sizes using the `OptimizedImage` component's fixed-width/height props.

### 2.4 Accessibility Goals (extending existing WCAG AA compliance)

- **G-AC1**: All screens pass a VoiceOver / TalkBack navigation audit with no unreachable interactive elements.
- **G-AC2**: Color is never the sole indicator of state; every status badge, pill, and indicator also carries a text label or icon.
- **G-AC3**: `useReducedMotion` is respected in all animated components; animation durations are set to 0 when the user has requested reduced motion.
- **G-AC4**: Every focusable element has a visible focus ring that meets WCAG 2.4.7 (non-text contrast ≥ 3:1).
- **G-AC5**: Dynamic text scaling is supported on every screen without content clipping or layout breakage.

### 2.5 Performance Goals

- **G-P1**: Main thread JS execution for any list scroll event is under 16 ms (targeting 60 fps).
- **G-P2**: Time to interactive for the dashboard screen is under 2 seconds on a mid-range device.
- **G-P3**: Inline render functions (`renderItem`, `keyExtractor`, callbacks) are eliminated from all `FlatList` usages.
- **G-P4**: Images in list rows use `OptimizedImage` with `useThumbnail={true}` and explicit width/height.
- **G-P5**: All heavy computations in render paths (sorting, filtering, formatting) are wrapped in `useMemo`.

---

## 3. Design System Enhancements

### 3.1 Unify Theme Tokens

**Problem**: Design tokens are split between `lib/theme.ts` and `lib/constants/accessibility.ts`, creating two sources of truth for font sizes, spacing, and colors.

**Solution**: Merge into a single canonical source, then export named groups.

```typescript
// lib/design-tokens.ts  (new file – single source of truth)
export { colors, spacing, borderRadius, typography, shadows, glassMorphism, animations } from './theme';
export { SPACING, SIZING, TYPOGRAPHY, COLORS, RADIUS, A11Y, HEADER_LAYOUT } from './constants/accessibility';
```

Both existing files remain unchanged for backward compatibility; the new barrel file is the recommended import for all new code.

### 3.2 Register Tailwind Custom Tokens

**Problem**: `tailwind.config.js` extends nothing, so NativeWind classes like `bg-primary-500` or `text-emerald-600` are not available.

**Solution**: Extend the Tailwind theme with brand tokens.

```javascript
// tailwind.config.js
const { colors } = require('./lib/theme');

module.exports = {
  content: [
    "app/index.js",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  colors.primary[50],
          100: colors.primary[100],
          200: colors.primary[200],
          300: colors.primary[300],
          400: colors.primary[400],
          500: colors.primary[500],
          600: colors.primary[600],
          700: colors.primary[700],
          800: colors.primary[800],
          900: colors.primary[900],
        },
        surface: colors.background.surface,
        elevated: colors.background.elevated,
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
}
```

### 3.3 Reduced Motion Support

The codebase already provides `hooks/use-accessible-animation.ts`, which exposes `useAccessibleAnimation()` and specialized variants (`usePressAnimation`, `useFadeAnimation`, `useSlideAnimation`, `useFadeSlideAnimation`). All animated components must use this hook instead of calling `Animated.timing` / `Animated.spring` directly.

**Key exports from `hooks/use-accessible-animation.ts`**:

```typescript
const {
  prefersReducedMotion,  // boolean — true when user has reduced motion enabled
  getAnimationDuration,  // (ms: number) => 0 | ms
  createTiming,          // wraps Animated.timing; returns instant anim if reduced motion
  createSpring,          // wraps Animated.spring; falls back to instant if reduced motion
} = useAccessibleAnimation();
```

**Usage in animated components**:
```tsx
// components/ui/animated-card.tsx
import { useAccessibleAnimation } from 'hooks/use-accessible-animation';
import { A11Y } from 'lib/constants/accessibility';

const { createSpring, getAnimationDuration } = useAccessibleAnimation();

// Press animation — automatically instant when user prefers reduced motion
const handlePressIn = () => {
  createSpring(scaleAnim, 0.96).start();
};

// Timed transition — duration becomes 0 when reduced motion is on
const duration = getAnimationDuration(A11Y.ANIMATION_NORMAL);
```

---

## 4. Layout & Responsiveness

### 4.1 Standardized Screen Header Component

**Problem**: Each tab screen (`bounty-app.tsx`, `postings-screen.tsx`, `wallet-screen.tsx`, `profile-screen.tsx`) manually calculates its header top offset, leading to inconsistency.

**Solution**: Create a reusable `ScreenHeader` component.

```tsx
// components/ui/screen-header.tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import { HEADER_LAYOUT, SPACING, TYPOGRAPHY } from 'lib/constants/accessibility';
import { colors } from 'lib/theme';

interface ScreenHeaderProps {
  title: string;
  icon?: React.ReactNode;
  rightContent?: React.ReactNode;
  subtitle?: string;
}

export function ScreenHeader({ title, icon, rightContent, subtitle }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.HEADER_VERTICAL }]}>
      <View style={styles.row}>
        <View style={styles.titleRow}>
          {icon && <View style={styles.iconWrap}>{icon}</View>}
          <View>
            <Text style={styles.title}>{title}</Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        </View>
        {rightContent && <View style={styles.right}>{rightContent}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingBottom: SPACING.HEADER_VERTICAL,
    backgroundColor: colors.background.secondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_LAYOUT.iconToTitleGap,
  },
  iconWrap: {
    width: HEADER_LAYOUT.iconSize,
    height: HEADER_LAYOUT.iconSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: HEADER_LAYOUT.titleFontSize,
    fontWeight: '700',
    color: colors.text.primary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: colors.text.secondary,
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.COMPACT_GAP,
  },
});
```

**Adoption checklist** (replace per-screen header implementation):
- [ ] `app/tabs/bounty-app.tsx`
- [ ] `app/tabs/postings-screen.tsx`
- [ ] `app/tabs/wallet-screen.tsx`
- [ ] `app/tabs/profile-screen.tsx`
- [ ] `app/tabs/messenger-screen.tsx`
- [ ] `app/tabs/search.tsx`

### 4.2 Bottom Padding Utility

All scrollable screens must clear the bottom navigation bar. Centralise this calculation:

```typescript
// lib/utils/layout-utils.ts
import { SIZING } from 'lib/constants/accessibility';

export const SCROLL_BOTTOM_PADDING = SIZING.BOTTOM_NAV_HEIGHT + 16;
// Usage: <ScrollView contentContainerStyle={{ paddingBottom: SCROLL_BOTTOM_PADDING }} />
```

### 4.3 Safe Area Wrapper

Screens that render full-bleed backgrounds (auth, onboarding, legal) should use a consistent wrapper:

```tsx
// components/ui/safe-screen.tsx
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from 'lib/theme';

export function SafeScreen({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: colors.background.primary }, style]}
      edges={['top', 'left', 'right']}
    >
      {children}
    </SafeAreaView>
  );
}
```

### 4.4 Device Width Breakpoints

For components that adapt to wider screens (tablets, split view):

```typescript
// lib/utils/layout-utils.ts  (additions)
import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const BREAKPOINTS = {
  sm: 360,   // Budget Android
  md: 390,   // iPhone 15
  lg: 430,   // iPhone Pro Max / large Android
  xl: 768,   // iPad / tablet
} as const;

export const isCompact = SCREEN_WIDTH < BREAKPOINTS.md;
export const isWide    = SCREEN_WIDTH >= BREAKPOINTS.lg;
export const isTablet  = SCREEN_WIDTH >= BREAKPOINTS.xl;
```

---

## 5. Visual Styling Improvements

### 5.1 Elevation System

Apply shadow presets consistently based on surface elevation level:

| Level | Token | Use Case |
|-------|-------|----------|
| 0 | None | Flat list items, dividers |
| 1 | `shadows.sm` | Inline cards, chips, tags |
| 2 | `shadows.md` | Bounty cards, section cards |
| 3 | `shadows.lg` | Modals, drawers, bottom sheets |
| 4 | `shadows.xl` | Full-screen overlays |
| Brand | `shadows.emerald` | Primary CTA buttons, featured items |

### 5.2 Color Usage Rules

| Token | Approved Uses | Prohibited Uses |
|-------|--------------|-----------------|
| `colors.primary[500]` (#00912C) | Primary buttons, active tab indicators, success icons | Body text on dark backgrounds |
| `colors.primary[300]` | Text labels on dark backgrounds, emerald accents | Icon fills on light backgrounds |
| `colors.background.surface` | Card backgrounds | Screen backgrounds |
| `colors.background.primary` | Screen backgrounds | Card backgrounds |
| `colors.text.primary` | All body text, headings | Placeholder text |
| `colors.text.muted` | Placeholder text, captions, metadata | Headings, interactive labels |
| `colors.error` | Destructive buttons, inline validation errors | Warning / informational states |
| `colors.warning` | Warning badges, escrow reminders | Error states |

### 5.3 Status Badge Color Standards

All status badges must include both color and a text label or icon:

```tsx
// components/ui/badge.tsx  (enhancement)
const STATUS_STYLES = {
  open:        { bg: 'rgba(0, 145, 44, 0.15)',  border: 'rgba(0, 145, 44, 0.4)',  text: '#6ee7b7' },
  in_progress: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)', text: '#fcd34d' },
  completed:   { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.4)', text: '#93c5fd' },
  archived:    { bg: 'rgba(107, 114, 128, 0.15)', border: 'rgba(107, 114, 128, 0.4)', text: '#9ca3af' },
  cancelled:   { bg: 'rgba(239, 68, 68, 0.15)',  border: 'rgba(239, 68, 68, 0.4)',  text: '#fca5a5' },
} as const;
```

### 5.4 Typography Hierarchy

Enforce a maximum 4-level heading scale per screen:

| Level | Font Size | Weight | Usage |
|-------|-----------|--------|-------|
| H1 | 24px | 700 | Screen / modal titles |
| H2 | 20px | 700 | Section headers |
| H3 | 18px | 600 | Card titles, list headers |
| Body | 15–16px | 400–500 | Content, descriptions |
| Caption | 12–14px | 400 | Metadata, timestamps, hints |

Always use the `AccessibleText` component from `components/ui/accessible-text.tsx` for text rendered inside scrollable lists to ensure system font scaling is respected.

### 5.5 Icon Consistency

- Source: `MaterialIcons` from `@expo/vector-icons` (already used throughout)
- Sizes: Use only `SIZING.ICON_SMALL` (16), `ICON_MEDIUM` (20), `ICON_LARGE` (24), `ICON_XLARGE` (32)
- Decorative icons: always set `accessibilityElementsHidden={true}`
- Icons in buttons: always include an `accessibilityLabel` on the parent `TouchableOpacity`

---

## 6. Usability Improvements

### 6.1 Inline Form Validation

Replace current alert-based validation with inline field-level error messages.

```tsx
// components/ui/input.tsx  (enhancement)
interface InputProps {
  // ... existing props
  error?: string;
  hint?: string;
}

// Below the TextInput:
{error && (
  <View style={styles.errorRow}>
    <MaterialIcons name="error-outline" size={14} color={colors.error} accessibilityElementsHidden />
    <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
  </View>
)}
{!error && hint && (
  <Text style={styles.hintText}>{hint}</Text>
)}
```

### 6.2 Destructive Action Confirmation Pattern

All destructive operations (delete bounty, cancel application, archive, delete account) must use a standardized confirmation sheet:

```tsx
// components/ui/destructive-confirm-sheet.tsx
interface DestructiveConfirmSheetProps {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;         // e.g. "Delete Bounty"
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}
```

This replaces the mix of `Alert.alert()` calls and custom modal implementations currently spread across screens.

### 6.3 Offline Status Pattern

The `ConnectionStatus` and `OfflineStatusBadge` components are already implemented. Standardise their placement:

- **Persistent banner**: rendered once at the `BountyAppInner` level, not inside individual screens
- **Pending action indicator**: small badge on the relevant button/card while the offline queue holds the action
- **Retry on reconnect**: automatic retry via `useOfflineQueue` when connectivity is restored

### 6.4 Pull-to-Refresh Consistency

Standardize `RefreshControl` props across all lists:

```tsx
// lib/utils/refresh-control-props.ts
import { colors } from 'lib/theme';

export const standardRefreshControl = (
  refreshing: boolean,
  onRefresh: () => void
) => (
  <RefreshControl
    refreshing={refreshing}
    onRefresh={onRefresh}
    tintColor={colors.primary[500]}
    colors={[colors.primary[500]]}
    progressBackgroundColor={colors.background.surface}
  />
);
```

### 6.5 Toast / Snackbar Notifications

Use the existing `toast.tsx` / `sonner.tsx` components for all transient feedback (success, error, info). Remove inline `Alert.alert` calls for non-destructive notifications.

| Type | Component | Duration |
|------|-----------|----------|
| Success | `toast({ type: 'success' })` | 2 500 ms |
| Error | `toast({ type: 'error' })` | 5 000 ms (dismissible) |
| Info | `toast({ type: 'info' })` | 3 000 ms |
| Warning | `toast({ type: 'warning' })` | 4 000 ms |

---

## 7. Accessibility Enhancements

The existing `ACCESSIBILITY_GUIDE.md` documents current WCAG AA compliance. This section tracks gaps and new requirements.

### 7.1 Reduced Motion (G-AC3)

The `hooks/use-accessible-animation.ts` hook already supports reduced motion.  The following components need to be audited to ensure they **use `useAccessibleAnimation()`** (or one of its specialized variants) instead of calling `Animated` APIs directly:

| File | Animation Target |
|------|-----------------|
| `components/ui/animated-card.tsx` | Press scale, expand/collapse |
| `components/ui/animated-screen.tsx` | Screen entry fade/slide |
| `components/ui/animated-section.tsx` | Section fade-in |
| `components/ui/bottom-nav.tsx` | Tab switch spring animation |
| `components/ui/empty-state.tsx` | Icon entrance scale |
| `components/ui/skeleton-loaders.tsx` | Shimmer pulse |
| `hooks/use-app-theme.ts` | Animation duration token |

```tsx
// Pattern to apply in each animated component:
import { useAccessibleAnimation } from 'hooks/use-accessible-animation';
const { createSpring, getAnimationDuration } = useAccessibleAnimation();
// Then replace direct Animated.spring / Animated.timing calls with createSpring / createTiming
```

### 7.2 Color-Not-Sole-Indicator Audit (G-AC2)

Screen components to audit and update:

- `components/bounty-list-item.tsx` — status is shown by colored dot only; add text label
- `components/ui/badge.tsx` — ensure all variants carry a readable text label
- `components/escrow-status-card.tsx` — escrow stages use color coding; add icon + text per stage
- `components/ui/progress.tsx` — progress bar must include a `accessibilityValue` with a percentage

### 7.3 Dynamic Text Scaling Audit (G-AC5)

Screens where layout may break at 2× system font scale:

| Screen | Risk Area |
|--------|-----------|
| `bounty-list-item.tsx` | Price / location row overflow |
| `components/ui/trust-badges.tsx` | Badge text wrapping |
| `components/ui/verification-badge.tsx` | Compact layout with long verification type text |
| `app/tabs/wallet-screen.tsx` | Balance display overflow |

Fix pattern: replace `numberOfLines={1}` (which silently truncates) with `allowFontScaling={true}` + sufficient `flexShrink` on the parent.

### 7.4 Focus Order & Keyboard Navigation

For screens rendered in a web context (Expo web builds / e2e testing):

- Ensure logical tab order follows the visual reading flow (top-left to bottom-right)
- Modals must trap focus using `accessible={true}` on the root container
- After closing a modal, return focus to the element that opened it

### 7.5 Screen Reader Grouping

Improve grouped content announcements in list items:

```tsx
// bounty-list-item.tsx  – group all metadata into one accessible container
<View
  accessible={true}
  accessibilityLabel={[
    bounty.title,
    `by ${posterName}`,
    bounty.amount ? `$${bounty.amount}` : 'for honor',
    bounty.location ? `near ${bounty.location}` : '',
    `status: ${bounty.status ?? 'open'}`,
  ].filter(Boolean).join(', ')}
  accessibilityRole="button"
  accessibilityHint="Double tap to view bounty details"
>
```

---

## 8. Performance Optimization

The `PERFORMANCE.md` documents completed optimizations. This section tracks remaining work.

### 8.1 Convert PostingsScreen to FlatList (G-P1, G-P3)

**Current**: `postings-screen.tsx` uses `.map()` rendering inside `ScrollView` for the public feed and in-progress lists.

**Target**: Replace each list with an optimized `FlatList`:

```tsx
// Before (causes re-renders and janky scroll on 50+ items):
{bounties.map(b => <BountyCard key={b.id} bounty={b} />)}

// After:
const renderBountyItem = useCallback(({ item }: { item: Bounty }) => (
  <BountyCard bounty={item} />
), []);

const keyExtractor = useCallback((item: Bounty) => item.id, []);

<FlatList
  data={bounties}
  renderItem={renderBountyItem}
  keyExtractor={keyExtractor}
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
  initialNumToRender={10}
  ItemSeparatorComponent={Separator}
/>
```

### 8.2 Memoization Audit

All components that receive callbacks from a parent `FlatList` must be wrapped in `React.memo`:

- [ ] `BountyCard`
- [ ] `BountyListItem`
- [ ] `ApplicantCard`
- [ ] `MessageBubble`
- [ ] `MyPostingExpandable`

### 8.3 Image Optimization Completion

Remaining images not yet using `OptimizedImage`:

- [ ] Bounty detail hero image (`app/bounty/[id].tsx`)
- [ ] Applicant card avatar (`components/applicant-card.tsx`)
- [ ] Admin user list avatar (`components/admin/`)
- [ ] Onboarding carousel images (`app/auth/onboarding/`)

```tsx
// Correct list-item usage:
<OptimizedImage
  source={avatarUri}
  width={SIZING.AVATAR_SMALL}
  height={SIZING.AVATAR_SMALL}
  useThumbnail={true}
  priority="low"
  placeholder={require('assets/default-avatar.png')}
/>
```

### 8.4 Bundle Size

- Audit and remove unused icon names imported from `@expo/vector-icons` — prefer named imports only
- Enable Hermes engine for Android (already supported by Expo SDK 54)
- Verify Metro tree-shaking is enabled in `metro.config.js`

---

## 9. Phased Implementation Roadmap

### Phase 1 — Foundation (Weeks 1–2)

**Goal**: Eliminate inconsistencies in design tokens, layout primitives, and a11y patterns.

- [x] Create `lib/design-tokens.ts` barrel export for unified token access
- [x] Update `tailwind.config.js` with brand color extensions
- [x] `hooks/use-accessible-animation.ts` already provides reduced-motion-aware animation helpers (no new hook needed)
- [x] Create `components/ui/screen-header.tsx` standardized header
- [x] Create `lib/utils/layout-utils.ts` with `SCROLL_BOTTOM_PADDING`, breakpoints
- [x] Create `components/ui/safe-screen.tsx` wrapper
- [x] Add `lib/utils/refresh-control-props.tsx` helper
- [x] Create `components/ui/destructive-confirm-sheet.tsx` for uniform destructive-action confirmation
- [ ] Run `npx tsc --noEmit` in CI — zero new type errors

### Phase 2 — Screen Header Unification (Week 3)

**Goal**: All 6 tab screens use the standardized `ScreenHeader` component.

- [ ] Migrate `app/tabs/bounty-app.tsx` header
- [ ] Migrate `app/tabs/postings-screen.tsx` header
- [ ] Migrate `app/tabs/wallet-screen.tsx` header
- [ ] Migrate `app/tabs/profile-screen.tsx` header
- [ ] Migrate `app/tabs/messenger-screen.tsx` header
- [ ] Migrate `app/tabs/search.tsx` header
- [ ] Visual QA: screenshots on iPhone 15 + Pixel 7 simulators
- [ ] Run `npx tsc --noEmit`

### Phase 3 — Accessibility Enhancements (Week 4)

**Goal**: Close all identified accessibility gaps; achieve full `useAccessibleAnimation` adoption.

- [ ] Migrate animated components listed in §7.1 to use `useAccessibleAnimation()` / `usePressAnimation()` hooks
- [ ] Fix color-not-sole-indicator issues listed in §7.2
- [ ] Fix dynamic text scaling issues listed in §7.3
- [ ] Improve screen-reader grouping in `bounty-list-item.tsx`
- [ ] Audit and fix focus trapping in all modals
- [ ] Manual VoiceOver test on iOS simulator for all tab screens
- [ ] Manual TalkBack test on Android emulator for all tab screens

### Phase 4 — Performance Optimization (Week 5)

**Goal**: PostingsScreen FlatList migration; complete image optimization.

- [ ] Convert PostingsScreen public feed from `.map()` to `FlatList`
- [ ] Convert PostingsScreen in-progress list from `.map()` to `FlatList`
- [ ] Wrap `BountyCard`, `ApplicantCard`, `MessageBubble`, `MyPostingExpandable` in `React.memo`
- [ ] Complete `OptimizedImage` adoption for all remaining screens
- [ ] Profile scroll FPS before/after on Postings screen (target: 60 fps)

### Phase 5 — Visual Polish & Form UX (Week 6)

**Goal**: Consistent elevation, inline validation, and standardised notifications.

- [ ] Audit all cards/modals for correct shadow preset assignment (§5.1)
- [ ] Enhance `components/ui/input.tsx` with inline `error` and `hint` props
- [x] Create `components/ui/destructive-confirm-sheet.tsx` (done in Phase 1)
- [ ] Replace remaining `Alert.alert` destructive calls with `DestructiveConfirmSheet`
- [ ] Replace all non-destructive `Alert.alert` with `toast()` calls
- [ ] Apply status badge color standards (§5.3) to `badge.tsx`
- [ ] Run full visual regression review (screenshot diff on all tab screens)
- [ ] Run `npx tsc --noEmit`

### Phase 6 — Design Token Cleanup (Week 7)

**Goal**: All screens import tokens exclusively from `lib/design-tokens.ts`; zero hardcoded hex values.

- [ ] Global search-and-replace hardcoded `#1a3d2e`, `#2d5240`, `#00912C`, `#fffef5` strings with token references
- [ ] Verify Tailwind config brand tokens appear in generated stylesheet
- [ ] Typography audit: replace all inline `fontSize` numbers with `TYPOGRAPHY.*` constants
- [ ] Final `npx tsc --noEmit` + ESLint run

---

## 10. Component-Level Guidelines

### 10.1 New Component Checklist

Every new UI component must satisfy:

```
[ ] Uses tokens exclusively from lib/design-tokens.ts (no hardcoded colors/sizes)
[ ] accessibilityRole, accessibilityLabel, accessibilityHint on all interactive elements
[ ] Decorative icons have accessibilityElementsHidden={true}
[ ] Animated variants respect useReducedMotion
[ ] Touch targets >= 44×44 pt (use SIZING.MIN_TOUCH_TARGET)
[ ] Tested with system font size at 2× scale (no clipping)
[ ] Exported from components/ui/index.ts or components/index.ts
[ ] TypeScript types defined (no `any`)
[ ] npx tsc --noEmit passes before PR
```

### 10.2 Screen Component Checklist

Every new or modified screen must satisfy:

```
[ ] Uses ScreenHeader component for header section
[ ] Applies SCROLL_BOTTOM_PADDING to scrollable container paddingBottom
[ ] Uses SafeScreen wrapper if full-bleed background is needed
[ ] Uses standardRefreshControl helper for pull-to-refresh
[ ] Loading state handled via skeleton loaders (not ActivityIndicator alone)
[ ] Empty state handled via EmptyState component
[ ] Error state shows inline error banner with dismiss and retry
[ ] All FlatLists have memoized renderItem and keyExtractor
[ ] npx tsc --noEmit passes before PR
```

### 10.3 Existing Components Requiring Update

| Component | Required Change |
|-----------|----------------|
| `components/ui/badge.tsx` | Add `STATUS_STYLES` map (§5.3); enforce text label |
| `components/ui/input.tsx` | Add `error` and `hint` props with inline display (§6.1) |
| `components/ui/animated-card.tsx` | Add `useReducedMotion` check (§7.1) |
| `components/ui/animated-screen.tsx` | Add `useReducedMotion` check (§7.1) |
| `components/ui/skeleton-loaders.tsx` | Add `useReducedMotion` check to shimmer pulse |
| `components/bounty-list-item.tsx` | Improve accessible grouping (§7.5); add status text label |
| `components/escrow-status-card.tsx` | Add icon + text per stage for color-not-sole-indicator |
| `app/tabs/postings-screen.tsx` | Convert lists to FlatList (§8.1) |

---

## 11. Testing & Validation Strategy

### 11.1 TypeScript

Run before every PR:

```bash
npx tsc --noEmit
```

Target: **zero type errors** in modified files.

### 11.2 Linting

```bash
npm run lint
```

Target: no new ESLint warnings or errors in modified files.

### 11.3 Visual Testing

After every Phase:
1. Launch `npx expo start` (iOS simulator + Android emulator)
2. Navigate all 5 tab screens
3. Check for layout overflow, misaligned elements, overlapping content
4. Enable "Large Text" (iOS: 5× accessibility scale) and repeat
5. Test on both portrait and landscape orientation

### 11.4 Accessibility Testing

After Phase 3 and before each release:
1. Enable VoiceOver on iOS simulator → navigate all tab screens with swipe gestures
2. Enable TalkBack on Android emulator → navigate all tab screens
3. Use Accessibility Inspector (Xcode) to check touch targets
4. Run contrast checker on any new color combinations (WebAIM tool)

### 11.5 Performance Testing

After Phase 4:
1. Open Bounty Dashboard with 50+ items; scroll rapidly; verify 60 fps in React DevTools Profiler
2. Open PostingsScreen with 50+ items; repeat scroll test
3. Cold-launch app; measure Time to Interactive (target < 2 s)
4. Compare memory baseline vs. peak during 5-minute browsing session

### 11.6 Regression Testing

```bash
# Run existing test suite
npm test

# Check for regressions in core flows
npm run test -- --testPathPattern="bounty|auth|wallet|postings"
```

---

## 12. Design Tokens Reference

A quick-reference table of the most-used design tokens and their intended contexts.

### Colors

| Token | Hex | Context |
|-------|-----|---------|
| `colors.primary[500]` | #00912C | Primary CTA buttons, active states |
| `colors.primary[600]` | #007423 | Hover/pressed primary button |
| `colors.primary[300]` | #66ce8f | Text on dark backgrounds, accents |
| `colors.background.primary` | #1a3d2e | Screen backgrounds |
| `colors.background.secondary` | #2d5240 | Header backgrounds |
| `colors.background.surface` | rgba(45,82,64,0.75) | Card surfaces |
| `colors.background.elevated` | rgba(45,82,64,0.85) | Modals, overlays |
| `colors.text.primary` | #fffef5 | Headings, body text |
| `colors.text.secondary` | rgba(255,254,245,0.8) | Secondary labels |
| `colors.text.muted` | rgba(255,254,245,0.6) | Captions, placeholders |
| `colors.error` | #ef4444 | Errors, destructive actions |
| `colors.warning` | #f59e0b | Warnings |
| `colors.info` | #3b82f6 | Informational messages |

### Spacing

| Token | Value | Context |
|-------|-------|---------|
| `SPACING.SCREEN_HORIZONTAL` | 16 px | Screen horizontal padding |
| `SPACING.SCREEN_VERTICAL` | 24 px | Section gaps |
| `SPACING.ELEMENT_GAP` | 12 px | Related element gap |
| `SPACING.COMPACT_GAP` | 8 px | Tight element gap |
| `SPACING.CARD_PADDING` | 16 px | Card inner padding |
| `SIZING.BOTTOM_NAV_HEIGHT` | 60 px | Bottom nav clearance |

### Typography

| Token | Value | Context |
|-------|-------|---------|
| `TYPOGRAPHY.SIZE_XLARGE` | 24 px | Screen titles (H1) |
| `TYPOGRAPHY.SIZE_LARGE` | 20 px | Section headers (H2) |
| `TYPOGRAPHY.SIZE_HEADER` | 18 px | Card titles (H3) |
| `TYPOGRAPHY.SIZE_BODY` | 16 px | Body text |
| `TYPOGRAPHY.SIZE_DEFAULT` | 15 px | Default text |
| `TYPOGRAPHY.SIZE_SMALL` | 14 px | Captions, metadata |
| `TYPOGRAPHY.SIZE_XSMALL` | 12 px | Timestamps, hints |

### Shadows

| Token | Elevation | Context |
|-------|-----------|---------|
| `shadows.sm` | 1 | Chips, tags, inline cards |
| `shadows.md` | 3 | Bounty cards, section cards |
| `shadows.lg` | 5 | Bottom sheets, modals |
| `shadows.xl` | 8 | Full-screen overlays |
| `shadows.emerald` | 6 | Primary CTA buttons (glow) |

### Border Radius

| Token | Value | Context |
|-------|-------|---------|
| `borderRadius.sm` | 4 px | Tags, pills |
| `borderRadius.md` | 8 px | Input fields, chips |
| `borderRadius.lg` | 12 px | Buttons |
| `borderRadius.xl` | 16 px | Cards |
| `borderRadius['2xl']` | 24 px | Modals, bottom sheets |
| `borderRadius.full` | 9999 px | Avatars, circular buttons |

---

## Related Documents

- [`ACCESSIBILITY_GUIDE.md`](./ACCESSIBILITY_GUIDE.md) — WCAG compliance standards and component-level a11y patterns
- [`PERFORMANCE.md`](./PERFORMANCE.md) — FlatList optimization, image caching, memory management
- [`ANIMATION_GUIDE.md`](./ANIMATION_GUIDE.md) — Animated component usage and theme integration
- [`THEME_IMPLEMENTATION_SUMMARY.md`](./THEME_IMPLEMENTATION_SUMMARY.md) — Design system implementation history
- [`BOTTOM_NAV_AUDIT_REPORT.md`](./BOTTOM_NAV_AUDIT_REPORT.md) — BottomNav placement rules and examples
- [`lib/theme.ts`](./lib/theme.ts) — Design system tokens (source of truth for colors, spacing, shadows)
- [`lib/constants/accessibility.ts`](./lib/constants/accessibility.ts) — Accessibility and layout constants
- [`components/ui/`](./components/ui/) — Full UI component library
