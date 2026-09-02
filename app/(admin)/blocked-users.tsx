// app/(admin)/blocked-users.tsx - Admin Blocked Users Management
import { MaterialIcons } from '@expo/vector-icons';
import { withAlpha } from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import type { AppTheme } from '../../lib/themes/types';
import { useRouter } from 'expo-router';
import React, { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { supabase } from '../../lib/supabase';

interface BlockedUserRelationship {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  blocker?: {
    id: string;
    username: string;
    avatar?: string;
  };
  blocked?: {
    id: string;
    username: string;
    avatar?: string;
  };
}

/**
 * Rows to load. Block relationships are reviewed case by case rather than
 * scrolled in bulk, so a bounded page with an explicit "showing N of M" is
 * more useful than an unbounded list that degrades as the platform grows.
 */
const BLOCK_LIST_LIMIT = 100;

export default function AdminBlockedUsersScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const [blocks, setBlocks] = useState<BlockedUserRelationship[]>([]);
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBlockedUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Bounded, with an exact count: this query previously returned every
      // block relationship on the platform with no LIMIT, and rendered them
      // all through a .map() inside a ScrollView.
      const { data, error: fetchError, count } = await supabase
        .from('blocked_users')
        .select(
          `
          *,
          blocker:profiles!blocked_users_blocker_id_fkey(id, username, avatar),
          blocked:profiles!blocked_users_blocked_id_fkey(id, username, avatar)
        `,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .limit(BLOCK_LIST_LIMIT);

      if (fetchError) {
        setError(fetchError.message);
      } else {
        const rows = (data || []) as any[];
        setBlocks(rows);
        setTotalBlocks(count ?? rows.length);
      }
    } catch (err) {
      console.error('Error fetching blocked users:', err);
      setError('An error occurred while loading blocked users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBlockedUsers();
  }, []);

  const handleUnblock = async (blockerId: string, blockedId: string) => {
    Alert.alert(
      'Unblock User',
      'Are you sure you want to remove this block relationship?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: async () => {
            try {
              // blocked_users has no `id` column -- its primary key is the
              // composite (blocker_id, blocked_id).
              const { error: deleteError } = await supabase
                .from('blocked_users')
                .delete()
                .eq('blocker_id', blockerId)
                .eq('blocked_id', blockedId);

              if (deleteError) {
                Alert.alert('Error', deleteError.message);
              } else {
                Alert.alert('Success', 'Block relationship removed');
                fetchBlockedUsers();
              }
            } catch (err) {
              console.error('Error removing block:', err);
              Alert.alert('Error', 'An error occurred while removing the block');
            }
          },
        },
      ]
    );
  };

  if (error && blocks.length === 0) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Blocked Users" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={theme.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchBlockedUsers}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="Blocked Users" onBack={() => router.back()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={fetchBlockedUsers} tintColor={theme.success} />
        }
      >
        {isLoading && blocks.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.success} />
            <Text style={styles.loadingText}>Loading blocked users...</Text>
          </View>
        ) : blocks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="check-circle" size={64} color={theme.success} />
            <Text style={styles.emptyText}>No Blocked Users</Text>
            <Text style={styles.emptySubtext}>
              There are currently no active block relationships in the system.
            </Text>
          </View>
        ) : (
          blocks.map((block) => (
            <AdminCard key={`${block.blocker_id}-${block.blocked_id}`}>
              <View style={styles.blockCard}>
                {/* Blocker Info */}
                <View style={styles.userSection}>
                  <Text style={styles.sectionLabel}>Blocker</Text>
                  <View style={styles.userInfo}>
                    <MaterialIcons name="person" size={20} color={theme.primaryLight} />
                    <Text style={styles.username}>
                      {block.blocker?.username || 'Unknown User'}
                    </Text>
                  </View>
                </View>

                {/* Blocked Icon */}
                <View style={styles.iconSection}>
                  <MaterialIcons name="block" size={32} color={theme.error} />
                </View>

                {/* Blocked Info */}
                <View style={styles.userSection}>
                  <Text style={styles.sectionLabel}>Blocked</Text>
                  <View style={styles.userInfo}>
                    <MaterialIcons name="person" size={20} color={theme.primaryLight} />
                    <Text style={styles.username}>
                      {block.blocked?.username || 'Unknown User'}
                    </Text>
                  </View>
                </View>

                {/* Date */}
                <View style={styles.dateSection}>
                  <Text style={styles.dateLabel}>Blocked on:</Text>
                  <Text style={styles.dateValue}>
                    {new Date(block.created_at).toLocaleDateString()} at{' '}
                    {new Date(block.created_at).toLocaleTimeString()}
                  </Text>
                </View>

                {/* Action */}
                <TouchableOpacity
                  style={styles.unblockButton}
                  onPress={() => handleUnblock(block.blocker_id, block.blocked_id)}
                >
                  <MaterialIcons name="check" size={16} color={theme.success} />
                  <Text style={styles.unblockButtonText}>Remove Block</Text>
                </TouchableOpacity>
              </View>
            </AdminCard>
          ))
        )}

        {/* Says plainly when the list is truncated, so an operator is never
            left assuming they are looking at everything. */}
        {blocks.length > 0 && (
          <Text style={styles.listFooterText}>
            {totalBlocks > blocks.length
              ? `Showing the ${blocks.length} most recent of ${totalBlocks.toLocaleString()} block relationships.`
              : `Showing all ${blocks.length.toLocaleString()} block relationship${blocks.length === 1 ? '' : 's'}.`}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    listFooterText: {
      fontSize: 12,
      color: theme.textSecondary,
      textAlign: 'center',
      paddingVertical: 16,
    },
  container: {
    flex: 1,
    backgroundColor: theme.primary, // emerald-600
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: theme.primaryLight,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: theme.error,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: theme.success,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.primary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: theme.primaryLight,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  blockCard: {
    gap: 12,
  },
  userSection: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 12,
    color: theme.primaryLight,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  username: {
    fontSize: 16,
    color: 'white',
    fontWeight: '500',
  },
  iconSection: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dateSection: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.primary,
  },
  dateLabel: {
    fontSize: 12,
    color: theme.primaryLight,
    fontWeight: '500',
  },
  dateValue: {
    fontSize: 14,
    color: 'white',
  },
  unblockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: withAlpha(theme.success, 0.125),
    borderRadius: 8,
    marginTop: 8,
  },
  unblockButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.success,
  },
});
