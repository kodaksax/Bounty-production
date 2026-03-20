// app/(admin)/analytics.tsx - Analytics dashboard for admin panel
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AnalyticsMetrics, AnalyticsMetricsCard } from '../../components/admin/AnalyticsMetricsCard';
import { useAuthContext } from '../../hooks/use-auth-context';
import { ErrorBoundary } from '../../lib/error-boundary';
import { supabase } from '../../lib/supabase';

export default function AnalyticsDashboard() {
  const router = useRouter();
  const { isAuthStale, attemptRefresh } = useAuthContext();
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
      
      // Get authentication token from current session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      // Add authentication header if token is available
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(`${API_BASE_URL}/admin/analytics/metrics`, {
        method: 'GET',
        headers,
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
    <ErrorBoundary>
      <View style={styles.container}>
      <AdminHeader title="Analytics Dashboard" onBack={() => router.back()} />

      {/* Offline / stale-auth banner */}
      {isAuthStale && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>You appear offline or your session may have expired.</Text>
          <TouchableOpacity style={styles.offlineRetry} onPress={() => attemptRefresh?.()}>
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text style={styles.offlineRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

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
    </ErrorBoundary>
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
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(220,38,38,0.12)',
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 8,
  },
  offlineText: {
    color: '#fffef5',
    flex: 1,
    marginRight: 8,
  },
  offlineRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#b91c1c',
    borderRadius: 8,
  },
  offlineRetryText: {
    color: '#fff',
    marginLeft: 8,
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
