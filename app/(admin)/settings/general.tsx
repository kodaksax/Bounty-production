// app/(admin)/settings/general.tsx - Admin General Settings
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { AdminCard } from '../../../components/admin/AdminCard';
import { AdminHeader } from '../../../components/admin/AdminHeader';

interface SettingItem {
  id: string;
  label: string;
  description: string;
  type: 'switch' | 'select';
  value: boolean | string;
}

export default function AdminGeneralSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState({
    darkMode: true,
    compactView: false,
    autoRefresh: true,
    showArchivedBounties: false,
    defaultBountyFilter: 'all',
    itemsPerPage: '25',
    timezone: 'UTC',
  });

  const handleToggle = (key: keyof typeof settings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSelectOption = (key: keyof typeof settings, options: string[], title: string) => {
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }> = options.map((option) => ({
      text: option,
      onPress: () => setSettings((prev) => ({ ...prev, [key]: option })),
    }));
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title, 'Select an option:', buttons);
  };

  const handleSave = () => {
    Alert.alert('Settings Saved', 'Your preferences have been updated successfully.');
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="General Settings" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Display Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Display</Text>
          <AdminCard>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Dark Mode</Text>
                <Text style={styles.settingDescription}>Use dark theme for admin panel</Text>
              </View>
              <Switch
                value={settings.darkMode}
                onValueChange={() => handleToggle('darkMode')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={settings.darkMode ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Compact View</Text>
                <Text style={styles.settingDescription}>Show more items per screen</Text>
              </View>
              <Switch
                value={settings.compactView}
                onValueChange={() => handleToggle('compactView')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={settings.compactView ? '#00dc50' : '#f4f3f4'}
              />
            </View>
          </AdminCard>
        </View>

        {/* Data Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data & Refresh</Text>
          <AdminCard>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-Refresh</Text>
                <Text style={styles.settingDescription}>Automatically refresh data periodically</Text>
              </View>
              <Switch
                value={settings.autoRefresh}
                onValueChange={() => handleToggle('autoRefresh')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={settings.autoRefresh ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => handleSelectOption('itemsPerPage', ['10', '25', '50', '100'], 'Items Per Page')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Items Per Page</Text>
                <Text style={styles.settingDescription}>Number of items to show in lists</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>{settings.itemsPerPage}</Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
          </AdminCard>
        </View>

        {/* Filter Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Default Filters</Text>
          <AdminCard>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Show Archived Bounties</Text>
                <Text style={styles.settingDescription}>Include archived bounties in default view</Text>
              </View>
              <Switch
                value={settings.showArchivedBounties}
                onValueChange={() => handleToggle('showArchivedBounties')}
                trackColor={{ false: '#767577', true: '#00912C' }}
                thumbColor={settings.showArchivedBounties ? '#00dc50' : '#f4f3f4'}
              />
            </View>
            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => handleSelectOption('defaultBountyFilter', ['all', 'open', 'in_progress', 'completed'], 'Default Bounty Filter')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Default Bounty Filter</Text>
                <Text style={styles.settingDescription}>Default filter when viewing bounties</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>{settings.defaultBountyFilter}</Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
          </AdminCard>
        </View>

        {/* Timezone */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Regional</Text>
          <AdminCard>
            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => handleSelectOption('timezone', ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'], 'Timezone')}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Timezone</Text>
                <Text style={styles.settingDescription}>Display times in this timezone</Text>
              </View>
              <View style={styles.selectValue}>
                <Text style={styles.selectValueText}>{settings.timezone}</Text>
                <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
              </View>
            </TouchableOpacity>
          </AdminCard>
        </View>

        {/* Save Button */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
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
