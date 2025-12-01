// app/(admin)/settings/index.tsx - Admin Settings Hub
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { ROUTES } from '../../../lib/routes';

interface SettingsSection {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  route: string;
}

const settingsSections: SettingsSection[] = [
  {
    id: 'general',
    title: 'General Settings',
    description: 'App configuration, preferences, and display options',
    icon: 'settings',
    route: ROUTES.ADMIN.SETTINGS.GENERAL,
  },
  {
    id: 'notifications',
    title: 'Notification Settings',
    description: 'Manage admin alerts, email notifications, and push settings',
    icon: 'notifications',
    route: ROUTES.ADMIN.SETTINGS.NOTIFICATIONS,
  },
  {
    id: 'security',
    title: 'Security Settings',
    description: 'Access control, authentication, and security policies',
    icon: 'security',
    route: ROUTES.ADMIN.SETTINGS.SECURITY,
  },
  {
    id: 'audit-log',
    title: 'Audit Log',
    description: 'View admin actions and system activity history',
    icon: 'history',
    route: ROUTES.ADMIN.SETTINGS.AUDIT_LOG,
  },
];

export default function AdminSettingsScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <AdminHeader title="Admin Settings" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.description}>
          Configure admin panel settings, security policies, and view system activity.
        </Text>

        <View style={styles.sectionsContainer}>
          {settingsSections.map((section) => (
            <TouchableOpacity
              key={section.id}
              style={styles.sectionCard}
              onPress={() => router.push(section.route as any)}
            >
              <View style={styles.sectionIcon}>
                <MaterialIcons name={section.icon} size={28} color="#00dc50" />
              </View>
              <View style={styles.sectionContent}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionDescription}>{section.description}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="rgba(255,254,245,0.4)" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Version Info */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>Admin Panel v1.0.0</Text>
          <Text style={styles.versionSubtext}>BountyExpo Platform</Text>
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.7)',
    lineHeight: 20,
    marginBottom: 24,
  },
  sectionsContainer: {
    gap: 12,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
    gap: 16,
  },
  sectionIcon: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(0,142,42,0.15)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionContent: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
    lineHeight: 18,
  },
  versionContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.5)',
    fontWeight: '500',
  },
  versionSubtext: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.3)',
    marginTop: 4,
  },
});
