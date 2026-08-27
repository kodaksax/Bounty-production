// components/admin/AdminUI.tsx - Shared, themed building blocks for the admin console.
//
// Every admin screen previously drew itself from a private StyleSheet full of
// hardcoded legacy colours (`#1a3d2e` page, `#2d5240` cards, `#00dc50` accent,
// `#fffef5` text) while the rest of the app had already moved to the
// `useAppTheme()` token set in lib/themes/. That is why the admin section
// looked like a different product, and why AdminHeader (already on the
// canonical `#0B0F14`) sat on top of a green body.
//
// These components own the loading / empty / error / list-footer states that
// each screen used to reimplement, so the states stay consistent and every
// screen picks up light mode for free.
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useAppTheme } from '../../hooks/use-app-theme';
import type { AppTheme } from '../../lib/themes/types';

type IconName = keyof typeof MaterialIcons.glyphMap;

/* ─────────────────────────── Screen shell ─────────────────────────── */

export function AdminScreen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: theme.background }, style]}>{children}</View>
  );
}

/** Section wrapper with an optional title and trailing action. */
export function AdminSection({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[{ marginBottom: theme.spacing.xl }, style]}>
      {(title || action) && (
        <View style={styles.sectionHeader}>
          {title ? (
            <Text
              style={{
                flex: 1,
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold,
                color: theme.text,
              }}
            >
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

/* ─────────────────────────── Production states ─────────────────────────── */

/** The one loading treatment used by every admin screen. */
export function AdminLoading({ label = 'Loading…' }: { label?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={{ marginTop: theme.spacing.md, color: theme.textSecondary, fontSize: 14 }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Empty state. `title` says what is empty and `description` says why — a bare
 * "No results" leaves an operator unsure whether the filter is wrong or the
 * data really is absent.
 */
export function AdminEmpty({
  icon = 'inbox',
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.centered}>
      <MaterialIcons name={icon} size={56} color={theme.textDisabled} />
      <Text
        style={{
          marginTop: theme.spacing.lg,
          fontSize: theme.typography.fontSize.lg,
          fontWeight: theme.typography.fontWeight.semibold,
          color: theme.text,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={{
            marginTop: theme.spacing.sm,
            fontSize: 14,
            color: theme.textSecondary,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <AdminButton label={actionLabel} onPress={onAction} variant="secondary" style={{ marginTop: theme.spacing.xl }} />
      ) : null}
    </View>
  );
}

/**
 * Error state.
 *
 * `message` is shown to the operator, so callers pass an already-sanitised
 * message. Raw driver text (`PGRST204: column "x" does not exist`) is useful
 * to an operator debugging the console but should not leak schema detail into
 * a screenshot, so it is rendered as collapsed secondary detail rather than
 * as the headline.
 */
export function AdminError({
  title = 'Something went wrong',
  message,
  detail,
  onRetry,
}: {
  title?: string;
  message?: string | null;
  detail?: string | null;
  onRetry?: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.centered}>
      <MaterialIcons name="error-outline" size={56} color={theme.error} />
      <Text
        style={{
          marginTop: theme.spacing.lg,
          fontSize: theme.typography.fontSize.lg,
          fontWeight: theme.typography.fontWeight.semibold,
          color: theme.text,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            marginTop: theme.spacing.sm,
            fontSize: 14,
            color: theme.textSecondary,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          {message}
        </Text>
      ) : null}
      {detail ? (
        <Text
          style={{
            marginTop: theme.spacing.sm,
            fontSize: 12,
            color: theme.textDisabled,
            textAlign: 'center',
          }}
          numberOfLines={3}
        >
          {detail}
        </Text>
      ) : null}
      {onRetry ? (
        <AdminButton label="Retry" icon="refresh" onPress={onRetry} style={{ marginTop: theme.spacing.xl }} />
      ) : null}
    </View>
  );
}

/**
 * Non-blocking error banner, for when a screen already has data on it and a
 * background refresh failed. Blanking the screen in that case would be worse
 * than showing slightly stale rows with a warning.
 */
export function AdminErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: withAlpha(theme.error, 0.12),
        borderColor: withAlpha(theme.error, 0.35),
        borderWidth: 1,
        borderRadius: theme.radius.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        marginHorizontal: theme.spacing.lg,
        marginTop: theme.spacing.md,
      }}
      accessibilityRole="alert"
    >
      <MaterialIcons name="warning-amber" size={18} color={theme.error} />
      <Text style={{ flex: 1, color: theme.error, fontSize: 13 }}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry">
          <MaterialIcons name="refresh" size={18} color={theme.error} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ─────────────────────────── Cards & rows ─────────────────────────── */

export function AdminPanel({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const { theme } = useAppTheme();
  const panelStyle: ViewStyle = {
    backgroundColor: theme.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
  };
  if (onPress) {
    return (
      <TouchableOpacity style={[panelStyle, style]} onPress={onPress} accessibilityRole="button">
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[panelStyle, style]}>{children}</View>;
}

/** Label/value row. `mono` is for identifiers, `onPress` turns it into a link. */
export function AdminRow({
  label,
  value,
  icon,
  mono,
  onPress,
  last,
}: {
  label: string;
  value: React.ReactNode;
  icon?: IconName;
  mono?: boolean;
  onPress?: () => void;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const content = (
    <>
      <View style={styles.rowLabel}>
        {icon ? <MaterialIcons name={icon} size={16} color={theme.textSecondary} /> : null}
        <Text style={{ fontSize: 14, color: theme.textSecondary }}>{label}</Text>
      </View>
      <View style={styles.rowValue}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <Text
            style={{
              fontSize: mono ? 12 : 15,
              fontWeight: theme.typography.fontWeight.semibold,
              color: onPress ? theme.primary : theme.text,
              fontFamily: mono ? monoFont : undefined,
              textAlign: 'right',
            }}
            numberOfLines={1}
            ellipsizeMode={mono ? 'middle' : 'tail'}
          >
            {value}
          </Text>
        ) : (
          value
        )}
        {onPress ? <MaterialIcons name="chevron-right" size={18} color={theme.primary} /> : null}
      </View>
    </>
  );

  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  };

  if (onPress) {
    return (
      <TouchableOpacity
        style={rowStyle}
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={`${label}: ${typeof value === 'string' ? value : ''}`}
      >
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={rowStyle}>{content}</View>;
}

/**
 * A navigation row to a related record — the primitive that turns the admin
 * console from a set of isolated screens into a connected one.
 */
export function AdminLinkRow({
  icon,
  label,
  detail,
  count,
  onPress,
  disabled,
  disabledHint,
  last,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  count?: number;
  onPress: () => void;
  disabled?: boolean;
  disabledHint?: string;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const inactive = disabled || (count != null && count === 0);
  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        opacity: inactive ? 0.45 : 1,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.border,
      }}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive }}
    >
      <MaterialIcons name={icon} size={20} color={inactive ? theme.textDisabled : theme.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>{label}</Text>
        {(inactive && disabledHint) || detail ? (
          <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
            {inactive && disabledHint ? disabledHint : detail}
          </Text>
        ) : null}
      </View>
      {count != null ? (
        <View
          style={{
            minWidth: 24,
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: theme.radius.full,
            backgroundColor: count > 0 ? withAlpha(theme.primary, 0.15) : theme.surfaceSecondary,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: count > 0 ? theme.primary : theme.textDisabled,
              textAlign: 'center',
            }}
          >
            {count}
          </Text>
        </View>
      ) : null}
      {!inactive ? <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} /> : null}
    </TouchableOpacity>
  );
}

/* ─────────────────────────── Controls ─────────────────────────── */

export type AdminButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning';

export function AdminButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  style,
  textStyle,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: AdminButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const { theme } = useAppTheme();
  const { bg, fg, border } = buttonColors(theme, variant);
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          minHeight: 44,
          paddingHorizontal: theme.spacing.xl,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.md,
          backgroundColor: bg,
          borderWidth: border ? 1 : 0,
          borderColor: border,
          opacity: isDisabled ? 0.5 : 1,
        },
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <MaterialIcons name={icon} size={18} color={fg} /> : null}
          <Text style={[{ color: fg, fontSize: 14, fontWeight: '600' }, textStyle]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function buttonColors(theme: AppTheme, variant: AdminButtonVariant) {
  switch (variant) {
    case 'danger':
      return { bg: theme.error, fg: '#FFFFFF', border: '' };
    case 'warning':
      // Amber needs dark text for contrast in both light and dark mode, so
      // this is deliberately not theme-dependent.
      return { bg: theme.warning, fg: '#111827', border: '' };
    case 'secondary':
      return { bg: 'transparent', fg: theme.text, border: theme.border };
    case 'primary':
    default:
      return { bg: theme.primary, fg: '#FFFFFF', border: '' };
  }
}

/** Debounce-friendly search field. The caller owns the value. */
export function AdminSearchBar({
  value,
  onChangeText,
  placeholder = 'Search…',
  autoFocus,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.surfaceSecondary,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        marginHorizontal: theme.spacing.lg,
        marginTop: theme.spacing.md,
        minHeight: 44,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <MaterialIcons name="search" size={20} color={theme.textSecondary} />
      <TextInput
        style={{ flex: 1, color: theme.text, fontSize: 15, paddingVertical: 10 }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {value.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="close" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Horizontally scrolling filter chips. */
export function AdminFilterChips<T extends string>({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelFor?: (option: T) => string;
}) {
  const { theme } = useAppTheme();
  const label = labelFor ?? ((option: T) => option.replace(/_/g, ' '));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        gap: theme.spacing.sm,
      }}
      style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }}
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(option)}
            style={{
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.full,
              backgroundColor: active ? theme.primary : theme.surfaceSecondary,
              borderWidth: 1,
              borderColor: active ? theme.primary : theme.border,
              minHeight: 34,
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label(option)}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                textTransform: 'capitalize',
                color: active ? '#FFFFFF' : theme.textSecondary,
              }}
            >
              {label(option)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ─────────────────────────── Badges ─────────────────────────── */

export function AdminBadge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'brand' | 'completed' | 'cancelled';
  icon?: IconName;
}) {
  const { theme } = useAppTheme();
  const color = badgeColor(theme, tone);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.radius.sm,
        backgroundColor: withAlpha(color, 0.15),
        borderWidth: 1,
        borderColor: withAlpha(color, 0.4),
      }}
    >
      {icon ? <MaterialIcons name={icon} size={12} color={color} /> : null}
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function badgeColor(theme: AppTheme, tone: string): string {
  switch (tone) {
    case 'success':
      return theme.success;
    case 'warning':
      return theme.warning;
    case 'error':
      return theme.error;
    case 'info':
      return theme.info;
    case 'brand':
      return theme.primary;
    case 'completed':
      return theme.completed;
    case 'cancelled':
      return theme.cancelled;
    default:
      return theme.textSecondary;
  }
}

