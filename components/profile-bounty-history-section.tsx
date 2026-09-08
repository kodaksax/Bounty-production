import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { bountyService } from 'lib/services/bounty-service';
import type { Bounty } from 'lib/services/database.types';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { BountyCompactItem } from './bounty-compact-item';

const VISIBLE_LIMIT = 5;
// Only bounties still visibly "posted" — excludes archived/deleted/cancelled/
// cancellation_requested so an admin-removed listing never resurfaces here.
// See supabase/migrations/20260905000000_profile_overhaul_banner_and_stats.sql.
const POSTED_STATUSES = ['open', 'in_progress', 'completed'];

interface ProfileBountyHistorySectionProps {
  userId?: string;
  isOwnProfile?: boolean;
}

export function ProfileBountyHistorySection({
  userId,
  isOwnProfile = false,
}: ProfileBountyHistorySectionProps) {
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    bountyService
      .getByUserId(userId, { statuses: POSTED_STATUSES, limit: VISIBLE_LIMIT })
      .then((result) => {
        if (!cancelled) setBounties(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bounty history');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Bounties Posted</Text>
      {loading ? (
        <ActivityIndicator size="small" color={theme.primary} style={styles.loadingIndicator} />
      ) : error ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Couldn&apos;t load bounty history. Pull to refresh.</Text>
        </View>
      ) : bounties.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {isOwnProfile
              ? 'Your posted bounties will appear here.'
              : "Hasn't posted any bounties yet."}
          </Text>
        </View>
      ) : (
        bounties.map((bounty) => (
          <BountyCompactItem
            key={String(bounty.id)}
            id={bounty.id}
            title={bounty.title}
            username={bounty.username}
            price={bounty.amount}
            distance={bounty.distance ?? null}
            location={bounty.location}
            isForHonor={bounty.is_for_honor}
            user_id={bounty.poster_id || bounty.user_id}
            work_type={bounty.work_type}
            poster_avatar={bounty.poster_avatar}
          />
        ))
      )}
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    section: {
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 12,
    },
    loadingIndicator: {
      marginVertical: 16,
    },
    emptyBox: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    emptyText: {
      fontSize: 13,
      color: theme.textSecondary,
      textAlign: 'center',
    },
  });
}
