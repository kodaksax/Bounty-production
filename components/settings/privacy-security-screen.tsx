import { MaterialIcons } from '@expo/vector-icons';
import { ThemedButton } from 'components/themed/ThemedButton';
import { ThemedInput } from 'components/themed/ThemedInput';
import { SettingsRow } from 'components/ui/settings-row';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import { TotpEnrollmentModal } from 'components/ui/totp-enrollment-modal';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportAndShareUserData } from '../../lib/services/data-export-service';
import { deviceService, UserDevice } from '../../lib/services/device-service';
import { supabase } from '../../lib/supabase';
import { validateNewPassword } from '../../lib/utils/password-validation';
import { getSecureJSON, SecureKeys, setSecureJSON } from '../../lib/utils/secure-storage';

interface PrivacySecurityScreenProps { onBack: () => void }

interface PrivacyState {
  showProfilePublic: boolean;
  showCompletedBounties: boolean;
  passwordCurrent: string;
  passwordNew: string;
  passwordConfirm: string;
  sessions: UserDevice[];
  exporting: boolean;
}

// Use SecureStore for privacy settings as they contain sensitive security preferences
export const PrivacySecurityScreen: React.FC<PrivacySecurityScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [state, setState] = useState<PrivacyState>({
    showProfilePublic: true,
    showCompletedBounties: true,
    passwordCurrent: '',
    passwordNew: '',
    passwordConfirm: '',
    sessions: [],
    exporting: false,
  });
  const [loading, setLoading] = useState(true);

  // 2FA state managed via Supabase
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [isEnabling2FA, setIsEnabling2FA] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  // Enrollment modal: shows the QR code + manual secret + verification field.
  // We must render the QR before asking for a code; otherwise the user has no
  // way to register the account in their authenticator app.
  const [enrollModalVisible, setEnrollModalVisible] = useState(false);
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null);
  const [enrollTotp, setEnrollTotp] = useState<{ secret: string; uri: string; qr_code?: string } | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollVerifying, setEnrollVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getSecureJSON<Partial<PrivacyState>>(SecureKeys.PRIVACY_SETTINGS);
        if (stored) {
          setState(s => ({ ...s, ...stored }));
        }

        // Load 2FA status from Supabase
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          // Check email verification status
          setEmailVerified(Boolean(session.user.email_confirmed_at));

          // Check if 2FA is enabled via Supabase MFA
          const { data: factors } = await supabase.auth.mfa.listFactors();
          setTwoFactorEnabled((factors?.totp?.length ?? 0) > 0);

          // Load sessions
          const devices = await deviceService.getDevices();
          setState(s => ({ ...s, sessions: devices }));
        }
      } catch (e) {
        console.error('Failed to load privacy settings', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = async (patch: Partial<PrivacyState>) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      setSecureJSON(SecureKeys.PRIVACY_SETTINGS, next).catch(err => console.error('persist failed', err));
      return next;
    });
  };

  const changePassword = async () => {
    // Validate strong password using shared utility
    const validationError = validateNewPassword(state.passwordNew);
    if (validationError) {
      Alert.alert('Weak Password', validationError);
      return;
    }

    try {
      setLoading(true);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        Alert.alert('Error', 'Unable to verify current user.');
        setLoading(false);
        return;
      }

      // Verify current password by attempting to sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: state.passwordCurrent,
      });

      if (signInError) {
        Alert.alert('Incorrect Password', 'The current password you entered is incorrect.');
        setLoading(false);
        return;
      }

      // Update password using Supabase
      const { error } = await supabase.auth.updateUser({
        password: state.passwordNew
      });

      if (error) {
        Alert.alert('Error', error.message || 'Failed to update password.');
        return;
      }

      Alert.alert('Success', 'Your password has been updated successfully.');
      persist({ passwordCurrent: '', passwordNew: '', passwordConfirm: '' });

    } catch (err) {
      console.error('Password change error:', err);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const revokeSession = async (id: string) => {
    const success = await deviceService.revokeDevice(id);
    if (success) {
      setState(s => ({
        ...s,
        sessions: s.sessions.map(d => d.id === id ? { ...d, is_active: false } : d)
      }));
      Alert.alert('Device Revoked', 'The session has been revoked successfully.');
    } else {
      Alert.alert('Error', 'Failed to revoke session. Please try again.');
    }
  };

  const exportData = async () => {
    if (state.exporting) return;

    try {
      persist({ exporting: true });

      // Get current user ID
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        Alert.alert('Error', 'Unable to verify user. Please sign in again.');
        persist({ exporting: false });
        return;
      }

      // Export and share the data
      const result = await exportAndShareUserData(user.id);

      if (result.success) {
        Alert.alert(
          'Data Export Complete',
          'Your data has been exported successfully. You can now save or share it.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Export Failed', result.message);
      }
    } catch (err: unknown) {
      console.error('Data export error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to export data. Please try again.';
      Alert.alert('Error', errorMessage);
    } finally {
      persist({ exporting: false });
    }
  };

  const handleEnable2FA = async () => {
    // Check prerequisites
    if (!emailVerified) {
      Alert.alert(
        'Email Verification Required',
        'Please verify your email address before enabling two-factor authentication.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsEnabling2FA(true);

    try {
      // Enroll TOTP factor with Supabase MFA. The response contains the
      // `qr_code` (SVG), `secret`, and `uri` we need to show to the user
      // BEFORE asking for a verification code.
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator App',
      });

      if (error) throw error;

      if (data?.id && data.totp) {
        // `qr_code` is documented in supabase-js v2 enroll responses but the
        // typings have lagged across versions, so read it through a narrow
        // helper type instead of an unchecked cast.
        const totpPayload = data.totp as {
          secret: string;
          uri: string;
          qr_code?: string;
        };
        setEnrollFactorId(data.id);
        setEnrollTotp({
          secret: totpPayload.secret,
          uri: totpPayload.uri,
          qr_code: typeof totpPayload.qr_code === 'string' ? totpPayload.qr_code : undefined,
        });
        setEnrollError(null);
        setEnrollModalVisible(true);
      } else {
        throw new Error('Enrollment did not return a TOTP factor.');
      }
    } catch (error: any) {
      console.error('[privacy-security] Error enabling 2FA:', error);
      Alert.alert('Error', error?.message || 'Failed to enable 2FA. Please try again.');
      setIsEnabling2FA(false);
    }
  };

  /**
   * Verify the first code from the user's authenticator app to activate the
   * pending TOTP factor.  On success the modal closes and 2FA is enabled.
   * On failure the user can retry; on cancel the pending (unverified) factor
   * is unenrolled so it doesn't linger on the account.
   */
  const handleEnrollVerify = async (code: string) => {
    if (!enrollFactorId) return;
    setEnrollVerifying(true);
    setEnrollError(null);
    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollFactorId,
        code,
      });
      if (error) throw error;
      if (data) {
        setTwoFactorEnabled(true);
        setEnrollModalVisible(false);
        setEnrollFactorId(null);
        setEnrollTotp(null);
        Alert.alert('Success', 'Two-factor authentication has been enabled!');
      }
    } catch (error: any) {
      console.error('[privacy-security] Error verifying 2FA enrollment:', error);
      setEnrollError('Invalid code. Please try again.');
    } finally {
      setEnrollVerifying(false);
      setIsEnabling2FA(false);
    }
  };

  const handleEnrollCancel = async () => {
    const factorId = enrollFactorId;
    setEnrollModalVisible(false);
    setEnrollTotp(null);
    setEnrollFactorId(null);
    setEnrollError(null);
    setIsEnabling2FA(false);

    if (!factorId) return;

    try {
      // Best-effort cleanup: remove the unverified factor so it doesn't
      // remain pending on the user's account.
      await supabase.auth.mfa.unenroll({ factorId });
    } catch (error: any) {
      console.error('[privacy-security] Error cancelling 2FA setup:', error);
    }
  };

  const handleDisable2FA = async () => {
    Alert.alert(
      'Disable Two-Factor Authentication',
      'Are you sure you want to disable 2FA? This will reduce your account security.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: factors } = await supabase.auth.mfa.listFactors();

              if (factors && factors.totp && factors.totp.length > 0) {
                const factorId = factors.totp[0].id;
                const { error } = await supabase.auth.mfa.unenroll({ factorId });

                if (error) throw error;

                setTwoFactorEnabled(false);
                Alert.alert('Success', '2FA has been disabled');
              }
            } catch (error: any) {
              console.error('[privacy-security] Error disabling 2FA:', error);
              Alert.alert('Error', 'Failed to disable 2FA. Please try again.');
            }
          },
        },
      ]
    );
  };

  const twoFactorDescription = !emailVerified && !twoFactorEnabled
    ? 'Email verification required to enable 2FA.'
    : twoFactorEnabled
      ? 'Enabled — required when signing in on a new device.'
      : 'Require a second factor when signing in on a new device.';

  const switchProps = (value: boolean, onChange: (v: boolean) => void, label: string, disabled = false) => ({
    value,
    onValueChange: onChange,
    disabled,
    trackColor: { false: theme.border, true: theme.primary },
    thumbColor: theme.surface,
    ios_backgroundColor: theme.border,
    accessibilityLabel: label,
  });

  return (
    <View style={s.screen}>
      <TotpEnrollmentModal
        visible={enrollModalVisible}
        totp={enrollTotp}
        isVerifying={enrollVerifying}
        error={enrollError}
        onVerify={handleEnrollVerify}
        onCancel={handleEnrollCancel}
      />
      <SettingsScreenHeader icon="lock" title="Privacy & Security" onBack={onBack} />

      <ScrollView
        contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
      >
        <SettingsSection title="Password" description="Change your password to keep your account secure.">
          <View style={s.formBlock}>
            <Text style={s.fieldLabel}>Current Password</Text>
            <ThemedInput
              value={state.passwordCurrent}
              onChangeText={v => persist({ passwordCurrent: v })}
              secureTextEntry
              placeholder="••••••"
              accessibilityLabel="Current password"
              containerStyle={s.fieldSpacing}
            />
            <Text style={s.fieldLabel}>New Password</Text>
            <ThemedInput
              value={state.passwordNew}
              onChangeText={v => persist({ passwordNew: v })}
              secureTextEntry
              placeholder="At least 8 characters"
              accessibilityLabel="New password"
              containerStyle={s.fieldSpacing}
            />
            <Text style={s.fieldLabel}>Confirm New Password</Text>
            <ThemedInput
              value={state.passwordConfirm}
              onChangeText={v => persist({ passwordConfirm: v })}
              secureTextEntry
              placeholder="Repeat new password"
              accessibilityLabel="Confirm new password"
              containerStyle={s.fieldSpacing}
            />
            <ThemedButton
              variant="primary"
              label="Update Password"
              loading={loading}
              disabled={loading}
              onPress={changePassword}
            />
          </View>
        </SettingsSection>

        <SettingsSection title="Two-Factor Authentication">
          <SettingsRow
            icon="security"
            label="Authenticator App"
            description={twoFactorDescription}
            right={
              isEnabling2FA ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Switch {...switchProps(twoFactorEnabled, twoFactorEnabled ? handleDisable2FA : handleEnable2FA, 'Two-factor authentication', isEnabling2FA)} />
              )
            }
          />
        </SettingsSection>

        <SettingsSection title="Profile Visibility">
          <SettingsRow
            icon="visibility"
            label="Public profile"
            description="Let other users view your profile."
            right={<Switch {...switchProps(state.showProfilePublic, v => persist({ showProfilePublic: v }), 'Public profile visible')} />}
          />
          <SettingsRow
            icon="task-alt"
            label="Show completed bounties"
            description="Display your completed bounty history."
            right={<Switch {...switchProps(state.showCompletedBounties, v => persist({ showCompletedBounties: v }), 'Show completed bounties')} />}
          />
        </SettingsSection>

        <SettingsSection title="Session Management" description="Active devices signed in to your account.">
          {state.sessions.map(session => (
            <SettingsRow
              key={session.id}
              icon="devices"
              label={session.is_current ? `${session.device_name} · Current` : session.device_name}
              description={`${session.device_type} • ${new Date(session.last_active).toLocaleDateString()}`}
              right={
                session.is_active ? (
                  <TouchableOpacity
                    onPress={() => revokeSession(session.id)}
                    style={s.revokeButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Revoke ${session.device_name}`}
                  >
                    <Text style={s.revokeButtonText}>Revoke</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.revokedText}>Revoked</Text>
                )
              }
            />
          ))}
        </SettingsSection>

        <SettingsSection
          title="Data Export"
          description="Download a copy of all your personal data in JSON format. Includes profile, bounties, messages, transactions, and more."
        >
          <View style={s.formBlock}>
            <ThemedButton
              variant="primary"
              label="Export My Data"
              loading={state.exporting}
              disabled={state.exporting}
              onPress={exportData}
              leftIcon={<MaterialIcons name="file-download" size={16} color="#ffffff" />}
            />
          </View>
        </SettingsSection>
      </ScrollView>
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.background,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
    },
    formBlock: {
      padding: 16,
    },
    fieldLabel: {
      fontSize: 13,
      color: t.textSecondary,
      marginBottom: 6,
    },
    fieldSpacing: {
      marginBottom: 14,
    },
    revokeButton: {
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      minHeight: 32,
      justifyContent: 'center',
    },
    revokeButtonText: {
      color: t.error,
      fontSize: 12,
      fontWeight: '600',
    },
    revokedText: {
      color: t.textDisabled,
      fontSize: 12,
    },
  });
}
