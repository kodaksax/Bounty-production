// app/(admin)/settings/security.tsx - Admin Security Settings
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { AdminCard } from '../../../components/admin/AdminCard';
import { AdminHeader } from '../../../components/admin/AdminHeader';

export default function AdminSecuritySettingsScreen() {
  const router = useRouter();
  const [security, setSecurity] = useState({
    twoFactorEnabled: false,
    sessionTimeout: '30',
    requireReauth: true,
    ipRestriction: false,
    auditLogging: true,
    passwordExpiry: '90',
  });

  const handleToggle = (key: keyof typeof security) => {
    setSecurity((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSelectOption = (key: keyof typeof security, options: string[], title: string) => {
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }[] = options.map((option) => ({
      text: option,
      onPress: () => setSecurity((prev) => ({ ...prev, [key]: option })),
    }));
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title, 'Select an option:', buttons);
  };

  // TODO (Post-Launch): In production, integrate with actual authentication service for 2FA setup.
  // This should validate user eligibility, generate QR codes, and verify TOTP codes.
  const handleEnable2FA = () => {
    Alert.alert(
      'Enable Two-Factor Authentication',
      'This will require you to verify your identity using an authenticator app. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Enable', 
          onPress: () => {
            // Mock implementation - replace with actual 2FA enrollment flow
            handleToggle('twoFactorEnabled');
            Alert.alert('2FA Enabled', 'Two-factor authentication has been enabled for your account.');
          }
        },
      ]
    );
  };

  const handleRevokeAllSessions = () => {
    Alert.alert(
      'Revoke All Sessions',
      'This will log out all admin users from all devices. You will need to sign in again. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Revoke', 
          style: 'destructive',
          onPress: () => {
            Alert.alert('Sessions Revoked', 'All active sessions have been terminated.');
          }
        },
      ]
    );
  };

  const handleSave = () => {
    Alert.alert('Settings Saved', 'Your security settings have been updated.');
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Security Settings" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Authentication */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authentication</Text>
          <AdminCard>
            <TouchableOpacity accessibilityRole="button"
              style={styles.settingRow}
              onPress={handleEnable2FA}
            >
              <View style={styles.settingInfo}>
                <View style={styles.labelWithBadge}>
                  <Text style={styles.settingLabel}>Two-Factor Authentication</Text>
                  {security.twoFactorEnabled ? (
                    <View style={styles.enabledBadge}>
                      <Text style={styles.enabledBadgeText}>Enabled</Text>
                    </View>
                  ) : (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>Recommended</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.settingDescription}>Add an extra layer of security</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="rgba(255,254,245,0.4)" />
            </TouchableOpacity>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Require Re-authentication</Text>
                <Text style={styles.settingDescription}>For sensitive operations</Text>
              </View>
              <Switch
                value={security.requireReauth}
                onValueChange={() => handleToggle('requireReauth')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={security.requireReauth ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <TouchableOpacity accessibilityRole="button"
              style={styles.settingRow}
              onPress={() => handleSelectOption('passwordExpiry', ['30', '60', '90', 'never'], 'Password Expiry (days)')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Password Expiry</Text>
                <Text style={styles.settingDescription}>Force password change after</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>
                  {security.passwordExpiry === 'never' ? 'Never' : `${security.passwordExpiry} days`}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
          </AdminCard>
        </View>

        {/* Session Management */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session Management</Text>
          <AdminCard>
            <TouchableOpacity accessibilityRole="button"
              style={styles.settingRow}
              onPress={() => handleSelectOption('sessionTimeout', ['15', '30', '60', '120'], 'Session Timeout (minutes)')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Session Timeout</Text>
                <Text style={styles.settingDescription}>Auto-logout after inactivity</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>{security.sessionTimeout} min</Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button"
              style={styles.settingRow}
              onPress={handleRevokeAllSessions}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: '#f44336' }]}>Revoke All Sessions</Text>
                <Text style={styles.settingDescription}>Log out all admin users</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#f44336" />
            </TouchableOpacity>
          </AdminCard>
        </View>

        {/* Access Control */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Access Control</Text>
          <AdminCard>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>IP Restriction</Text>
                <Text style={styles.settingDescription}>Limit access to specific IP addresses</Text>
              </View>
              <Switch
                value={security.ipRestriction}
                onValueChange={() => handleToggle('ipRestriction')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={security.ipRestriction ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Audit Logging</Text>
                <Text style={styles.settingDescription}>Log all admin actions</Text>
              </View>
              <Switch
                value={security.auditLogging}
                onValueChange={() => handleToggle('auditLogging')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={security.auditLogging ? '#00dc50' : '#f4f3f4'}
              />
            </View>
          </AdminCard>
        </View>

        {/* Security Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security Status</Text>
          <AdminCard>
            <View style={styles.statusRow}>
              <MaterialIcons 
                name={security.twoFactorEnabled ? 'check-circle' : 'warning'} 
                size={24} 
                color={security.twoFactorEnabled ? '#4caf50' : '#ffc107'} 
              />
              <Text style={styles.statusText}>
                {security.twoFactorEnabled ? 'Two-factor authentication enabled' : 'Two-factor authentication not enabled'}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <MaterialIcons 
                name={security.auditLogging ? 'check-circle' : 'info'} 
                size={24} 
                color={security.auditLogging ? '#4caf50' : '#2196F3'} 
              />
              <Text style={styles.statusText}>
                {security.auditLogging ? 'Audit logging enabled' : 'Audit logging disabled'}
              </Text>
            </View>
          </AdminCard>
        </View>

        {/* Save Button */}
        <TouchableOpacity accessibilityRole="button" style={styles.saveButton} onPress={handleSave}>
          <MaterialIcons name="check" size={20} color="#fffef5" />
          <Text style={styles.saveButtonText}>Save Settings</Text>
        </TouchableOpacity>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  labelWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fffef5',
  },
  settingDescription: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
  },
  enabledBadge: {
    backgroundColor: 'rgba(76,175,80,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  enabledBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4caf50',
  },
  recommendedBadge: {
    backgroundColor: 'rgba(255,193,7,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recommendedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffc107',
  },
  selectValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectValueText: {
    fontSize: 14,
    color: '#00dc50',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.8)',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00912C',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 16,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
  },
});
