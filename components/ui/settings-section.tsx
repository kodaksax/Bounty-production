import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

interface SettingsSectionProps {
  /** Uppercase eyebrow label above the grouped card (e.g. "ACCOUNT"). */
  title?: string;
  /** Helper copy shown below the title, above the card. */
  description?: string;
  /** Small print below the card (e.g. a data-handling disclaimer). */
  footer?: string;
  /** Trailing action next to the title (e.g. an "+ Add" button). Requires `title`. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Groups related SettingsRow items into a single rounded card with hairline
 * dividers between rows, instead of one bordered card per row. Falsy children
 * are skipped so conditional rows don't leave a stray divider behind.
 */
export function SettingsSection({ title, description, footer, headerRight, children, style }: SettingsSectionProps) {
  const { theme } = useAppThemeContext();
  const s = makeStyles(theme);
  const items = React.Children.toArray(children).filter(Boolean);

  if (items.length === 0) return null;

  return (
    <View style={[s.wrapper, style]}>
      {title && headerRight ? (
        <View style={s.titleRow}>
          <Text style={[s.title, s.titleInRow]}>{title}</Text>
          {headerRight}
        </View>
      ) : title ? (
        <Text style={s.title}>{title}</Text>
      ) : null}
      {description ? <Text style={s.description}>{description}</Text> : null}
      <View style={s.card}>
        {items.map((child, index) => (
          <React.Fragment key={index}>
            {child}
            {index < items.length - 1 && <View style={s.divider} />}
          </React.Fragment>
        ))}
      </View>
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    wrapper: {
      marginBottom: 24,
    },
    title: {
      fontSize: 12,
      fontWeight: '700',
      color: t.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 8,
      marginLeft: 4,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    titleInRow: {
      marginBottom: 0,
    },
    description: {
      fontSize: 13,
      lineHeight: 18,
      color: t.textSecondary,
      marginBottom: 12,
      marginLeft: 4,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.border,
      marginLeft: 56,
    },
    footer: {
      fontSize: 12,
      lineHeight: 16,
      color: t.textDisabled,
      marginTop: 8,
      marginLeft: 4,
    },
  });
}