/* ─────────────────────────── List helpers ─────────────────────────── */

/**
 * Footer for a paginated list: shows how much of the filtered set is on
 * screen, and loads the next page. Screens used to render every row the query
 * returned with no ceiling at all.
 */
export function AdminListFooter({
  shown,
  total,
  hasMore,
  isLoadingMore,
  onLoadMore,
  noun = 'results',
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  noun?: string;
}) {
  const { theme } = useAppTheme();
  if (shown === 0) return null;
  return (
    <View style={{ paddingVertical: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.md }}>
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>
        Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
      </Text>
      {hasMore ? (
        <AdminButton
          label="Load more"
          variant="secondary"
          loading={isLoadingMore}
          onPress={onLoadMore}
        />
      ) : null}
    </View>
  );
}

/** Compact metric tile used on the dashboard. */
export function AdminMetricTile({
  label,
  value,
  icon,
  tone = 'neutral',
  onPress,
  hint,
}: {
  label: string;
  value: string | number;
  icon?: IconName;
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'brand';
  onPress?: () => void;
  hint?: string;
}) {
  const { theme } = useAppTheme();
  const accent = badgeColor(theme, tone === 'neutral' ? 'brand' : tone);
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? <MaterialIcons name={icon} size={16} color={accent} /> : null}
        <Text style={{ fontSize: 12, color: theme.textSecondary, flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text, marginTop: 6 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      {hint ? (
        <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </>
  );

  const tileStyle: ViewStyle = {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: theme.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: theme.spacing.lg,
  };

  if (onPress) {
    return (
      <TouchableOpacity
        style={tileStyle}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={tileStyle}>{body}</View>;
}

/* ─────────────────────────── Utilities ─────────────────────────── */

/**
 * Apply an alpha channel to a theme token. Tokens are `#RRGGBB`; anything
 * already carrying alpha (or a named colour) is returned untouched so a caller
 * can pass an rgba() value through without corrupting it.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Shorten a UUID for display without losing its identifying head/tail. */
export function shortId(id?: string | null): string {
  if (!id) return '—';
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function formatMoney(amount?: number | null): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function formatRelative(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 0) return date.toLocaleDateString();
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/** Hook form, for screens that build their own StyleSheet from tokens. */
export function useAdminStyles<T extends Record<string, unknown>>(
  factory: (theme: AppTheme) => T
): T {
  const { theme } = useAppTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

const monoFont = undefined; // RN has no guaranteed cross-platform mono family; size carries the distinction.

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    minHeight: 280,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'flex-end',
  },
});
