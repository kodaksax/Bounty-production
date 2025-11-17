# Component Styling Guide

## Overview

This guide provides practical patterns and examples for styling components in BOUNTYExpo using our design token system. Follow these patterns to ensure visual consistency across the application.

## Table of Contents

1. [Basic Component Patterns](#basic-component-patterns)
2. [Card Components](#card-components)
3. [List Items](#list-items)
4. [Buttons & Interactive Elements](#buttons--interactive-elements)
5. [Modal & Dialog Components](#modal--dialog-components)
6. [Form Components](#form-components)
7. [Typography Patterns](#typography-patterns)
8. [Layout Patterns](#layout-patterns)
9. [Common Pitfalls](#common-pitfalls)

---

## Basic Component Patterns

### Standard Component Structure

```typescript
import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, SHADOWS, SIZING } from 'lib/constants/accessibility';

interface MyComponentProps {
  title: string;
  description?: string;
  onPress?: () => void;
}

export function MyComponent({ title, description, onPress }: MyComponentProps) {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={styles.title}>{title}</Text>
      {description && (
        <Text style={styles.description}>{description}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.BG_SECONDARY,
    borderRadius: RADIUS.MD,
    padding: SPACING.CARD_PADDING,
    ...SHADOWS.SM,
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  title: {
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: SPACING.COMPACT_GAP,
  },
  description: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_SMALL * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
});
```

---

## Card Components

### Basic Card

```typescript
const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.BG_SECONDARY, // emerald-700
    borderRadius: RADIUS.LG,
    padding: SPACING.CARD_PADDING,
    ...SHADOWS.SM,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SUBTLE,
    marginBottom: SPACING.ELEMENT_GAP,
  },
});
```

### Elevated Card (emphasis)

```typescript
const styles = StyleSheet.create({
  elevatedCard: {
    backgroundColor: COLORS.BG_SECONDARY,
    borderRadius: RADIUS.LG,
    padding: SPACING.CARD_PADDING,
    ...SHADOWS.MD, // More prominent shadow
    borderWidth: 1,
    borderColor: COLORS.BORDER_DEFAULT,
  },
});
```

### Interactive Card (pressable)

```typescript
const styles = StyleSheet.create({
  interactiveCard: {
    backgroundColor: COLORS.BG_SECONDARY,
    borderRadius: RADIUS.LG,
    padding: SPACING.CARD_PADDING,
    ...SHADOWS.SM,
    borderWidth: 1,
    borderColor: COLORS.BORDER_SUBTLE,
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  interactiveCardPressed: {
    backgroundColor: COLORS.BG_SURFACE, // Slightly darker on press
    ...SHADOWS.MD, // Elevate on press
  },
});
```

### Card with Header and Footer

```typescript
const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.BG_SECONDARY,
    borderRadius: RADIUS.LG,
    ...SHADOWS.SM,
    overflow: 'hidden', // For borderRadius to work with header/footer
  },
  cardHeader: {
    padding: SPACING.CARD_PADDING,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER_SUBTLE,
  },
  cardContent: {
    padding: SPACING.CARD_PADDING,
  },
  cardFooter: {
    padding: SPACING.CARD_PADDING,
    borderTopWidth: 1,
    borderTopColor: COLORS.BORDER_SUBTLE,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
```

---

## List Items

### Standard List Item

```typescript
const styles = StyleSheet.create({
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.BG_OVERLAY, // Semi-transparent overlay
    borderRadius: RADIUS.MD,
    padding: SPACING.ELEMENT_GAP,
    marginBottom: SPACING.LIST_ITEM_GAP,
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  listItemLeading: {
    marginRight: SPACING.ELEMENT_GAP,
  },
  listItemContent: {
    flex: 1,
    justifyContent: 'center',
  },
  listItemTrailing: {
    marginLeft: SPACING.ELEMENT_GAP,
  },
  listItemTitle: {
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 4,
  },
  listItemSubtitle: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: COLORS.TEXT_SECONDARY,
  },
});
```

### List Item with Avatar

```typescript
const styles = StyleSheet.create({
  listItemWithAvatar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.BG_OVERLAY,
    borderRadius: RADIUS.MD,
    padding: SPACING.ELEMENT_GAP,
    marginBottom: SPACING.LIST_ITEM_GAP,
  },
  avatar: {
    width: SIZING.AVATAR_SMALL,
    height: SIZING.AVATAR_SMALL,
    borderRadius: SIZING.AVATAR_SMALL / 2,
    marginRight: SPACING.ELEMENT_GAP,
    backgroundColor: COLORS.EMERALD_700,
  },
});
```

---

## Buttons & Interactive Elements

### Primary Button

```typescript
const styles = StyleSheet.create({
  primaryButton: {
    backgroundColor: COLORS.INTERACTIVE_DEFAULT, // emerald-500
    paddingHorizontal: SPACING.BUTTON_PADDING_HORIZONTAL,
    paddingVertical: SPACING.BUTTON_PADDING_VERTICAL,
    borderRadius: RADIUS.FULL, // Pill shape
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.SM,
  },
  primaryButtonText: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
});
```

### Secondary Button (outline)

```typescript
const styles = StyleSheet.create({
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.BORDER_LIGHT, // emerald-300
    paddingHorizontal: SPACING.BUTTON_PADDING_HORIZONTAL,
    paddingVertical: SPACING.BUTTON_PADDING_VERTICAL,
    borderRadius: RADIUS.FULL,
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    fontWeight: '600',
    color: COLORS.TEXT_ACCENT, // emerald-300
  },
});
```

### Icon Button

```typescript
const styles = StyleSheet.create({
  iconButton: {
    width: SIZING.MIN_TOUCH_TARGET,
    height: SIZING.MIN_TOUCH_TARGET,
    borderRadius: SIZING.MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.BG_SURFACE,
  },
});
```

### Chip/Badge

```typescript
const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.BG_SURFACE,
    borderRadius: RADIUS.FULL,
    paddingHorizontal: SPACING.ELEMENT_GAP,
    paddingVertical: SPACING.COMPACT_GAP,
    gap: 4,
  },
  chipText: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '500',
    color: COLORS.TEXT_SECONDARY,
  },
  chipActive: {
    backgroundColor: COLORS.INTERACTIVE_DEFAULT,
  },
  chipActiveText: {
    color: COLORS.TEXT_PRIMARY,
  },
});
```

---

## Modal & Dialog Components

### Modal Container

```typescript
const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)', // Dark overlay
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.SCREEN_HORIZONTAL,
  },
  modalContent: {
    backgroundColor: COLORS.BG_SURFACE, // emerald-800
    borderRadius: RADIUS.XL,
    padding: SPACING.SECTION_GAP,
    width: '100%',
    maxWidth: 400,
    ...SHADOWS.XL, // Prominent shadow for modals
  },
  modalHeader: {
    marginBottom: SPACING.SECTION_GAP,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.SIZE_XLARGE,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: SPACING.COMPACT_GAP,
  },
  modalDescription: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_SMALL * TYPOGRAPHY.LINE_HEIGHT_RELAXED),
  },
  modalFooter: {
    flexDirection: 'row',
    gap: SPACING.ELEMENT_GAP,
    marginTop: SPACING.SECTION_GAP,
  },
});
```

### Alert Dialog

```typescript
const styles = StyleSheet.create({
  alertDialog: {
    backgroundColor: COLORS.BG_SURFACE,
    borderRadius: RADIUS.LG,
    padding: SPACING.SECTION_GAP,
    ...SHADOWS.LG,
    maxWidth: 320,
  },
  alertIcon: {
    width: SIZING.ICON_XLARGE,
    height: SIZING.ICON_XLARGE,
    borderRadius: SIZING.ICON_XLARGE / 2,
    backgroundColor: 'rgba(220, 38, 38, 0.1)', // error tint
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.ELEMENT_GAP,
  },
  alertTitle: {
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: SPACING.COMPACT_GAP,
  },
  alertMessage: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_SMALL * TYPOGRAPHY.LINE_HEIGHT_RELAXED),
    marginBottom: SPACING.SECTION_GAP,
  },
});
```

---

## Form Components

### Text Input

```typescript
const styles = StyleSheet.create({
  input: {
    backgroundColor: COLORS.BG_SURFACE,
    borderRadius: RADIUS.MD,
    borderWidth: 1,
    borderColor: COLORS.BORDER_DEFAULT,
    padding: SPACING.ELEMENT_GAP,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    color: COLORS.TEXT_PRIMARY,
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
  },
  inputFocused: {
    borderColor: COLORS.BORDER_LIGHT, // emerald-300
    ...SHADOWS.SM,
  },
  inputError: {
    borderColor: COLORS.ERROR,
  },
});
```

### Form Label

```typescript
const styles = StyleSheet.create({
  label: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: SPACING.COMPACT_GAP,
  },
  labelOptional: {
    color: COLORS.TEXT_MUTED,
    fontWeight: '400',
  },
});
```

### Form Error Message

```typescript
const styles = StyleSheet.create({
  errorMessage: {
    fontSize: TYPOGRAPHY.SIZE_XSMALL,
    color: COLORS.ERROR_LIGHT,
    marginTop: SPACING.COMPACT_GAP,
  },
});
```

### Checkbox/Radio

```typescript
const styles = StyleSheet.create({
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SIZING.MIN_TOUCH_TARGET,
    marginBottom: SPACING.ELEMENT_GAP,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: RADIUS.SM,
    borderWidth: 2,
    borderColor: COLORS.BORDER_LIGHT,
    marginRight: SPACING.ELEMENT_GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.INTERACTIVE_DEFAULT,
    borderColor: COLORS.INTERACTIVE_DEFAULT,
  },
  checkboxLabel: {
    fontSize: TYPOGRAPHY.SIZE_BODY,
    color: COLORS.TEXT_PRIMARY,
    flex: 1,
  },
});
```

---

## Typography Patterns

### Heading Hierarchy

```typescript
const styles = StyleSheet.create({
  // Page Title
  h1: {
    fontSize: TYPOGRAPHY.SIZE_XLARGE, // 24px
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_XLARGE * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
    marginBottom: SPACING.ELEMENT_GAP,
  },
  
  // Section Header
  h2: {
    fontSize: TYPOGRAPHY.SIZE_LARGE, // 20px
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_LARGE * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
    marginBottom: SPACING.ELEMENT_GAP,
  },
  
  // Subsection Header
  h3: {
    fontSize: TYPOGRAPHY.SIZE_HEADER, // 18px
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_HEADER * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
    marginBottom: SPACING.COMPACT_GAP,
  },
  
  // Body Text
  body: {
    fontSize: TYPOGRAPHY.SIZE_BODY, // 16px
    color: COLORS.TEXT_PRIMARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_BODY * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
  
  // Secondary Text
  bodySecondary: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT, // 15px
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_DEFAULT * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
  
  // Small Text
  small: {
    fontSize: TYPOGRAPHY.SIZE_SMALL, // 14px
    color: COLORS.TEXT_MUTED,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_SMALL * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
  
  // Caption/Metadata
  caption: {
    fontSize: TYPOGRAPHY.SIZE_XSMALL, // 12px
    color: COLORS.TEXT_MUTED,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_XSMALL * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
});
```

---

## Layout Patterns

### Screen Container

```typescript
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.BG_PRIMARY, // emerald-600
  },
  screenContent: {
    flex: 1,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL, // 16px
  },
});
```

### Section Container

```typescript
const styles = StyleSheet.create({
  section: {
    marginBottom: SPACING.SECTION_GAP, // 24px
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.ELEMENT_GAP, // 12px
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    fontWeight: '600',
    color: COLORS.TEXT_PRIMARY,
  },
});
```

### Grid Layout

```typescript
const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.ELEMENT_GAP,
    marginHorizontal: -SPACING.COMPACT_GAP, // Negative margin for edge alignment
  },
  gridItem: {
    width: '48%', // 2 columns with gap
    marginHorizontal: SPACING.COMPACT_GAP / 2,
  },
});
```

### Stack Layout (Vertical)

```typescript
const styles = StyleSheet.create({
  stack: {
    gap: SPACING.ELEMENT_GAP,
  },
  stackCompact: {
    gap: SPACING.COMPACT_GAP,
  },
  stackLoose: {
    gap: SPACING.SECTION_GAP,
  },
});
```

---

## Common Pitfalls

### ❌ Don't: Hardcode Colors

```typescript
// DON'T
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#047857',
    borderColor: '#6ee7b7',
  },
});
```

### ✅ Do: Use Semantic Tokens

```typescript
// DO
const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.BG_SECONDARY,
    borderColor: COLORS.BORDER_LIGHT,
  },
});
```

---

### ❌ Don't: Arbitrary Spacing

```typescript
// DON'T
const styles = StyleSheet.create({
  container: {
    padding: 18,
    marginBottom: 15,
  },
});
```

### ✅ Do: Use Spacing Tokens

```typescript
// DO
const styles = StyleSheet.create({
  container: {
    padding: SPACING.CARD_PADDING,
    marginBottom: SPACING.ELEMENT_GAP,
  },
});
```

---

### ❌ Don't: Inconsistent Border Radius

```typescript
// DON'T
const styles = StyleSheet.create({
  button: { borderRadius: 25 },
  card: { borderRadius: 14 },
  input: { borderRadius: 10 },
});
```

### ✅ Do: Use Radius Tokens

```typescript
// DO
const styles = StyleSheet.create({
  button: { borderRadius: RADIUS.FULL },
  card: { borderRadius: RADIUS.LG },
  input: { borderRadius: RADIUS.MD },
});
```

---

### ❌ Don't: Ignore Touch Targets

```typescript
// DON'T
const styles = StyleSheet.create({
  button: {
    width: 30,
    height: 30,
  },
});
```

### ✅ Do: Meet Minimum Touch Target

```typescript
// DO
const styles = StyleSheet.create({
  button: {
    minWidth: SIZING.MIN_TOUCH_TARGET, // 44px
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
});
```

---

### ❌ Don't: Forget Line Heights

```typescript
// DON'T
const styles = StyleSheet.create({
  text: {
    fontSize: 16,
  },
});
```

### ✅ Do: Calculate Proper Line Heights

```typescript
// DO
const styles = StyleSheet.create({
  text: {
    fontSize: TYPOGRAPHY.SIZE_BODY,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_BODY * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
  },
});
```

---

## Quick Reference

### Most Common Token Combinations

```typescript
// Standard Card
backgroundColor: COLORS.BG_SECONDARY
borderRadius: RADIUS.LG
padding: SPACING.CARD_PADDING
...SHADOWS.SM

// Interactive Card
backgroundColor: COLORS.BG_SECONDARY
borderRadius: RADIUS.LG
minHeight: SIZING.MIN_TOUCH_TARGET
...SHADOWS.MD

// Primary Button
backgroundColor: COLORS.INTERACTIVE_DEFAULT
borderRadius: RADIUS.FULL
paddingHorizontal: SPACING.BUTTON_PADDING_HORIZONTAL
paddingVertical: SPACING.BUTTON_PADDING_VERTICAL
...SHADOWS.SM

// List Item
backgroundColor: COLORS.BG_OVERLAY
borderRadius: RADIUS.MD
padding: SPACING.ELEMENT_GAP
minHeight: SIZING.MIN_TOUCH_TARGET

// Modal
backgroundColor: COLORS.BG_SURFACE
borderRadius: RADIUS.XL
padding: SPACING.SECTION_GAP
...SHADOWS.XL
```

---

## Resources

- [Design Tokens Documentation](./DESIGN_TOKENS.md)
- [UI/UX Audit Report](./UI_UX_AUDIT_REPORT.md)
- [Accessibility Guide](./ACCESSIBILITY_GUIDE.md)
- [Animation Guide](./ANIMATION_GUIDE.md)

---

*Last Updated: November 15, 2025*
*Version: 1.0*
