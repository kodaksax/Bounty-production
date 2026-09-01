// app/(admin)/settings/security.tsx - Admin account security
//
// Rewritten, and this was the most dangerous screen in the console.
//
// Previously:
//   - "Enable Two-Factor Authentication" flipped a local boolean and announced
//     "Two-factor authentication has been enabled for your account." No factor
//     was ever enrolled. An administrator could reasonably believe their
//     account was protected by 2FA when it was not.
//   - "Revoke All Sessions" announced "All active sessions have been
//     terminated." without calling anything.
//   - Session timeout / IP restriction / password expiry / audit logging were
//     switches over nothing: no backend reads any of those values, and none
//     were persisted either.
//   - "Save Settings" alerted success and wrote nothing.
//
// Now every control on this screen reflects or changes real state:
//   - 2FA reads the account's actual enrolled TOTP factors via
//     supabase.auth.mfa.listFactors(), and enrolment runs the real
//     enroll -> challengeAndVerify sequence through the shared
//     TotpEnrollmentModal already used by the app's own security screen.
//   - Sign-out-everywhere calls supabase.auth.signOut({ scope: 'global' }).
//   - The policy switches that nothing enforces were removed. Where a policy
//     really is enforced (audit logging), it is shown as the fact it is, not
//     as a toggle the operator cannot actually change from a phone.
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import {
  AdminBadge,
  AdminButton,
  AdminError,
  AdminLoading,
  AdminPanel,
  AdminRow,
  AdminScreen,
  AdminSection,
} from '../../../components/admin/AdminUI';
import { TotpEnrollmentModal } from '../../../components/ui/totp-enrollment-modal';
import { useAppTheme } from '../../../hooks/use-app-theme';
import { ROUTES } from '../../../lib/routes';
import { supabase } from '../../../lib/supabase';

interface SecurityState {
  email?: string;
  emailVerified: boolean;
  totpFactorCount: number;
  lastSignInAt?: string;
}

