/**
 * Security Settings Component
 * Manages 2FA, password, and security preferences for users
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { SettingsRow } from '../ui/settings-row';
import { SettingsScreenHeader } from '../ui/settings-screen-header';
import { SettingsSection } from '../ui/settings-section';
import { MfaCodeModal } from '../ui/mfa-code-modal';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface SecuritySettingsProps {
  onBack: () => void;
}

export function SecuritySettings({ onBack }: SecuritySettingsProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [isEnabling2FA, setIsEnabling2FA] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  // Modal state for cross-platform TOTP code entry
  const [mfaModalVisible, setMfaModalVisible] = useState(false);
  const [mfaModalFactorId, setMfaModalFactorId] = useState<string | null>(null);
  const [mfaModalError, setMfaModalError] = useState<string | null>(null);
  const [mfaVerifying, setMfaVerifying] = useState(false);

  useEffect(() => {
    loadSecuritySettings();
  }, []);

  const loadSecuritySettings = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        // Check verification status
        setEmailVerified(Boolean(session.user.email_confirmed_at));
        setPhoneVerified(Boolean(session.user.user_metadata?.phone_verified));

        // Check if 2FA is enabled via Supabase MFA
        const { data: factors } = await supabase.auth.mfa.listFactors();
        setTwoFactorEnabled((factors?.totp?.length ?? 0) > 0);
      }
    } catch (error) {
      console.error('[security-settings] Error loading settings:', error);
    } finally {
      setLoading(false);
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
        // Show instructions without exposing secret directly
        // In production, display QR code in a modal or dedicated screen
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
                // The QR code URI can be generated from data.totp.qr_code or data.totp.uri
                promptForVerificationCode(data.id);
              },
            },
          ]
        );
      }
    } catch (error: any) {
      console.error('[security-settings] Error enabling 2FA:', error);
      Alert.alert('Error', error.message || 'Failed to enable 2FA. Please try again.');
      setIsEnabling2FA(false);
    }
  };

  const promptForVerificationCode = (factorId: string) => {
    setMfaModalFactorId(factorId);
    setMfaModalError(null);
    setMfaModalVisible(true);
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
      console.error('[security-settings] Error verifying 2FA:', error);
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
      console.error('[security-settings] Error cancelling 2FA setup:', error);
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
              console.error('[security-settings] Error disabling 2FA:', error);
              Alert.alert('Error', 'Failed to disable 2FA. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleChangePassword = () => {
    Alert.alert(
      'Change Password',
      'You will receive an email with instructions to reset your password.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Email',
          onPress: async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user?.email) throw new Error('No email found');

              const { error } = await supabase.auth.resetPasswordForEmail(user.email);
              if (error) throw error;

              Alert.alert('Email Sent', 'Check your inbox for password reset instructions.');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to send reset email');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const handleToggle2FA = twoFactorEnabled ? handleDisable2FA : handleEnable2FA;

  return (
    <View style={s.container}>
      <MfaCodeModal
        visible={mfaModalVisible}
        isLoading={mfaVerifying}
        error={mfaModalError}
        onVerify={handleMfaModalVerify}
        onCancel={handleMfaModalCancel}
      />
      <SettingsScreenHeader icon="security" title="Security" onBack={onBack} />
      <ScrollView className="px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}>
        {/* Verification Status */}
        <SettingsSection title="Account Verification">
          <SettingsRow
            icon="mail"
            label="Email Verification"
            description={emailVerified ? 'Verified' : 'Not verified'}
            right={
              <MaterialIcons
                name={emailVerified ? 'check-circle' : 'cancel'}
                size={22}
                color={emailVerified ? theme.success : theme.error}
              />
            }
          />
          <SettingsRow
            icon="phone-iphone"
            label="Phone Verification"
            description={phoneVerified ? 'Verified' : 'Not verified'}
            right={
              <MaterialIcons
                name={phoneVerified ? 'check-circle' : 'cancel'}
                size={22}
                color={phoneVerified ? theme.success : theme.error}
              />
            }
          />
        </SettingsSection>

        {/* Two-Factor Authentication */}
        <SettingsSection title="Two-Factor Authentication">
          <TouchableOpacity
            style={s.twoFactorRow}
            onPress={handleToggle2FA}
            disabled={isEnabling2FA}
            accessibilityRole="button"
            accessibilityLabel="Authenticator App (TOTP)"
            accessibilityState={{ disabled: isEnabling2FA }}
            activeOpacity={0.6}
          >
            <View style={s.iconBadge}>
              <MaterialIcons name="verified-user" size={20} color={theme.primaryLight} />
            </View>
            <View style={s.textBlock}>
              <View style={s.labelWithBadge}>
                <Text style={s.label} numberOfLines={1}>
                  Authenticator App (TOTP)
                </Text>
                {twoFactorEnabled ? (
                  <View style={s.enabledBadge}>
                    <Text style={s.enabledBadgeText}>Enabled</Text>
                  </View>
                ) : (
                  <View style={s.recommendedBadge}>
                    <Text style={s.recommendedBadgeText}>Recommended</Text>
                  </View>
                )}
              </View>
              <Text style={s.description} numberOfLines={2}>
                {twoFactorEnabled
                  ? 'Extra security when signing in'
                  : 'Add an extra layer of protection to your account'}
              </Text>
            </View>
            {isEnabling2FA ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <Switch
                value={twoFactorEnabled}
                onValueChange={handleToggle2FA}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor={twoFactorEnabled ? theme.primary : theme.textDisabled}
              />
            )}
          </TouchableOpacity>
        </SettingsSection>

        {/* Password */}
        <SettingsSection title="Password">
          <SettingsRow
            icon="lock-reset"
            label="Change Password"
            description="Update your password via email"
            onPress={handleChangePassword}
          />
        </SettingsSection>

        {/* Security Tips */}
        <View style={s.tipsCard}>
          <MaterialIcons name="lightbulb-outline" size={24} color={theme.warning} />
          <View style={s.tipsContent}>
            <Text style={s.tipsTitle}>Security Tips</Text>
            <Text style={s.tipsText}>
              • Enable 2FA for maximum account protection{'\n'}
              • Use a strong, unique password{'\n'}
              • Never share your password or 2FA codes{'\n'}
              • Verify your email and phone number
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.background,
    },
    // ── Two-factor row (mirrors SettingsRow's layout, extended with a badge) ──
    twoFactorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    iconBadge: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
      marginRight: 12,
    },
    textBlock: {
      flex: 1,
      marginRight: 8,
    },
    labelWithBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    label: {
      fontSize: 15,
      fontWeight: '600',
      color: t.text,
      flexShrink: 1,
    },
    description: {
      fontSize: 13,
      lineHeight: 17,
      color: t.textSecondary,
      marginTop: 2,
    },
    enabledBadge: {
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 4,
    },
    enabledBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: t.primary,
    },
    recommendedBadge: {
      backgroundColor: t.isDark ? 'rgba(251,191,36,0.18)' : 'rgba(251,191,36,0.16)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 4,
    },
    recommendedBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: t.warning,
    },
    // ── Security tips card ─────────────────────────────────────────────────
    tipsCard: {
      flexDirection: 'row',
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(251,191,36,0.35)' : 'rgba(251,191,36,0.4)',
      marginBottom: 24,
    },
    tipsContent: {
      flex: 1,
      marginLeft: 12,
    },
    tipsTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: t.warning,
      marginBottom: 8,
    },
    tipsText: {
      fontSize: 13,
      color: t.textSecondary,
      lineHeight: 20,
    },
  });
}
