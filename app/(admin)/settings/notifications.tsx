// app/(admin)/settings/notifications.tsx - Admin Notification Settings
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { AdminCard } from '../../../components/admin/AdminCard';
import { AdminHeader } from '../../../components/admin/AdminHeader';

export default function AdminNotificationSettingsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState({
    // Push Notifications
    pushEnabled: true,
    newReports: true,
    flaggedContent: true,
    systemAlerts: true,
    
    // Email Notifications
    emailEnabled: true,
    dailyDigest: true,
    weeklyReport: false,
    criticalAlerts: true,
    
    // Alert Thresholds
    reportThreshold: 'immediate',
    flagThreshold: '3',
  });

  const handleToggle = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSelectOption = (key: keyof typeof notifications, options: string[], title: string) => {
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }[] = options.map((option) => ({
      text: option,
      onPress: () => setNotifications((prev) => ({ ...prev, [key]: option })),
    }));
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title, 'Select an option:', buttons);
  };

  const handleSave = () => {
    Alert.alert('Settings Saved', 'Your notification preferences have been updated.');
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Notification Settings" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Push Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Push Notifications</Text>
          <AdminCard>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Enable Push Notifications</Text>
                <Text style={styles.settingDescription}>Receive notifications on your device</Text>
              </View>
              <Switch
                value={notifications.pushEnabled}
                onValueChange={() => handleToggle('pushEnabled')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.pushEnabled ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={[styles.settingRow, !notifications.pushEnabled && styles.disabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>New Reports</Text>
                <Text style={styles.settingDescription}>Alert when new reports are submitted</Text>
              </View>
              <Switch
                value={notifications.newReports}
                onValueChange={() => handleToggle('newReports')}
                disabled={!notifications.pushEnabled}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.newReports ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={[styles.settingRow, !notifications.pushEnabled && styles.disabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Flagged Content</Text>
                <Text style={styles.settingDescription}>Alert when content is flagged</Text>
              </View>
              <Switch
                value={notifications.flaggedContent}
                onValueChange={() => handleToggle('flaggedContent')}
                disabled={!notifications.pushEnabled}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.flaggedContent ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={[styles.settingRow, !notifications.pushEnabled && styles.disabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>System Alerts</Text>
                <Text style={styles.settingDescription}>Critical system notifications</Text>
              </View>
              <Switch
                value={notifications.systemAlerts}
                onValueChange={() => handleToggle('systemAlerts')}
                disabled={!notifications.pushEnabled}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.systemAlerts ? '#00dc50' : '#f4f3f4'}
              />
            </View>
          </AdminCard>
        </View>

        {/* Email Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Email Notifications</Text>
          <AdminCard>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Enable Email Notifications</Text>
                <Text style={styles.settingDescription}>Receive notifications via email</Text>
              </View>
              <Switch
                value={notifications.emailEnabled}
                onValueChange={() => handleToggle('emailEnabled')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.emailEnabled ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={[styles.settingRow, !notifications.emailEnabled && styles.disabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Daily Digest</Text>
                <Text style={styles.settingDescription}>Summary of admin activity</Text>
              </View>
              <Switch
                value={notifications.dailyDigest}
                onValueChange={() => handleToggle('dailyDigest')}
                disabled={!notifications.emailEnabled}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.dailyDigest ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={[styles.settingRow, !notifications.emailEnabled && styles.disabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Weekly Report</Text>
                <Text style={styles.settingDescription}>Weekly platform analytics</Text>
              </View>
              <Switch
                value={notifications.weeklyReport}
                onValueChange={() => handleToggle('weeklyReport')}
                disabled={!notifications.emailEnabled}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.weeklyReport ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={[styles.settingRow, !notifications.emailEnabled && styles.disabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Critical Alerts</Text>
                <Text style={styles.settingDescription}>Urgent security or system issues</Text>
              </View>
              <Switch
                value={notifications.criticalAlerts}
                onValueChange={() => handleToggle('criticalAlerts')}
                disabled={!notifications.emailEnabled}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={notifications.criticalAlerts ? '#00dc50' : '#f4f3f4'}
              />
            </View>
          </AdminCard>
        </View>

        {/* Alert Thresholds */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alert Thresholds</Text>
          <AdminCard>
            <TouchableOpacity accessibilityRole="button"
              style={styles.settingRow}
              onPress={() => handleSelectOption('reportThreshold', ['immediate', 'hourly', 'daily'], 'Report Alert Frequency')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Report Alert Frequency</Text>
                <Text style={styles.settingDescription}>How often to send report alerts</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>{notifications.reportThreshold}</Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button"
              style={styles.settingRow}
              onPress={() => handleSelectOption('flagThreshold', ['1', '3', '5', '10'], 'Flag Threshold')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Flag Threshold</Text>
                <Text style={styles.settingDescription}>Number of flags before alert</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>{notifications.flagThreshold}</Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
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
  disabled: {
    opacity: 0.5,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fffef5',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
  },
  selectValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectValueText: {
    fontSize: 14,
    color: '#00dc50',
    textTransform: 'capitalize',
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
