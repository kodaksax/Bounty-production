// app/(admin)/index.tsx - Admin Dashboard (overview with metrics)
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Dimensions, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Carousel from 'react-native-reanimated-carousel';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminStatRow } from '../../components/admin/AdminStatRow';
import { useAdminMetrics } from '../../hooks/useAdminMetrics';
import { ROUTES } from '../../lib/routes';

export default function AdminDashboard() {
  const router = useRouter();
  const { metrics, isLoading, error, refetch } = useAdminMetrics();
  const width = Dimensions.get('window').width;

  const quickLinks = [
    { id: 'analytics', title: 'Analytics', icon: 'analytics', route: ROUTES.ADMIN.ANALYTICS },
    { id: 'bounties', title: 'Bounties', icon: 'work', route: ROUTES.ADMIN.BOUNTIES },
    { id: 'users', title: 'Users', icon: 'people', route: ROUTES.ADMIN.USERS },
    { id: 'transactions', title: 'Transactions', icon: 'account-balance', route: ROUTES.ADMIN.TRANSACTIONS },
    { id: 'reports', title: 'Reports', icon: 'report', route: ROUTES.ADMIN.REPORTS },
    { id: 'blocked', title: 'Blocked Users', icon: 'block', route: ROUTES.ADMIN.BLOCKED_USERS },
    { id: 'settings', title: 'Settings', icon: 'settings', route: ROUTES.ADMIN.SETTINGS.INDEX },
    { id: 'support', title: 'Support', icon: 'help', route: ROUTES.ADMIN.SUPPORT.INDEX },
    { id: 'reports', title: 'Moderation', icon: 'shield', route: ROUTES.ADMIN.REPORTS },
    { id: 'audit', title: 'Audit Logs', icon: 'history', route: ROUTES.ADMIN.AUDIT_LOGS },
  ];

  const renderQuickLinkItem = ({ item }: { item: typeof quickLinks[0] }) => (
    <TouchableOpacity
      style={styles.quickLinkCard}
      onPress={() => router.push(item.route as any)}
    >
      <MaterialIcons name={item.icon as any} size={40} color="#00dc50" />
      <Text style={styles.quickLinkText}>{item.title}</Text>
    </TouchableOpacity>
  );

  if (error && !metrics) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Admin Dashboard" />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="rgba(255,254,245,0.6)" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="Admin Dashboard" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#00dc50" />}
      >
        {/* Quick Links Carousel */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Access</Text>
          <View style={styles.carouselContainer}>
            <Carousel
              loop={false}
              width={width - 64}
              height={140}
              data={quickLinks}
              scrollAnimationDuration={300}
              mode="parallax"
              modeConfig={{
                parallaxScrollingScale: 0.9,
                parallaxScrollingOffset: 50,
              }}
              renderItem={renderQuickLinkItem}
            />
          </View>
        </View>

        {/* Metrics */}
        {isLoading && !metrics ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00dc50" />
          </View>
        ) : metrics ? (
          <>
            {/* Bounty Metrics */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Bounty Overview</Text>
              <AdminCard>
                <AdminStatRow label="Total Bounties" value={metrics.totalBounties} />
                <AdminStatRow label="Open" value={metrics.openBounties} />
                <AdminStatRow label="In Progress" value={metrics.inProgressBounties} />
                <AdminStatRow label="Completed" value={metrics.completedBounties} />
                <AdminStatRow label="Archived" value={metrics.archivedBounties} />
              </AdminCard>
            </View>

            {/* User & Transaction Metrics */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Platform Stats</Text>
              <AdminCard>
                <AdminStatRow label="Total Users" value={metrics.totalUsers} />
                <AdminStatRow label="Total Transactions" value={metrics.totalTransactions} />
                <AdminStatRow
                  label="Escrow Volume"
                  value={`$${metrics.totalEscrowVolume.toFixed(2)}`}
                />
              </AdminCard>
            </View>
          </>
        ) : null}

        {/* Error banner if metrics loaded but error occurred */}
        {error && metrics && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Bottom padding for safe area */}
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
    fontSize: 18,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 12,
  },
  carouselContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  quickLinkCard: {
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
    height: 140,
  },
  quickLinkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
    textAlign: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.8)',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#00912C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#fffef5',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: 'rgba(244,67,54,0.15)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.4)',
    marginBottom: 16,
  },
  errorBannerText: {
    color: '#f44336',
    fontSize: 13,
  },
});
