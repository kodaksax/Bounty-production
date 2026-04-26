import { MaterialIcons } from '@expo/vector-icons';
import { BrandingLogo } from 'components/ui/branding-logo';
import { MfaCodeModal } from 'components/ui/mfa-code-modal';
import { TotpEnrollmentModal } from 'components/ui/totp-enrollment-modal';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  // Modal state for cross-platform TOTP code entry (replaces Alert.prompt)
  const [mfaModalVisible, setMfaModalVisible] = useState(false);
  const [mfaModalFactorId, setMfaModalFactorId] = useState<string | null>(null);
  const [mfaModalError, setMfaModalError] = useState<string | null>(null);
  const [mfaVerifying, setMfaVerifying] = useState(false);
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

  const handleMfaModalVerify = async (code: string) => {
    if (!mfaModalFactorId) return;
    setMfaVerifying(true);
    setMfaModalError(null);
    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: mfaModalFactorId,
        code,
      });
      if (error) throw error;
      if (data) {
        setTwoFactorEnabled(true);
        setMfaModalVisible(false);
        Alert.alert('Success', 'Two-factor authentication has been enabled!');
      }
    } catch (error: any) {
      console.error('[privacy-security] Error verifying 2FA:', error);
      setMfaModalError('Invalid code. Please try again.');
    } finally {
      setMfaVerifying(false);
      setIsEnabling2FA(false);
    }
  };

  const handleMfaModalCancel = async () => {
    if (!mfaModalFactorId) {
      setMfaModalVisible(false);
      setIsEnabling2FA(false);
      return;
    }

    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaModalFactorId });
      if (error) throw error;
      setMfaModalVisible(false);
      setMfaModalFactorId(null);
      setIsEnabling2FA(false);
    } catch (error: any) {
      console.error('[privacy-security] Error cancelling 2FA setup:', error);
      Alert.alert('Error', 'Failed to cancel 2FA setup. Please try again.');
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

  return (
    <View className="flex-1 bg-emerald-600">
      <MfaCodeModal
        visible={mfaModalVisible}
        isLoading={mfaVerifying}
        error={mfaModalError}
        onVerify={handleMfaModalVerify}
        onCancel={handleMfaModalCancel}
      />
      <TotpEnrollmentModal
        visible={enrollModalVisible}
        totp={enrollTotp}
        isVerifying={enrollVerifying}
        error={enrollError}
        onVerify={handleEnrollVerify}
        onCancel={handleEnrollCancel}
      />
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <BrandingLogo size="small" />
        </View>
        <TouchableOpacity onPress={onBack} className="p-2" accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <Text className="text-xl font-semibold text-white mb-4">Privacy & Security Settings</Text>

        {/* Password */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="lock" title="Password" subtitle="Change your password to keep account secure." />
          <Text className="text-xs text-emerald-200 mb-1">Current Password</Text>
          <TextInput value={state.passwordCurrent} onChangeText={v => persist({ passwordCurrent: v })} secureTextEntry placeholder="••••••" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white mb-3" />
          <Text className="text-xs text-emerald-200 mb-1">New Password</Text>
          <TextInput value={state.passwordNew} onChangeText={v => persist({ passwordNew: v })} secureTextEntry placeholder="At least 8 characters" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white mb-3" />
          <Text className="text-xs text-emerald-200 mb-1">Confirm New Password</Text>
          <TextInput value={state.passwordConfirm} onChangeText={v => persist({ passwordConfirm: v })} secureTextEntry placeholder="Repeat new password" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white mb-4" />
          <TouchableOpacity onPress={changePassword} className="self-start px-4 py-2 rounded-md bg-emerald-700">
            <Text className="text-white text-xs font-medium">Update Password</Text>
          </TouchableOpacity>
        </View>

        {/* 2FA */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="security" title="Two-Factor Authentication" subtitle="Add an extra layer of protection." />
          <View className="flex-row items-center justify-between mt-1">
            <View className="flex-1 mr-4">
              <Text className="text-emerald-100 text-xs mb-1">Require a second factor when signing in on a new device.</Text>
              {twoFactorEnabled && (
                <View className="flex-row items-center mt-1">
                  <MaterialIcons name="check-circle" size={14} color="#10b981" />
                  <Text className="text-emerald-400 text-[10px] ml-1">Enabled</Text>
                </View>
              )}
              {!emailVerified && !twoFactorEnabled && (
                <Text className="text-yellow-500 text-[10px] mt-1">Email verification required</Text>
              )}
            </View>
            {isEnabling2FA ? (
              <ActivityIndicator size="small" color="#10b981" />
            ) : (
              <Switch
                value={twoFactorEnabled}
                onValueChange={twoFactorEnabled ? handleDisable2FA : handleEnable2FA}
                disabled={isEnabling2FA}
              />
            )}
          </View>
        </View>

        {/* Visibility */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="visibility" title="Visibility" subtitle="Control what other users can see." />
          <ToggleRow label="Public profile visible" value={state.showProfilePublic} onChange={v => persist({ showProfilePublic: v })} />
          <ToggleRow label="Show completed bounties" value={state.showCompletedBounties} onChange={v => persist({ showCompletedBounties: v })} />
        </View>

        {/* Sessions */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="devices" title="Session Management" subtitle="Active devices using your account." />
          {state.sessions.map(s => (
            <View key={s.id} className="flex-row items-center justify-between py-2 border-b border-emerald-700/40 last:border-b-0">
              <View className="flex-1 mr-3">
                <View className="flex-row items-center gap-2">
                  <Text className="text-white text-xs font-medium">{s.device_name}</Text>
                  {s.is_current && <View className="bg-emerald-500/20 px-1.5 py-0.5 rounded"><Text className="text-emerald-400 text-[10px]">Current</Text></View>}
                </View>
                <Text className="text-emerald-300 text-[10px]">{s.device_type} • {new Date(s.last_active).toLocaleDateString()}</Text>
              </View>
              {s.is_active ? (
                <TouchableOpacity onPress={() => revokeSession(s.id)} className="px-3 py-1 rounded-md bg-emerald-700">
                  <Text className="text-white text-[10px] font-medium">Revoke</Text>
                </TouchableOpacity>
              ) : (
                <Text className="text-[10px] text-emerald-400">Revoked</Text>
              )}
            </View>
          ))}
        </View>

        {/* Data Export - GDPR Compliance */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader
            icon="file-download"
            title="Data Export (GDPR)"
            subtitle="Download a copy of all your personal data in JSON format. Includes profile, bounties, messages, transactions, and more."
          />
          <TouchableOpacity disabled={state.exporting} onPress={exportData} className={`self-start px-4 py-2 rounded-md ${state.exporting ? 'bg-emerald-900 opacity-60' : 'bg-emerald-700'}`}>
            <Text className="text-white text-xs font-medium">{state.exporting ? 'Preparing Export…' : 'Export My Data'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};


const SectionHeader = ({ icon, title, subtitle }: { icon: any; title: string; subtitle: string }) => (
  <View className="mb-3">
    <View className="flex-row items-center mb-1">
      <MaterialIcons name={icon} size={18} color="#34d399" />
      <Text className="ml-2 text-white font-medium text-sm">{title}</Text>
    </View>
    <Text className="text-emerald-300 text-[11px] leading-4">{subtitle}</Text>
  </View>
);

const ToggleRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View className="flex-row items-center justify-between py-2">
    <Text className="text-emerald-100 text-xs flex-1 mr-4">{label}</Text>
    <Switch value={value} onValueChange={onChange} />
  </View>
);