// app/(admin)/settings/index.tsx - Admin Settings Hub
//
// Two of the four destinations this hub used to advertise were placeholders
// and have been removed rather than restyled:
//   - "Notification Settings" persisted nothing and no backend read any of its
//     values; there is no admin alerting system for it to configure.
//   - "Audit Log" pointed at app/(admin)/settings/audit-log.tsx, which
//     rendered a hardcoded seven-row array of fabricated entries and shadowed
//     the real, Supabase-backed audit viewer at /(admin)/audit-logs. This hub
//     now links to the real one.
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import {
  AdminLinkRow,
  AdminPanel,
  AdminScreen,
  AdminSection,
} from '../../../components/admin/AdminUI';
import { useAppTheme } from '../../../hooks/use-app-theme';
import { ROUTES } from '../../../lib/routes';

export default function AdminSettingsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const go = (route: string) => router.push(route as never);

  return (
    <AdminScreen>
      <AdminHeader title="Settings" showBack backFallback={ROUTES.ADMIN.INDEX} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}>
        <AdminSection title="Console">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="tune"
              label="Console preferences"
              detail="Theme, rows per page, auto-refresh, default filters"
              onPress={() => go(ROUTES.ADMIN.SETTINGS.GENERAL)}
            />
            <AdminLinkRow
              icon="security"
              label="Security"
              detail="Two-factor authentication and active sessions"
              onPress={() => go(ROUTES.ADMIN.SETTINGS.SECURITY)}
              last
            />
          </AdminPanel>
        </AdminSection>

        <AdminSection title="Records">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="history"
              label="Audit log"
              detail="Every recorded admin and system action"
              onPress={() => go(ROUTES.ADMIN.AUDIT_LOGS)}
              last
            />
          </AdminPanel>
        </AdminSection>

        <AdminSection title="Help">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="help-outline"
              label="Support"
              detail="Operator guidance and product feedback"
              onPress={() => go(ROUTES.ADMIN.SUPPORT.INDEX)}
              last
            />
          </AdminPanel>
        </AdminSection>

        <Text
          style={{
            fontSize: 12,
            color: theme.textDisabled,
            textAlign: 'center',
            marginTop: theme.spacing.lg,
          }}
        >
          Console preferences are stored on this device. Account security applies everywhere you
          sign in.
        </Text>
      </ScrollView>
    </AdminScreen>
  );
}
