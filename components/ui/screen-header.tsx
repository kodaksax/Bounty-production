/**
 * ScreenHeader — Standardized screen-level header component
 *
 * Replaces the per-screen manual header implementations that previously used
 * hardcoded `insets.top` offsets.  All tab screens should use this component
 * to guarantee consistent vertical positioning, font sizes, and spacing.
 *
 * Usage:
 *   <ScreenHeader
 *     title="Postings"
 *     icon={<MaterialIcons name="list" size={24} color={colors.primary[300]} />}
 *     rightContent={<WalletBalanceButton />}
 *   />
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HEADER_LAYOUT, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility';
import { colors } from '../../lib/theme';

export interface ScreenHeaderProps {
  /** Primary screen title text */
  title: string;
  /** Optional icon displayed to the left of the title */
  icon?: React.ReactNode;
  /** Optional content displayed on the right side (e.g. WalletBalanceButton, NotificationsBell) */
  rightContent?: React.ReactNode;
  /** Optional subtitle shown below the title */
  subtitle?: string;
  /** Override the background color (defaults to colors.background.secondary) */
  backgroundColor?: string;
}

/**
 * Consistent screen header that adapts to device safe-area insets.
 *
 * All interactive elements passed via `rightContent` are positioned at the
 * same vertical level across every screen — icon/title on the left, actions
 * on the right.
 */
export function ScreenHeader({
  title,
  icon,
  rightContent,
  subtitle,
  backgroundColor,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + SPACING.HEADER_VERTICAL,
          backgroundColor: backgroundColor ?? colors.background.secondary,
        },
      ]}
    >
      <View style={styles.row}>
        {/* Left: icon + title */}
        <View style={styles.titleRow}>
          {icon && (
            <View
              style={styles.iconWrap}
              accessible={false}
              importantForAccessibility="no"
            >
              {icon}
            </View>
          )}
          <View>
            <Text
              style={styles.title}
              accessibilityRole="header"
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Right: wallet balance, notifications, etc. */}
        {rightContent ? (
          <View style={styles.right}>{rightContent}</View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingBottom: SPACING.HEADER_VERTICAL,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: HEADER_LAYOUT.collapsedHeight - SPACING.HEADER_VERTICAL * 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_LAYOUT.iconToTitleGap,
    flex: 1,
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
