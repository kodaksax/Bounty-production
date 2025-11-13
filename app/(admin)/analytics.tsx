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

      // Fetch analytics from API
      const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_BASE_URL}/admin/analytics/metrics`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          // TODO: Add authentication header
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.statusText}`);
      }

      const data: AnalyticsMetrics = await response.json();
      setMetrics(data);
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
