/**
 * SearchBarRow — the one header row shared by the bounty feed and the search
 * screen.
 *
 * Tapping the feed's field routes to /tabs/search, which is a whole different
 * screen file. Before this component existed each file drew its own bar, so
 * the field visibly jumped down the screen and changed width and height at the
 * moment of navigation, and the push read as "a new screen opened" rather than
 * "the feed's content was replaced by results". Everything that fixes the
 * geometry — top offset, gutters, field height, radius, type scale, and the
 * 44pt trailing slot the bell and the close button both occupy — is defined
 * here so the two callers cannot drift apart again.
 *
 * The field itself is a button on the feed (`onPress`) and a live input
 * container on the search screen (no `onPress`); everything inside it is the
 * caller's, since only the interior is allowed to differ between the two.
 */
import { MaterialIcons } from '@expo/vector-icons'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, TouchableOpacity, View, type TextStyle } from 'react-native'
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation'
import { A11Y, SIZING, SPACING } from '../../lib/constants/accessibility'
import { hapticFeedback } from '../../lib/haptic-feedback'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'

/** Distance from the top of the screen to the row. */
export const SEARCH_ROW_MARGIN_TOP = 30

/**
 * Field height. Matches the bell / close button and the active-hunters pill so
 * every item in the row shares one baseline.
 */
export const SEARCH_FIELD_HEIGHT = SIZING.MIN_TOUCH_TARGET

/**
 * Type scale for whatever sits in the field — the feed's placeholder label and
 * the search screen's TextInput. Shared so the resting bar and the editable
 * bar set their text identically.
 */
export const SEARCH_FIELD_TEXT: TextStyle = {
  fontSize: 14,
  fontWeight: '500',
}

/**
 * Ceiling on the system font scale for text inside the field. The field is a
 * fixed height so that it can be drawn identically on both screens, which
 * means text past roughly this scale crops rather than reflows. Capping is the
 * lesser evil: the label stays whole and readable, and everything outside this
 * bar still scales freely.
 */
export const SEARCH_FIELD_MAX_FONT_SCALE = 1.3

export interface SearchBarRowProps {
  /** Field interior: the feed's placeholder label, or the input + affordances. */
  children: ReactNode
  /** Makes the field a button (the feed). Omit for a live input container. */
  onPress?: () => void
  /** Rides between the field and the trailing slot — the active-hunters pill. */
  middle?: ReactNode
  /** The 44pt slot at the end: the notification bell, or the close button. */
  trailing?: ReactNode
  /**
   * Lights the field's ring. The search screen turns it on as it mounts, which
   * is the only thing about the bar that moves between the two screens — the
   * same bar, now live, rather than a new one.
   */
  emphasis?: boolean
  accessibilityLabel?: string
  testID?: string
}

export function SearchBarRow({
  children,
  onPress,
  middle,
  trailing,
  accessibilityLabel,
  emphasis = false,
  testID,
}: SearchBarRowProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const { createTiming } = useAccessibleAnimation()

  // Drawn as an overlaid ring rather than by animating the field's own
  // borderColor: colour interpolation can't run on the native driver, and this
  // fires at the same moment the screen's entrance animation does.
  const ring = useRef(new Animated.Value(0)).current
  useEffect(() => {
    createTiming(
      ring,
      emphasis ? 1 : 0,
      A11Y.ANIMATION_NORMAL,
      Easing.out(Easing.cubic)
    ).start()
  }, [emphasis, ring, createTiming])

  const fieldContents = (
    <>
      <Animated.View pointerEvents="none" style={[s.ring, { opacity: ring }]} />
      <MaterialIcons name="search" size={20} color={theme.textDisabled} style={s.icon} />
      {children}
    </>
  )

  return (
    <View style={s.row} testID={testID}>
      {onPress ? (
        <TouchableOpacity
          style={s.field}
          // The tap leaves the screen it was made on, so it gets a tick of
          // haptic feedback to land as a deliberate departure.
          onPress={() => {
            hapticFeedback.light()
            onPress()
          }}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          {fieldContents}
        </TouchableOpacity>
      ) : (
        <View style={s.field}>{fieldContents}</View>
      )}
      {middle}
      {trailing}
    </View>
  )
}

export interface SearchRowIconButtonProps {
  icon: React.ComponentProps<typeof MaterialIcons>['name']
  onPress: () => void
  accessibilityLabel: string
  accessibilityHint?: string
  /** Defaults to the primary text color, matching the bell. */
  color?: string
  /** Rendered on top of the button — the filter's active dot. */
  badge?: ReactNode
  testID?: string
}

/**
 * A trailing-slot button with the notification bell's exact footprint, so a
 * screen that has no bell can fill the slot without resizing the field.
 */
export function SearchRowIconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  color,
  badge,
  testID,
}: SearchRowIconButtonProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  return (
    <TouchableOpacity
      style={s.iconButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      <MaterialIcons
        name={icon}
        size={22}
        color={color ?? theme.text}
        accessibilityElementsHidden={true}
      />
      {badge}
    </TouchableOpacity>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginTop: SEARCH_ROW_MARGIN_TOP,
      marginBottom: SPACING.COMPACT_GAP,
    },
    // Explicit height rather than vertical padding: the interior differs
    // between the two screens (a Text label vs a TextInput, which brings its
    // own intrinsic height and platform padding), so only a fixed height keeps
    // the bar the same size on both.
    field: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      height: SEARCH_FIELD_HEIGHT,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 999,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    // Inset by the field's own 1pt border so the ring lands exactly on it
    // instead of a hair outside, where Android would clip the corners.
    ring: {
      position: 'absolute',
      top: -1,
      left: -1,
      right: -1,
      bottom: -1,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: t.primary,
    },
    icon: { marginRight: SPACING.COMPACT_GAP },
    iconButton: {
      width: SIZING.MIN_TOUCH_TARGET,
      height: SIZING.MIN_TOUCH_TARGET,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      flexShrink: 0,
    },
  })
}
