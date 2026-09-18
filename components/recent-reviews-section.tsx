import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRatings } from '../hooks/useRatings';
import { formatRelativeDate } from '../lib/utils/format-relative-date';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { showReportAlert } from './ReportModal';

// Step 4 of the ratings/reviews loop: show the 2 most recent reviews by
// default, with a "See all" expansion for the rest -- not an unbounded list,
// which would turn a lightweight trust signal into a full review feed.
const COLLAPSED_LIMIT = 2;

function Stars({ score, theme }: { score: number; theme: AppTheme }) {
  const full = Math.round(Math.max(0, Math.min(5, score)));
  return (
    <View style={{ flexDirection: 'row' }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <MaterialIcons
          key={i}
          name={i < full ? 'star' : 'star-border'}
          size={14}
          color={i < full ? '#fbbf24' : theme.textSecondary}
        />
      ))}
    </View>
  );
}

/**
 * "Recent reviews" — the actual comment text left by other posters, which
 * the ratings table has always collected but no UI ever rendered (only the
 * aggregate average was ever shown). Deliberately anonymous (no reviewer
 * name/avatar) to keep this a small, safe addition rather than a second
 * identity surface to get wrong.
 */
export function RecentReviewsSection({ userId }: { userId?: string }) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // This surface only ever renders the individual `ratings` list -- skip the
  // aggregated-stats fetch (an unbounded scan of every rating row for the
  // user) that useRatings would otherwise do in parallel for nothing.
  const { ratings, loading } = useRatings(userId, { includeStats: false });
  const [expanded, setExpanded] = useState(false);

  const reviewsWithComments = useMemo(
    () => ratings.filter((r) => !!r.comment && r.comment.trim().length > 0),
    [ratings]
  );
  const visibleReviews = expanded
    ? reviewsWithComments
    : reviewsWithComments.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = reviewsWithComments.length - visibleReviews.length;

  if (!userId || loading) return null;
  if (reviewsWithComments.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recent reviews</Text>
      {visibleReviews.map((review) => (
        <View key={review.id} style={styles.reviewCard}>
          <View style={styles.reviewHeader}>
            <Stars score={review.score} theme={theme} />
            <View style={styles.reviewHeaderRight}>
              <Text style={styles.reviewDate}>{formatRelativeDate(review.createdAt)}</Text>
              <TouchableOpacity
                onPress={() => showReportAlert('rating', review.id, undefined)}
                accessibilityRole="button"
                accessibilityLabel="Report this review"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="flag" size={14} color={theme.textDisabled} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.reviewComment}>{review.comment}</Text>
        </View>
      ))}
      {hiddenCount > 0 && (
        <TouchableOpacity onPress={() => setExpanded(true)} accessibilityRole="button">
          <Text style={styles.seeAllText}>See all {reviewsWithComments.length} reviews</Text>
        </TouchableOpacity>
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
    reviewCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    reviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    reviewHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    reviewDate: {
      fontSize: 11,
      color: theme.textSecondary,
    },
    reviewComment: {
      fontSize: 13,
      color: theme.text,
      lineHeight: 19,
    },
    seeAllText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primary,
      marginTop: 4,
    },
  });
}
