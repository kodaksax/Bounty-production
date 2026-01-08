// components/admin/AnalyticsMetricsCard.tsx - Analytics metrics display for admin panel
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AdminCard } from './AdminCard';
import { AdminStatRow } from './AdminStatRow';

export interface AnalyticsMetrics {
  // User metrics
  totalUsers: number;
  activeUsersToday: number;
  activeUsersWeek: number;
  newUsersToday: number;
  newUsersWeek: number;
  
  // Event metrics
  totalEvents: number;
  eventsToday: number;
  eventsWeek: number;
  
  // Top events
  topEvents: { name: string; count: number }[];
  
  // Bounty metrics
  bountiesCreatedToday: number;
  bountiesCreatedWeek: number;
  bountiesAcceptedToday: number;
  bountiesAcceptedWeek: number;
  bountiesCompletedToday: number;
  bountiesCompletedWeek: number;
  
  // Payment metrics
  paymentsToday: number;
  paymentsWeek: number;
  revenueToday: number;
  revenueWeek: number;
  
  // Messaging metrics
  messagesToday: number;
  messagesWeek: number;
  conversationsToday: number;
  conversationsWeek: number;
  
  // Error tracking
  errorsToday: number;
  errorsWeek: number;
  topErrors: { message: string; count: number }[];
}

interface AnalyticsMetricsCardProps {
  metrics: AnalyticsMetrics | null;
  isLoading: boolean;
  error: string | null;
}

export const AnalyticsMetricsCard: React.FC<AnalyticsMetricsCardProps> = ({
  metrics,
  isLoading,
  error,
}) => {
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (isLoading || !metrics) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00dc50" />
        <Text style={styles.loadingText}>Loading analytics...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* User Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>User Activity</Text>
        <AdminCard>
          <AdminStatRow label="Total Users" value={metrics.totalUsers} />
          <AdminStatRow label="Active Today" value={metrics.activeUsersToday} />
          <AdminStatRow label="Active This Week" value={metrics.activeUsersWeek} />
          <AdminStatRow label="New Today" value={metrics.newUsersToday} />
          <AdminStatRow label="New This Week" value={metrics.newUsersWeek} />
        </AdminCard>
      </View>

      {/* Event Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Events Tracked</Text>
        <AdminCard>
          <AdminStatRow label="Total Events" value={metrics.totalEvents} />
          <AdminStatRow label="Events Today" value={metrics.eventsToday} />
          <AdminStatRow label="Events This Week" value={metrics.eventsWeek} />
        </AdminCard>
      </View>

      {/* Top Events */}
      {metrics.topEvents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Events</Text>
          <AdminCard>
            {metrics.topEvents.map((event, index) => (
              <AdminStatRow
                key={index}
                label={event.name}
                value={event.count}
              />
            ))}
          </AdminCard>
        </View>
      )}

      {/* Bounty Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bounty Activity</Text>
        <AdminCard>
          <AdminStatRow label="Created Today" value={metrics.bountiesCreatedToday} />
          <AdminStatRow label="Created This Week" value={metrics.bountiesCreatedWeek} />
          <AdminStatRow label="Accepted Today" value={metrics.bountiesAcceptedToday} />
          <AdminStatRow label="Accepted This Week" value={metrics.bountiesAcceptedWeek} />
          <AdminStatRow label="Completed Today" value={metrics.bountiesCompletedToday} />
          <AdminStatRow label="Completed This Week" value={metrics.bountiesCompletedWeek} />
        </AdminCard>
      </View>

      {/* Payment Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Payment Activity</Text>
        <AdminCard>
          <AdminStatRow label="Payments Today" value={metrics.paymentsToday} />
          <AdminStatRow label="Payments This Week" value={metrics.paymentsWeek} />
          <AdminStatRow
            label="Revenue Today"
            value={`$${metrics.revenueToday.toFixed(2)}`}
          />
          <AdminStatRow
            label="Revenue This Week"
            value={`$${metrics.revenueWeek.toFixed(2)}`}
          />
        </AdminCard>
      </View>

      {/* Messaging Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Messaging Activity</Text>
        <AdminCard>
          <AdminStatRow label="Messages Today" value={metrics.messagesToday} />
          <AdminStatRow label="Messages This Week" value={metrics.messagesWeek} />
          <AdminStatRow label="Conversations Today" value={metrics.conversationsToday} />
          <AdminStatRow label="Conversations This Week" value={metrics.conversationsWeek} />
        </AdminCard>
      </View>

      {/* Error Tracking */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Error Tracking</Text>
        <AdminCard>
          <AdminStatRow label="Errors Today" value={metrics.errorsToday} />
          <AdminStatRow label="Errors This Week" value={metrics.errorsWeek} />
        </AdminCard>
      </View>

      {/* Top Errors */}
      {metrics.topErrors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Errors</Text>
          <AdminCard>
            {metrics.topErrors.map((error, index) => (
              <View key={index} style={styles.errorItem}>
                <Text style={styles.errorMessage} numberOfLines={2}>
                  {error.message}
                </Text>
                <Text style={styles.errorCount}>{error.count}×</Text>
              </View>
            ))}
          </AdminCard>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },
  section: {
    marginBottom: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 12,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
  errorContainer: {
    padding: 20,
    backgroundColor: 'rgba(244,67,54,0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.4)',
  },
  errorText: {
    color: '#f44336',
    fontSize: 14,
    textAlign: 'center',
  },
  errorItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,254,245,0.1)',
  },
  errorMessage: {
    flex: 1,
    color: 'rgba(255,254,245,0.9)',
    fontSize: 13,
    marginRight: 12,
  },
  errorCount: {
    color: '#f44336',
    fontSize: 13,
    fontWeight: '600',
  },
});
