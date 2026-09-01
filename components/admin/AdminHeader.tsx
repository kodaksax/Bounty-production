// components/admin/AdminHeader.tsx - Header component for admin screens
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAdmin } from '../../lib/admin-context';
import { ROUTES } from '../../lib/routes';

interface AdminHeaderProps {
  title: string;
  /** Optional context line under the title, e.g. the parent record. */
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  showBack?: boolean; // explicit control if needed
  /**
   * Where the back affordance should land when there is nothing to pop —
   * a screen opened via a deep link has no history, so `router.back()` there
   * either no-ops or drops the operator out of the admin section entirely.
   */
  backFallback?: string;
}

export function AdminHeader({
  title,
  subtitle,
  onBack,
  actions,
  showBack,
  backFallback,
}: AdminHeaderProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { setAdminTabEnabled } = useAdmin();

  const handleExitAdmin = useCallback(() => {
    Alert.alert(
      'Hide Admin Tab',
      'Hide the admin tab and return to the main app? You can re-enable it from Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'default',
          onPress: async () => {
            await setAdminTabEnabled(false);
            try {
              router.replace(ROUTES.TABS.BOUNTY_APP);
            } catch {}
          },
        },
      ]
    );
  }, [setAdminTabEnabled]);

  // Deep-link safe back: pop when there is history, otherwise navigate to the
  // declared parent (or the admin dashboard) so the operator is never stranded.
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack?.()) {
      router.back();
      return;
    }
    router.replace((backFallback ?? ROUTES.ADMIN.INDEX) as never);
  }, [onBack, backFallback]);

  const showBackButton = showBack ?? !!onBack;

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: theme.surface,
          borderBottomColor: theme.border,
          paddingTop: Math.max(insets.top, 12),
        },
      ]}
    >
      <View style={styles.row}>
        {showBackButton && (
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
              {title}
            </Text>
            <View
              style={[
                styles.adminBadge,
                {
                  backgroundColor: theme.isDark ? 'rgba(5,150,105,0.2)' : 'rgba(5,150,105,0.12)',
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text style={[styles.adminBadgeText, { color: theme.primary }]}>ADMIN</Text>
            </View>
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.actions}>
          {actions}
          <TouchableOpacity
            onPress={handleExitAdmin}
            style={[styles.iconButton, { backgroundColor: theme.surfaceSecondary }]}
            accessibilityLabel="Hide admin tab"
            accessibilityRole="button"
          >
            <MaterialIcons name="admin-panel-settings" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  titleContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    flexShrink: 1,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 6,
    borderRadius: 6,
  },
});
