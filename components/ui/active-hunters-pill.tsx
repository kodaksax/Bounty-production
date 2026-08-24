/**
 * ActiveHuntersPill — the "N active hunters near you" chip that rides the
 * search row.
 *
 * Lives here rather than in the feed because the search screen renders the
 * same row: if only the feed drew the pill, the search field would grow by the
 * pill's width the instant you tapped it, which is the jump SearchBarRow
 * exists to prevent. The search screen is handed the count the feed already
 * fetched (see /tabs/search's `hunters` param) rather than re-querying, so
 * opening search costs no extra location work.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { SIZING, TYPOGRAPHY } from '../../lib/constants/accessibility'
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'

/**
 * Minimum nearby-hunter count worth showing. Below this the number reads as
 * noise rather than a live market ("2 hunters nearby" makes the area look
 * dead), so the pill hides entirely and the layouts fall back to their
 * neutral copy.
 */
export const MIN_ACTIVE_HUNTERS_TO_SHOW = 5

/**
 * Small green "someone is actually here right now" indicator for the
 * active-hunters pill: a solid dot with a halo that expands and fades on a
 * slow loop, the same breathing-pulse language WorkInProgressBanner uses.
 *
 * The dot itself never blinks fully out — a disappearing dot reads as a
 * rendering glitch, while a steady core with a pulsing halo reads as a live
 * signal. Honours Reduce Motion by rendering the static core only, since this
 * animation loops forever and would otherwise never stop moving.
 */
function LiveDot({ color }: { color: string }) {
  const { prefersReducedMotion } = useAccessibleAnimation()
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (prefersReducedMotion) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, prefersReducedMotion])

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] })
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] })

  return (
    <View style={liveDotStyles.wrap}>
      {!prefersReducedMotion && (
        <Animated.View
          pointerEvents="none"
          style={[liveDotStyles.halo, { backgroundColor: color, transform: [{ scale }], opacity }]}
        />
      )}
      <View style={[liveDotStyles.core, { backgroundColor: color }]} />
    </View>
  )
}

const liveDotStyles = StyleSheet.create({
  // Sized to the halo at full expansion (8 x 2), not to the core, so the pulse
  // never paints outside its parent — Android clips overflowing children.
  wrap: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  core: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})

export interface ActiveHuntersPillProps {
  count: number
  radiusMiles: number
  testID?: string
}

export function ActiveHuntersPill({ count, radiusMiles, testID }: ActiveHuntersPillProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  return (
    <View
      style={s.huntersPill}
      accessibilityRole="text"
      accessibilityLabel={`${count} active ${
        count === 1 ? 'hunter' : 'hunters'
      } within ${radiusMiles} miles of you`}
      testID={testID}
    >
      <LiveDot color={theme.success} />
      {/* Stacked rather than one line: "5 Active users" set inline is
          ~40pt wider than the old "5 nearby" and would push the search
          field into truncating its own placeholder. Broken over two
          lines the pill stays narrow and the count still leads. */}
      <View style={s.huntersPillLabel}>
        <Text style={s.huntersPillCount} numberOfLines={1}>
          {count}
        </Text>
        {/* The count is its own column so "users" hangs under "Active"
            at any digit count. A fixed indent (or leading spaces in the
            JSX, which RN strips) would drift the moment the number goes
            double- or triple-digit. */}
        <View style={s.huntersPillWords}>
          <Text style={s.huntersPillText} numberOfLines={1}>
            Active
          </Text>
          <Text style={s.huntersPillSubtext} numberOfLines={1}>
            {count === 1 ? 'hunter' : 'hunters'}
          </Text>
        </View>
      </View>
    </View>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    // Rides the search row between the search field and the trailing button,
    // so it reads as part of the same header chrome: identical pill radius,
    // secondary surface and hairline border as the search field and the bell,
    // and the same 44pt height so all three items share one baseline.
    //
    // Not tappable, by design — it is ambient context about the room, not a
    // control, and the feed's newBountiesPill below is the row-adjacent green CTA.
    huntersPill: {
      flexDirection: 'row',
      alignItems: 'center',
      height: SIZING.MIN_TOUCH_TARGET,
      paddingLeft: 8,
      paddingRight: 11,
      borderRadius: 999,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      // Never let the pill squeeze the bell or grow past its own content.
      flexShrink: 0,
    },
    // Count on the left, the two stacked words to its right. flex-start pins
    // the count's line box to the first line so it sits level with "Active"
    // rather than centring itself across both lines.
    huntersPillLabel: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginLeft: 3,
    },
    huntersPillWords: {
      marginLeft: 3,
    },
    huntersPillText: {
      // A step below the search placeholder: this is a stat chip, and the
      // smaller type is also what keeps all three items on one line on a
      // narrow screen. Explicit lineHeight so the two lines pack tightly
      // enough to clear the 44pt pill on large system font settings.
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '600',
      lineHeight: 14,
    },
    // The quieter half of the stack — smaller and secondary so the eye lands
    // on the count first and picks up "nearby" as the qualifier.
    huntersPillSubtext: {
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL - 2,
      fontWeight: '600',
      lineHeight: 12,
      letterSpacing: 0.2,
      opacity: 0.85,
    },
    // Only the number carries emphasis — the surrounding word stays secondary
    // so the stat scans at a glance without shouting.
    huntersPillCount: {
      color: t.text,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '800',
      lineHeight: 14,
    },
  })
}
