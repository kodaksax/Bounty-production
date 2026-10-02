import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRatings } from '../hooks/useRatings';
import { formatRelativeDate } from '../lib/utils/format-relative-date';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import type { UserRating } from '../lib/types';
import { showReportAlert } from './ReportModal';

// Show the 2 most recent reviews by default, with a "See all" expansion for
// the rest -- a lightweight trust signal, not a full review feed.
const COLLAPSED_LIMIT = 2;
const FETCH_LIMIT = 20;

function Stars({ score, theme }: { score: number; theme: AppTheme }) {
  const full = Math.round(Math.max(0, Math.min(5, score)));
  return (
    <View style={{ flexDirection: 'row' }} accessibilityLabel={`${full} out of 5 stars`}>
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

/** "Poster @sam" / "Hunter @sam" -- who left the review and from which side of the job. */
export function reviewerLabel(review: Pick<UserRating, 'raterRole' | 'raterName'>): string | null {
  const role = review.raterRole === 'poster' ? 'Poster' : review.raterRole === 'hunter' ? 'Hunter' : null;
  const name = review.raterName ? `@${review.raterName}` : null;
  if (role && name) return `${role} ${name}`;
  return role ?? name;
}

/** What the rating was for: the bounty, and whether money changed hands. */
export function reviewTransactionLabel(review: Pick<UserRating, 'bountyTitle' | 'isForHonor' | 'bountyId'>): string | null {
  if (!review.bountyId) return null;
  const title = review.bountyTitle?.trim() ? `"${review.bountyTitle.trim()}"` : 'A completed bounty';
  if (review.isForHonor === undefined) return title;
  return `${title} · ${review.isForHonor ? 'For honor' : 'Paid job'}`;
}

/**
 * Reviews behind a profile's rating. Every rating counted in the profile's
 * "N reviews" appears here -- including star-only ratings, which used to be
 * filtered out and left "1 review" with nothing to read (trust-spine audit
 * T24). Each row says who left it, in which role, for which bounty, and when;
 * the server only returns ratings traceable to a completed transaction
 * (get_user_reviews).
 */
export function RecentReviewsSection({ userId }: { userId?: string }) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { ratings, stats, loading } = useRatings(userId, { limit: FETCH_LIMIT });
  const [expanded, setExpanded] = useState(false);

  if (!userId || loading) return null;
  if (ratings.length === 0) return null;

  const total = Math.max(stats.ratingCount, ratings.length);
  const visibleReviews = expanded ? ratings : ratings.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = ratings.length - visibleReviews.length;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {total} review{total === 1 ? '' : 's'}
      </Text>
      {visibleReviews.map((review) => {
        const who = reviewerLabel(review);
        const what = reviewTransactionLabel(review);
        const hasComment = !!review.comment && review.comment.trim().length > 0;
        return (
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
            {hasComment ? (
              <Text style={styles.reviewComment}>{review.comment}</Text>
            ) : (
              <Text style={styles.noComment}>No written review</Text>
            )}
            {(who || what) && (
              <Text style={styles.provenance} numberOfLines={2}>
                {[who, what].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
        );
      })}
      {hiddenCount > 0 && (
        <TouchableOpacity onPress={() => setExpanded(true)} accessibilityRole="button">
          <Text style={styles.seeAllText}>See all {ratings.length} reviews</Text>
        </TouchableOpacity>
      )}
      {expanded && total > ratings.length && (
        <Text style={styles.provenance}>Showing the {ratings.length} most recent.</Text>
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
    noComment: {
      fontSize: 13,
      color: theme.textSecondary,
      fontStyle: 'italic',
    },
    provenance: {
      fontSize: 11,
      color: theme.textSecondary,
      marginTop: 6,
    },
    seeAllText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primary,
      marginTop: 4,
    },
  });
}
