// app/(admin)/analytics.tsx - Analytics dashboard for admin panel
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AnalyticsMetricsCard, AnalyticsMetrics } from '../../components/admin/AnalyticsMetricsCard';

export default function AnalyticsDashboard() {
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [metrics, setMetrics] = React.useState<AnalyticsMetrics | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchAnalytics = React.useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      // TODO: Replace with actual API call to fetch analytics
      // For now, using mock data
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const mockMetrics: AnalyticsMetrics = {
        // User metrics
        totalUsers: 1250,
        activeUsersToday: 45,
        activeUsersWeek: 320,
        newUsersToday: 8,
        newUsersWeek: 52,

        // Event metrics
        totalEvents: 15420,
        eventsToday: 340,
        eventsWeek: 2450,

        // Top events
        topEvents: [
          { name: 'bounty_viewed', count: 520 },
          { name: 'message_sent', count: 410 },
          { name: 'bounty_created', count: 85 },
          { name: 'bounty_accepted', count: 62 },
          { name: 'payment_completed', count: 48 },
        ],

        // Bounty metrics
        bountiesCreatedToday: 12,
        bountiesCreatedWeek: 85,
        bountiesAcceptedToday: 8,
        bountiesAcceptedWeek: 62,
        bountiesCompletedToday: 5,
        bountiesCompletedWeek: 48,

        // Payment metrics
        paymentsToday: 5,
        paymentsWeek: 48,
        revenueToday: 450.0,
        revenueWeek: 3820.5,

        // Messaging metrics
        messagesToday: 120,
        messagesWeek: 890,
        conversationsToday: 18,
        conversationsWeek: 125,

        // Error tracking
        errorsToday: 3,
        errorsWeek: 24,
        topErrors: [
          { message: 'Network request failed', count: 8 },
          { message: 'Invalid bounty ID', count: 5 },
          { message: 'Payment processing error', count: 3 },
        ],
      };

      setMetrics(mockMetrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
      console.error('Error fetching analytics:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleRefresh = React.useCallback(() => {
    setRefreshing(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <View style={styles.container}>
      <AdminHeader title="Analytics Dashboard" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#00dc50"
          />
        }
      >
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={20} color="#00dc50" />
          <Text style={styles.infoBannerText}>
            Analytics data is updated in real-time. Pull down to refresh.
          </Text>
        </View>

        {/* Analytics Metrics */}
        <AnalyticsMetricsCard
          metrics={metrics}
          isLoading={isLoading}
          error={error}
        />

        {/* Error state with retry */}
        {error && (
          <View style={styles.errorContainer}>
            <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
              <MaterialIcons name="refresh" size={20} color="#fffef5" />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,220,80,0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,220,80,0.3)',
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
    color: 'rgba(255,254,245,0.9)',
    fontSize: 13,
  },
  errorContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00912C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  retryButtonText: {
    color: '#fffef5',
    fontSize: 14,
    fontWeight: '600',
  },
});
