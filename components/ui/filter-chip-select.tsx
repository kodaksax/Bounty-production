/**
 * FilterChipSelect — a single filter chip that opens a themed bottom sheet of
 * options, so a secondary filter costs one chip in the row instead of a whole
 * carousel of its own.
 *
 * Generic over the option value, so the same component backs the bounty
 * feed's Distance chip today and Price / Date / Status chips later: pass
 * `options`, the current `value`, and the value that means "no filter"
 * (`neutralValue`) — the chip then labels itself with the active option and
 * falls back to `label` when the filter is off.
 *
 * Presentation reuses AppModal's `sheet` variant (see
 * docs/MODAL_ANIMATION_STANDARD.md) rather than hand-rolling a popover, which
 * is what keeps the open/close transition identical on iOS and Android.
 */
import { MaterialIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility'
import { hapticFeedback } from '../../lib/haptic-feedback'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { AppModal } from './app-modal'
import { FilterChip, type FilterChipIconName } from './filter-chip'

export interface FilterChipOption<T> {
  /** Full label shown in the sheet, e.g. "Within 10 miles". */
  label: string
  value: T
  /** Shorter label for the chip once selected, e.g. "10 mi". Defaults to `label`. */
  chipLabel?: string
  /** Optional secondary line under the option label in the sheet. */
  description?: string
}

export interface FilterChipSelectProps<T> {
  /** Chip label while the filter is off, and the sheet's title, e.g. "Distance". */
  label: string
  value: T
  options: FilterChipOption<T>[]
  onChange: (value: T) => void
  /** Leading icon on the chip. */
  icon?: FilterChipIconName
  /**
   * The value that means "no filter applied". While `value` equals it the chip
   * renders inactive and shows `label` instead of the option's label.
   */
  neutralValue?: T
  /** Optional one-liner under the sheet title. */
  description?: string
  /** Optional caveat pinned to the bottom of the sheet (e.g. a permission warning). */
  hint?: string
  testID?: string
}

export function FilterChipSelect<T>({
  label,
  value,
  options,
  onChange,
  icon,
  neutralValue,
  description,
  hint,
  testID,
}: FilterChipSelectProps<T>) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)

  const selected = useMemo(() => options.find((o) => Object.is(o.value, value)), [options, value])
  const isActive = !Object.is(value, neutralValue)
  const chipLabel = isActive ? selected?.chipLabel ?? selected?.label ?? label : label

  // Subtle pop when the selection changes, so the chip visibly acknowledges a
  // choice made behind the sheet that's simultaneously dismissing. Skips the
  // first run so chips don't animate on mount.
  const pop = useSharedValue(1)
  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    pop.value = withSequence(
      withTiming(0.94, { duration: 90 }),
      withSpring(1, { damping: 12, stiffness: 220 })
    )
  }, [value, pop])
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }))

  const handleSelect = useCallback(
    (next: T) => {
      hapticFeedback.selection()
      // Close first: the sheet's exit animation and the feed's reload then
      // overlap instead of queueing behind each other.
      setOpen(false)
      if (!Object.is(next, value)) onChange(next)
    },
    [onChange, value]
  )

  return (
    <>
      <Animated.View style={popStyle}>
        <FilterChip
          label={chipLabel}
          icon={icon}
          trailingIcon="expand-more"
          active={isActive}
          expanded={open}
          onPress={() => setOpen(true)}
          accessibilityLabel={
            isActive ? `${label} filter, ${selected?.label ?? chipLabel} selected` : `${label} filter, off`
          }
          accessibilityHint={`Opens the ${label.toLowerCase()} options`}
          testID={testID}
        />
      </Animated.View>

      <AppModal visible={open} onRequestClose={() => setOpen(false)} variant="sheet">
        <View style={[s.sheet, { paddingBottom: insets.bottom + SPACING.SCREEN_VERTICAL }]}>
          <View style={s.handle} />
          <Text style={s.title} accessibilityRole="header">
            {label}
          </Text>
          {description ? <Text style={s.description}>{description}</Text> : null}

          <ScrollView
            style={s.optionsScroll}
            contentContainerStyle={s.options}
            showsVerticalScrollIndicator={false}
            accessibilityRole="radiogroup"
          >
            {options.map((option, index) => {
              const isSelected = Object.is(option.value, value)
              return (
                <TouchableOpacity
                  key={`${String(option.value)}-${index}`}
                  style={[s.option, isSelected && s.optionSelected]}
                  activeOpacity={0.75}
                  onPress={() => handleSelect(option.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityHint={option.description}
                  accessibilityState={{ checked: isSelected, selected: isSelected }}
                >
                  <View style={s.optionText}>
                    <Text style={[s.optionLabel, isSelected && s.optionLabelSelected]}>{option.label}</Text>
                    {option.description ? <Text style={s.optionDescription}>{option.description}</Text> : null}
                  </View>
                  {isSelected ? (
                    <MaterialIcons
                      name="check"
                      size={SIZING.ICON_MEDIUM}
                      color={theme.primary}
                      accessibilityElementsHidden
                    />
                  ) : null}
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          {hint ? <Text style={s.hint}>{hint}</Text> : null}
        </View>
      </AppModal>
    </>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: t.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingTop: 12,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.border,
      alignSelf: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: TYPOGRAPHY.SIZE_HEADER,
      fontWeight: '700',
      color: t.text,
    },
    description: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      color: t.textSecondary,
      marginTop: 4,
    },
    // Caps the sheet on small screens / long option lists; short lists stay
    // hugged to their content.
    optionsScroll: { marginTop: 16, maxHeight: 380 },
    options: { paddingBottom: 4 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      paddingHorizontal: SPACING.CARD_PADDING,
      paddingVertical: 12,
      marginBottom: SPACING.COMPACT_GAP,
      minHeight: SIZING.MIN_TOUCH_TARGET,
    },
    optionSelected: {
      borderColor: t.primary,
      backgroundColor: t.surfaceSecondary,
    },
    optionText: { flex: 1, marginRight: SPACING.COMPACT_GAP },
    optionLabel: {
      fontSize: TYPOGRAPHY.SIZE_DEFAULT,
      fontWeight: '600',
      color: t.text,
    },
    optionLabelSelected: { color: t.primaryLight },
    optionDescription: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      color: t.textSecondary,
      marginTop: 2,
    },
    hint: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      color: t.textDisabled,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: 17,
    },
  })
}
