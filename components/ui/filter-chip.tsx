/**
 * FilterChip — the shared pill used by the app's horizontal filter rows.
 *
 * Two kinds of chip sit side by side in the same row and must be visually
 * indistinguishable: plain toggles (the bounty feed's category chips) and
 * chips that open a picker (see `FilterChipSelect` — Distance today, Price /
 * Date / Status later). Owning the presentation here is what keeps them in
 * sync: metrics, active treatment, haptics and the 44pt touch-target
 * guarantee are defined once.
 */
import { MaterialIcons } from '@expo/vector-icons'
import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native'
import { SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility'
import { hapticFeedback } from '../../lib/haptic-feedback'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'

export type FilterChipIconName = React.ComponentProps<typeof MaterialIcons>['name']

export interface FilterChipProps {
  label: string
  onPress: () => void
  /** Leading icon. */
  icon?: FilterChipIconName
  /** Trailing icon — chips that open a picker pass a chevron. */
  trailingIcon?: FilterChipIconName
  active?: boolean
  /** For picker chips: reflects whether the picker is currently open. */
  expanded?: boolean
  accessibilityLabel?: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function FilterChip({
  label,
  onPress,
  icon,
  trailingIcon,
  active = false,
  expanded,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: FilterChipProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeChipStyles(theme), [theme])
  const iconColor = active ? theme.primary : theme.textSecondary

  return (
    <TouchableOpacity
      onPress={() => {
        // Selection haptic rather than impact: these are picker-style choices,
        // not commits.
        hapticFeedback.selection()
        onPress()
      }}
      activeOpacity={0.75}
      style={[s.chip, active && s.chipActive, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active, ...(expanded === undefined ? {} : { expanded }) }}
      testID={testID}
    >
      {icon ? (
        <MaterialIcons
          name={icon}
          size={SIZING.ICON_SMALL}
          color={iconColor}
          style={s.leadingIcon}
          accessibilityElementsHidden
        />
      ) : null}
      <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>
        {label}
      </Text>
      {trailingIcon ? (
        <MaterialIcons
          name={trailingIcon}
          size={SIZING.ICON_SMALL}
          color={iconColor}
          style={s.trailingIcon}
          accessibilityElementsHidden
        />
      ) : null}
    </TouchableOpacity>
  )
}

function makeChipStyles(t: AppTheme) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 14,
      borderRadius: 999,
      marginRight: SPACING.COMPACT_GAP,
      minHeight: SIZING.MIN_TOUCH_TARGET,
    },
    chipActive: {
      backgroundColor: t.surface,
      borderColor: t.primary,
    },
    leadingIcon: { marginRight: SPACING.COMPACT_GAP },
    trailingIcon: { marginLeft: 4, marginRight: -2 },
    label: {
      color: t.text,
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      fontWeight: '600',
    },
    labelActive: {
      color: t.primaryLight,
    },
  })
}
