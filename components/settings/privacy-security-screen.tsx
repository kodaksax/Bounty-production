import { MaterialIcons } from '@expo/vector-icons';
import { BrandingLogo } from 'components/ui/branding-logo';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { exportAndShareUserData } from '../../lib/services/data-export-service';
import { deviceService, UserDevice } from '../../lib/services/device-service';
import { supabase } from '../../lib/supabase';
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
    if (!state.passwordCurrent || !state.passwordNew) {
      Alert.alert('Incomplete', 'Fill in current and new password.');
      return;
    }
    if (state.passwordNew !== state.passwordConfirm) {
      Alert.alert('Mismatch', 'New password & confirmation differ.');
      return;
    }

    // Validate strong password
    const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!strongPasswordPattern.test(state.passwordNew)) {
      Alert.alert(
        'Weak Password',
        'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@$!%*?&).'
      );
      return;
    }

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        Alert.alert('Error', 'Unable to verify current user.');
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
      // Enroll TOTP factor with Supabase MFA
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator App',
      });

      if (error) throw error;

      if (data) {
        // Show instructions for QR code setup
        Alert.alert(
          'Set Up Authenticator',
          '1. Open Google Authenticator or Authy\n2. Scan the QR code shown on the next screen\n3. Enter the 6-digit code to verify\n\nNote: The QR code will be displayed in a secure screen.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: async () => {
                // Unenroll if cancelled
                if (data.id) {
                  await supabase.auth.mfa.unenroll({ factorId: data.id });
                }
                setIsEnabling2FA(false);
              },
            },
            {
              text: 'Continue',
              onPress: () => {
                // TODO (Post-Launch): Navigate to dedicated QR code display screen
                // For now, proceed to code entry
                promptForVerificationCode(data.id);
              },
            },
          ]
        );
      }
    } catch (error: any) {
      console.error('[privacy-security] Error enabling 2FA:', error);
      Alert.alert('Error', error.message || 'Failed to enable 2FA. Please try again.');
      setIsEnabling2FA(false);
    }
  };

  const promptForVerificationCode = (factorId: string) => {
    // TODO (Post-Launch): Replace Alert.prompt with a proper modal/screen for better accessibility
    // Alert.prompt is not accessible to screen readers and doesn't work on Android
    // Consider creating a dedicated 2FA verification modal component
    Alert.prompt(
      'Enter Verification Code',
      'Enter the 6-digit code from your authenticator app',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: async () => {
            await supabase.auth.mfa.unenroll({ factorId });
            setIsEnabling2FA(false);
          },
        },
        {
          text: 'Verify',
          onPress: async (code?: string) => {
            if (!code) {
              setIsEnabling2FA(false);
              return;
            }
            await verifyAndEnable2FA(factorId, code);
          },
        },
      ],
      'plain-text'
    );
  };

  const verifyAndEnable2FA = async (factorId: string, code: string) => {
    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });

      if (error) throw error;

      if (data) {
        setTwoFactorEnabled(true);
        Alert.alert('Success', 'Two-factor authentication has been enabled!');
      }
    } catch (error: any) {
      console.error('[privacy-security] Error verifying 2FA:', error);
      Alert.alert(
        'Verification Failed',
        'Invalid code. Please try again or contact support.',
        [
          {
            text: 'Try Again',
            onPress: () => promptForVerificationCode(factorId),
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: async () => {
              await supabase.auth.mfa.unenroll({ factorId });
            },
          },
        ]
      );
    } finally {
      setIsEnabling2FA(false);
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