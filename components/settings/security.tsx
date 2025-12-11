/**
 * Security Settings Component
 * Manages 2FA, password, and security preferences for users
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
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
import { supabase } from '../../lib/supabase';

interface SecuritySettingsProps {
  onBack: () => void;
}

export function SecuritySettings({ onBack }: SecuritySettingsProps) {
  const [loading, setLoading] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [isEnabling2FA, setIsEnabling2FA] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

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
        setTwoFactorEnabled(factors?.totp?.length > 0);
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
                // TODO: Navigate to dedicated QR code display screen
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
          onPress: async (code) => {
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
      console.error('[security-settings] Error verifying 2FA:', error);
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
              
              if (factors?.totp?.length > 0) {
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Security</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Verification Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Verification</Text>
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={styles.statusInfo}>
                <Text style={styles.statusLabel}>Email Verification</Text>
                <Text style={styles.statusDescription}>
                  {emailVerified ? 'Verified' : 'Not verified'}
                </Text>
              </View>
              <MaterialIcons
                name={emailVerified ? 'check-circle' : 'cancel'}
                size={24}
                color={emailVerified ? '#10b981' : '#ef4444'}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.statusRow}>
              <View style={styles.statusInfo}>
                <Text style={styles.statusLabel}>Phone Verification</Text>
                <Text style={styles.statusDescription}>
                  {phoneVerified ? 'Verified' : 'Not verified'}
                </Text>
              </View>
              <MaterialIcons
                name={phoneVerified ? 'check-circle' : 'cancel'}
                size={24}
                color={phoneVerified ? '#10b981' : '#ef4444'}
              />
            </View>
          </View>
        </View>

        {/* Two-Factor Authentication */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Two-Factor Authentication</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.settingRow}
              onPress={twoFactorEnabled ? handleDisable2FA : handleEnable2FA}
              disabled={isEnabling2FA}
            >
              <View style={styles.settingInfo}>
                <View style={styles.labelWithBadge}>
                  <Text style={styles.settingLabel}>Authenticator App (TOTP)</Text>
                  {twoFactorEnabled ? (
                    <View style={styles.enabledBadge}>
                      <Text style={styles.enabledBadgeText}>Enabled</Text>
                    </View>
                  ) : (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>Recommended</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.settingDescription}>
                  {twoFactorEnabled
                    ? 'Extra security when signing in'
                    : 'Add an extra layer of protection to your account'}
                </Text>
              </View>
              {isEnabling2FA ? (
                <ActivityIndicator size="small" color="#10b981" />
              ) : (
                <Switch
                  value={twoFactorEnabled}
                  onValueChange={twoFactorEnabled ? handleDisable2FA : handleEnable2FA}
                  trackColor={{ false: '#374151', true: '#059669' }}
                  thumbColor={twoFactorEnabled ? '#10b981' : '#9ca3af'}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Password</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.settingRow} onPress={handleChangePassword}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Change Password</Text>
                <Text style={styles.settingDescription}>
                  Update your password via email
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Security Tips */}
        <View style={styles.section}>
          <View style={styles.tipsCard}>
            <MaterialIcons name="lightbulb-outline" size={24} color="#f59e0b" />
            <View style={styles.tipsContent}>
              <Text style={styles.tipsTitle}>Security Tips</Text>
              <Text style={styles.tipsText}>
                • Enable 2FA for maximum account protection{'\n'}
                • Use a strong, unique password{'\n'}
                • Never share your password or 2FA codes{'\n'}
                • Verify your email and phone number
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#065f46',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#065f46',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  section: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  card: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.2)',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  statusInfo: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
    marginBottom: 2,
  },
  statusDescription: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  labelWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
  },
  settingDescription: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
  },
  enabledBadge: {
    backgroundColor: 'rgba(16,185,129,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  enabledBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#10b981',
  },
  recommendedBadge: {
    backgroundColor: 'rgba(245,158,11,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recommendedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#f59e0b',
  },
  tipsCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  tipsContent: {
    flex: 1,
    marginLeft: 12,
  },
  tipsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f59e0b',
    marginBottom: 8,
  },
  tipsText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
  },
});
