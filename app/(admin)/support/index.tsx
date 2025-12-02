// app/(admin)/support/index.tsx - Admin Support Hub
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { ROUTES } from '../../../lib/routes';

interface SupportLink {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  route?: string;
  externalUrl?: string;
}

const supportLinks: SupportLink[] = [
  {
    id: 'help',
    title: 'Help Center',
    description: 'Browse documentation and FAQs',
    icon: 'help-outline',
    route: ROUTES.ADMIN.SUPPORT.HELP,
  },
  {
    id: 'feedback',
    title: 'Send Feedback',
    description: 'Report issues or suggest improvements',
    icon: 'feedback',
    route: ROUTES.ADMIN.SUPPORT.FEEDBACK,
  },
  {
    id: 'contact',
    title: 'Contact Support',
    description: 'Get help from our support team',
    icon: 'email',
    externalUrl: 'mailto:support@bountyexpo.com',
  },
  {
    id: 'status',
    title: 'System Status',
    description: 'Check platform status and incidents',
    icon: 'monitor-heart',
    externalUrl: 'https://status.bountyexpo.com',
  },
];

const quickResources = [
  { id: 'docs', title: 'Admin Documentation', icon: 'menu-book' },
  { id: 'api', title: 'API Reference', icon: 'code' },
  { id: 'changelog', title: 'Release Notes', icon: 'update' },
  { id: 'security', title: 'Security Guidelines', icon: 'security' },
];

export default function AdminSupportScreen() {
  const router = useRouter();

  const handlePress = (item: SupportLink) => {
    if (item.route) {
      router.push(item.route as any);
    } else if (item.externalUrl) {
      Linking.openURL(item.externalUrl).catch(err => 
        console.error('Failed to open URL:', err)
      );
    }
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Support" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Main Support Links */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Get Help</Text>
          <View style={styles.linksContainer}>
            {supportLinks.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.linkCard}
                onPress={() => handlePress(item)}
              >
                <View style={styles.linkIcon}>
                  <MaterialIcons name={item.icon} size={28} color="#00dc50" />
                </View>
                <View style={styles.linkContent}>
                  <Text style={styles.linkTitle}>{item.title}</Text>
                  <Text style={styles.linkDescription}>{item.description}</Text>
                </View>
                <MaterialIcons 
                  name={item.externalUrl ? 'open-in-new' : 'chevron-right'} 
                  size={20} 
                  color="rgba(255,254,245,0.4)" 
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quick Resources */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Resources</Text>
          <View style={styles.resourcesGrid}>
            {quickResources.map((resource) => (
              <TouchableOpacity key={resource.id} style={styles.resourceCard}>
                <MaterialIcons name={resource.icon as any} size={24} color="#00dc50" />
                <Text style={styles.resourceTitle}>{resource.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Admin Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin Panel Info</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Version</Text>
              <Text style={styles.infoValue}>1.0.0</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Build</Text>
              <Text style={styles.infoValue}>2024.11.26</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Environment</Text>
              <Text style={styles.infoValue}>Production</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>API Status</Text>
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Operational</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Emergency Contact */}
        <View style={styles.emergencyCard}>
          <MaterialIcons name="warning" size={24} color="#ffc107" />
          <View style={styles.emergencyContent}>
            <Text style={styles.emergencyTitle}>Emergency Support</Text>
            <Text style={styles.emergencyText}>
              For critical issues, contact the on-call engineer
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.emergencyButton}
            onPress={() => Linking.openURL('tel:+1-555-BOUNTY')}
          >
            <MaterialIcons name="phone" size={20} color="#ffffff" />
          </TouchableOpacity>
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
  linksContainer: {
    gap: 12,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
    gap: 16,
  },
  linkIcon: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(0,142,42,0.15)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkContent: {
    flex: 1,
  },
  linkTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  linkDescription: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
  },
  resourcesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  resourceCard: {
    width: '48%',
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
    alignItems: 'center',
    gap: 8,
  },
  resourceTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#ffffff',
    textAlign: 'center',
  },
  infoCard: {
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
  },
  infoValue: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4caf50',
  },
  statusText: {
    fontSize: 14,
    color: '#4caf50',
    fontWeight: '500',
  },
  emergencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,193,7,0.1)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.3)',
    gap: 12,
    marginTop: 8,
  },
  emergencyContent: {
    flex: 1,
  },
  emergencyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffc107',
    marginBottom: 2,
  },
  emergencyText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
  },
  emergencyButton: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(255,193,7,0.2)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
