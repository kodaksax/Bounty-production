// app/(admin)/settings/general.tsx - Admin console preferences
//
// Rewritten. Previously this screen held seven preferences in component state
// and its "Save Settings" button showed "Your preferences have been updated
// successfully." without writing anything anywhere. Nothing consumed any of
// the values and they were discarded on unmount.
//
// Now: every preference on this screen is persisted (lib/admin/adminPreferences.ts)
// and read by a real consumer. Preferences that had no consumer and no way to
// get one were removed rather than left as decoration:
//   - "Dark Mode" is now the app's actual theme control, not a dead switch.
//   - "Show archived bounties" duplicated the Bounties status filter.
//   - "Timezone" had no formatting code reading it anywhere in the app.
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import {
  AdminButton,
  AdminLoading,
  AdminPanel,
  AdminRow,
  AdminScreen,
  AdminSection,
} from '../../../components/admin/AdminUI';
import { useAppTheme } from '../../../hooks/use-app-theme';
import {
  ADMIN_AUTO_REFRESH_OPTIONS,
  ADMIN_PAGE_SIZE_OPTIONS,
  useAdminPreferences,
  type AdminAutoRefreshOption,
  type AdminPageSizeOption,
} from '../../../lib/admin/adminPreferences';
import { ROUTES } from '../../../lib/routes';
import { ADMIN_BOUNTY_STATUSES, type AdminBountyStatus } from '../../../lib/types-admin';

function describeAutoRefresh(seconds: number): string {
  if (seconds === 0) return 'Off';
  if (seconds < 60) return `Every ${seconds}s`;
  return `Every ${seconds / 60} min`;
}

export default function AdminGeneralSettingsScreen() {
  const router = useRouter();
  const { theme, mode, setTheme } = useAppTheme();
  const { preferences, isLoading, update, reset } = useAdminPreferences();

  // Writes happen on change. There is no separate Save button precisely
  // because the old one is what made the screen dishonest.
  const apply = useCallback(
    async (patch: Parameters<typeof update>[0]) => {
      try {
        await update(patch);
      } catch (err) {
        Alert.alert(
          'Preference not saved',
          err instanceof Error
            ? err.message
            : 'The preference could not be written to this device.'
        );
      }
    },
    [update]
  );

  const pickPageSize = useCallback(() => {
    Alert.alert('Rows per page', 'How many rows should each admin list load at a time?', [
      ...ADMIN_PAGE_SIZE_OPTIONS.map((size) => ({
        text: String(size),
        onPress: () => void apply({ pageSize: size as AdminPageSizeOption }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [apply]);

  const pickAutoRefresh = useCallback(() => {
    Alert.alert('Dashboard auto-refresh', 'How often should the dashboard reload its metrics?', [
      ...ADMIN_AUTO_REFRESH_OPTIONS.map((seconds) => ({
        text: describeAutoRefresh(seconds),
        onPress: () => void apply({ autoRefreshSeconds: seconds as AdminAutoRefreshOption }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [apply]);

  const pickDefaultStatus = useCallback(() => {
    Alert.alert('Default bounty filter', 'Which status should the Bounties screen open on?', [
      { text: 'All', onPress: () => void apply({ defaultBountyStatus: 'all' }) },
      ...ADMIN_BOUNTY_STATUSES.map((status) => ({
        text: status.replace(/_/g, ' '),
        onPress: () => void apply({ defaultBountyStatus: status as AdminBountyStatus }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [apply]);

  const pickTheme = useCallback(() => {
    Alert.alert('Appearance', 'The console follows the app theme.', [
      { text: 'System', onPress: () => setTheme('system') },
      { text: 'Light', onPress: () => setTheme('light') },
      { text: 'Dark', onPress: () => setTheme('dark') },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [setTheme]);

  const confirmReset = useCallback(() => {
    Alert.alert('Reset preferences', 'Restore every console preference to its default?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            await reset();
            Alert.alert('Preferences reset', 'Console preferences are back to their defaults.');
          } catch (err) {
            Alert.alert(
              'Reset failed',
              err instanceof Error ? err.message : 'Preferences could not be reset.'
            );
          }
        },
      },
    ]);
  }, [reset]);

  if (isLoading) {
    return (
      <AdminScreen>
        <AdminHeader title="Console Preferences" showBack backFallback={ROUTES.ADMIN.SETTINGS.INDEX} />
        <AdminLoading label="Loading preferences…" />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader
        title="Console Preferences"
        showBack
        backFallback={ROUTES.ADMIN.SETTINGS.INDEX}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}>
        <Text
          style={{
            fontSize: 13,
            color: theme.textSecondary,
            lineHeight: 19,
            marginBottom: theme.spacing.xl,
          }}
        >
          These preferences apply to this device only and take effect immediately — there is
          nothing to save.
        </Text>

        <AdminSection title="Appearance">
          <AdminPanel>
            <AdminRow
              label="Theme"
              value={mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
              icon="brightness-6"
              onPress={pickTheme}
            />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: theme.text }}>Compact rows</Text>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  Fit more records on screen in list views
                </Text>
              </View>
              <Switch
                value={preferences.compactRows}
                onValueChange={(next) => void apply({ compactRows: next })}
                trackColor={{ false: theme.surfaceSecondary, true: theme.primary }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Compact rows"
              />
            </View>
          </AdminPanel>
        </AdminSection>

        <AdminSection title="Data loading">
          <AdminPanel>
            <AdminRow
              label="Rows per page"
              value={preferences.pageSize}
              icon="format-list-numbered"
              onPress={pickPageSize}
            />
            <AdminRow
              label="Dashboard auto-refresh"
              value={describeAutoRefresh(preferences.autoRefreshSeconds)}
              icon="autorenew"
              onPress={pickAutoRefresh}
            />
            <AdminRow
              label="Default bounty filter"
              value={
                preferences.defaultBountyStatus === 'all'
                  ? 'All'
                  : preferences.defaultBountyStatus.replace(/_/g, ' ')
              }
              icon="filter-list"
              onPress={pickDefaultStatus}
              last
            />
          </AdminPanel>
        </AdminSection>

        <AdminSection title="Reset">
          <AdminButton
            label="Reset to defaults"
            icon="restore"
            variant="secondary"
            onPress={confirmReset}
          />
        </AdminSection>

        <Text style={{ fontSize: 12, color: theme.textDisabled, textAlign: 'center' }}>
          Signed in as an administrator. Account-level security lives under Settings → Security.
        </Text>
      </ScrollView>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
});