export default function AdminSecuritySettingsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();

  const [state, setState] = useState<SecurityState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Real TOTP enrolment, reusing the same modal and the same
  // enroll -> challengeAndVerify sequence as the app's own security screen.
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null);
  const [enrollTotp, setEnrollTotp] = useState<{
    secret: string;
    uri: string;
    qr_code?: string;
  } | null>(null);
  const [enrollVerifying, setEnrollVerifying] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user) throw new Error('No active session.');

      // The real factor list — not a locally remembered boolean.
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;

      setState({
        email: session.user.email ?? undefined,
        emailVerified: Boolean(session.user.email_confirmed_at),
        // Only verified factors count. A pending enrolment that was never
        // confirmed does not protect the account.
        totpFactorCount: (factors?.totp ?? []).filter(
          (factor) => factor.status === 'verified'
        ).length,
        lastSignInAt: (session.user as { last_sign_in_at?: string }).last_sign_in_at,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read account security state');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Re-read on focus: the operator may have just enrolled a factor in the main
  // security screen and come straight back here.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const startEnrollment = useCallback(async () => {
    setIsEnrolling(true);
    setEnrollError(null);
    try {
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Admin authenticator',
      });
      if (enrollErr) throw enrollErr;
      if (!data?.id || !data.totp) {
        throw new Error('Enrollment did not return a TOTP factor.');
      }
      // `qr_code` is present in supabase-js v2 responses but has lagged in the
      // published typings across versions, so it is read through a narrow type
      // rather than an unchecked cast.
      const totp = data.totp as { secret: string; uri: string; qr_code?: string };
      setEnrollFactorId(data.id);
      setEnrollTotp({
        secret: totp.secret,
        uri: totp.uri,
        qr_code: typeof totp.qr_code === 'string' ? totp.qr_code : undefined,
      });
    } catch (err) {
      Alert.alert(
        'Could not start setup',
        err instanceof Error ? err.message : 'Two-factor enrolment could not be started.'
      );
    } finally {
      setIsEnrolling(false);
    }
  }, []);

  const verifyEnrollment = useCallback(
    async (code: string) => {
      if (!enrollFactorId) return;
      setEnrollVerifying(true);
      setEnrollError(null);
      try {
        const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
          factorId: enrollFactorId,
          code,
        });
        if (verifyErr) throw verifyErr;
        setEnrollFactorId(null);
        setEnrollTotp(null);
        // Re-read the factor list rather than assuming success — the badge on
        // this screen must reflect the server, not an optimistic flag.
        await load();
        Alert.alert('Two-factor enabled', 'This admin account now requires a second factor.');
      } catch {
        setEnrollError('That code was not accepted. Try the next one from your app.');
      } finally {
        setEnrollVerifying(false);
      }
    },
    [enrollFactorId, load]
  );

  const cancelEnrollment = useCallback(async () => {
    const factorId = enrollFactorId;
    setEnrollFactorId(null);
    setEnrollTotp(null);
    setEnrollError(null);
    if (!factorId) return;
    try {
      // Best-effort cleanup so an unverified factor does not linger.
      await supabase.auth.mfa.unenroll({ factorId });
    } catch {
      /* the factor stays pending; harmless and re-enrollable */
    }
  }, [enrollFactorId]);

  const handleRemove2FA = useCallback(() => {
    Alert.alert(
      'Remove two-factor authentication',
      'This account will no longer require a second factor to sign in. It can suspend users, ban accounts and read every profile on the platform.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
              if (listErr) throw listErr;
              const verified = (factors?.totp ?? []).filter((f) => f.status === 'verified');
              if (verified.length === 0) throw new Error('No enrolled factor was found.');
              for (const factor of verified) {
                const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
                  factorId: factor.id,
                });
                if (unenrollErr) throw unenrollErr;
              }
              await load();
              Alert.alert('Two-factor removed', 'This account no longer uses a second factor.');
            } catch (err) {
              Alert.alert(
                'Could not remove',
                err instanceof Error ? err.message : 'The factor could not be removed.'
              );
            }
          },
        },
      ]
    );
  }, [load]);

  const handleSignOutEverywhere = useCallback(() => {
    Alert.alert(
      'Sign out everywhere',
      'This signs your account out on every device, including this one. You will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out everywhere',
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            try {
              // Real revocation. `scope: 'global'` invalidates every refresh
              // token issued to this user, not just the local session.
              const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
              if (signOutError) throw signOutError;
              // No success alert: the auth listener tears the session down and
              // routes to sign-in, which is the confirmation.
            } catch (err) {
              setIsSigningOut(false);
              Alert.alert(
                'Sign-out failed',
                err instanceof Error ? err.message : 'Sessions could not be revoked.'
              );
            }
          },
        },
      ]
    );
  }, []);

  if (isLoading && !state) {
    return (
      <AdminScreen>
        <AdminHeader title="Security" showBack backFallback={ROUTES.ADMIN.SETTINGS.INDEX} />
        <AdminLoading label="Reading account security…" />
      </AdminScreen>
    );
  }

  if (error && !state) {
    return (
      <AdminScreen>
        <AdminHeader title="Security" showBack backFallback={ROUTES.ADMIN.SETTINGS.INDEX} />
        <AdminError
          title="Couldn't read security state"
          message="Your account's security settings could not be read. Your session may have expired."
          detail={error}
          onRetry={load}
        />
      </AdminScreen>
    );
  }

  const twoFactorOn = (state?.totpFactorCount ?? 0) > 0;

  return (
    <AdminScreen>
      <AdminHeader title="Security" showBack backFallback={ROUTES.ADMIN.SETTINGS.INDEX} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}>
        <AdminSection title="This account">
          <AdminPanel>
            <AdminRow label="Email" value={state?.email ?? '—'} icon="email" />
            <AdminRow
              label="Email verified"
              value={
                <AdminBadge
                  label={state?.emailVerified ? 'Verified' : 'Unverified'}
                  tone={state?.emailVerified ? 'success' : 'warning'}
                />
              }
              icon="verified-user"
            />
            <AdminRow
              label="Two-factor authentication"
              value={
                <AdminBadge
                  label={twoFactorOn ? 'On' : 'Off'}
                  tone={twoFactorOn ? 'success' : 'error'}
                />
              }
              icon="lock"
            />
            <AdminRow
              label="Role"
              value={<AdminBadge label="Administrator" tone="brand" />}
              icon="admin-panel-settings"
              last
            />
          </AdminPanel>
        </AdminSection>

        {!twoFactorOn ? (
          <View
            style={{
              padding: theme.spacing.lg,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.surfaceSecondary,
              borderLeftWidth: 3,
              borderLeftColor: theme.warning,
              marginBottom: theme.spacing.xl,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }}>
              Two-factor authentication is not enabled
            </Text>
            <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 4, lineHeight: 19 }}>
              This account can suspend users, ban accounts and view every profile on the platform.
              A second factor is strongly recommended.
            </Text>
          </View>
        ) : null}

        <AdminSection title="Actions">
          {twoFactorOn ? (
            <AdminButton
              label="Remove two-factor authentication"
              icon="lock-open"
              variant="secondary"
              onPress={handleRemove2FA}
              style={{ marginBottom: theme.spacing.sm }}
            />
          ) : (
            <AdminButton
              label="Set up two-factor authentication"
              icon="lock"
              variant="primary"
              loading={isEnrolling}
              onPress={startEnrollment}
              style={{ marginBottom: theme.spacing.sm }}
            />
          )}
          <AdminButton
            label="Sign out everywhere"
            icon="logout"
            variant="danger"
            loading={isSigningOut}
            onPress={handleSignOutEverywhere}
          />
        </AdminSection>

        <AdminSection title="Platform enforcement">
          <AdminPanel>
            <Text style={{ fontSize: 13, color: theme.textSecondary, lineHeight: 19 }}>
              Admin authorization is enforced on the server, not by this app. Every admin read and
              write goes through Postgres row-level security or a service-role Edge Function that
              re-verifies the {'`role`'} claim on your JWT. Hiding a button in this console does not
              grant or withhold access.
            </Text>
            <View style={{ height: theme.spacing.md }} />
            <AdminRow
              label="Account status changes"
              value="Logged to admin_action_log"
              icon="fact-check"
            />
            <AdminRow
              label="Audit trail"
              value="View"
              icon="history"
              onPress={() => router.push(ROUTES.ADMIN.AUDIT_LOGS as never)}
              last
            />
          </AdminPanel>
        </AdminSection>
      </ScrollView>

      <TotpEnrollmentModal
        visible={!!enrollTotp}
        totp={enrollTotp}
        isVerifying={enrollVerifying}
        error={enrollError}
        onVerify={verifyEnrollment}
        onCancel={cancelEnrollment}
      />
    </AdminScreen>
  );
}
