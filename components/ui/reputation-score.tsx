import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface ReputationScoreProps {
  averageRating: number;
  ratingCount: number;
  completedJobs?: number;
  showDetails?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'default' | 'compact' | 'card';
}

/**
 * Calculate reputation level based on average rating and number of ratings
 */
function getReputationLevel(averageRating: number, ratingCount: number): {
  level: string;
  color: string;
  description: string;
} {
  if (ratingCount === 0) {
    return {
      level: 'New',
      color: '#9ca3af', // gray-400
      description: 'This user is new and has not yet received any ratings.',
    };
  }

  // Weight by both rating and count
  const weightedScore = averageRating * Math.min(1, ratingCount / 5);

  if (weightedScore >= 4.5) {
    return {
      level: 'Excellent',
      color: '#10b981', // emerald-500
      description: 'Top-rated user with consistently excellent feedback from multiple transactions.',
    };
  } else if (weightedScore >= 4.0) {
    return {
      level: 'Great',
      color: '#34d399', // emerald-400
      description: 'Highly rated user with very positive feedback from completed transactions.',
    };
  } else if (weightedScore >= 3.5) {
    return {
      level: 'Good',
      color: '#fbbf24', // amber-400
      description: 'Reliable user with generally positive feedback.',
    };
  } else if (weightedScore >= 2.5) {
    return {
      level: 'Fair',
      color: '#f97316', // orange-500
      description: 'User has received mixed feedback. Consider reviewing their history carefully.',
    };
  } else {
    return {
      level: 'Low',
      color: '#ef4444', // red-500
      description: 'This user has received negative feedback. Exercise caution when engaging.',
    };
  }
}

/**
 * ReputationScore - Prominently displays user reputation scores with context
 * 
 * @param averageRating - Average rating (0-5)
 * @param ratingCount - Total number of ratings received
 * @param completedJobs - Number of completed jobs (optional)
 * @param showDetails - Whether to show tap-to-explain functionality
 * @param size - Size variant
 * @param variant - Display variant
 */
export function ReputationScore({
  averageRating,
  ratingCount,
  completedJobs = 0,
  showDetails = true,
  size = 'medium',
  variant = 'default',
}: ReputationScoreProps) {
  const [showModal, setShowModal] = useState(false);
  const reputation = getReputationLevel(averageRating, ratingCount);
  
  const iconSize = size === 'small' ? 14 : size === 'large' ? 24 : 18;
  const scoreFontSize = size === 'small' ? 16 : size === 'large' ? 28 : 22;
  const labelFontSize = size === 'small' ? 10 : size === 'large' ? 14 : 12;

  // Render stars
  const renderStars = (starSize: number = iconSize) => {
    const stars = [];
    const fullStars = Math.floor(averageRating);
    const hasHalfStar = averageRating - fullStars >= 0.5;
    
    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(
          <MaterialIcons key={i} name="star" size={starSize} color="#fbbf24" />
        );
      } else if (i === fullStars && hasHalfStar) {
        stars.push(
          <MaterialIcons key={i} name="star-half" size={starSize} color="#fbbf24" />
        );
      } else {
        stars.push(
          <MaterialIcons key={i} name="star-border" size={starSize} color="rgba(251, 191, 36, 0.3)" />
        );
      }
    }
    return stars;
  };

  const Content = (
    <View style={[
      styles.container,
      variant === 'card' && styles.cardContainer,
      variant === 'compact' && styles.compactContainer,
    ]}>
      {/* Main Score Display */}
      <View style={styles.scoreSection}>
        <Text style={[styles.scoreValue, { fontSize: scoreFontSize }]}>
          {ratingCount > 0 ? averageRating.toFixed(1) : '—'}
        </Text>
        <View style={styles.starsRow}>
          {renderStars()}
        </View>
        <Text style={[styles.ratingCount, { fontSize: labelFontSize }]}>
          {ratingCount === 0 
            ? 'No ratings yet' 
            : `${ratingCount} rating${ratingCount !== 1 ? 's' : ''}`}
        </Text>
      </View>

      {/* Reputation Level Badge */}
      <View style={[styles.levelBadge, { backgroundColor: `${reputation.color}20` }]}>
        <MaterialIcons 
          name={reputation.level === 'Excellent' ? 'emoji-events' : 'trending-up'} 
          size={iconSize} 
          color={reputation.color} 
        />
        <Text style={[styles.levelText, { color: reputation.color, fontSize: labelFontSize }]}>
          {reputation.level}
        </Text>
      </View>

      {/* Completed Jobs (if variant is card and completedJobs provided) */}
      {variant === 'card' && completedJobs > 0 && (
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <MaterialIcons name="check-circle" size={14} color="#6ee7b7" />
            <Text style={styles.statText}>{completedJobs} completed</Text>
          </View>
        </View>
      )}

      {/* Info icon for tap hint */}
      {showDetails && (
        <View style={styles.infoHint}>
          <MaterialIcons name="info-outline" size={12} color="#6ee7b7" style={{ opacity: 0.6 }} />
        </View>
      )}
    </View>
  );

  if (!showDetails) {
    return Content;
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setShowModal(true)}
        accessibilityRole="button"
        accessibilityLabel={`Reputation score: ${averageRating.toFixed(1)} stars, ${reputation.level}. Tap for details.`}
      >
        {Content}
      </TouchableOpacity>

      {/* Details Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowModal(false)}
        >
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reputation Score</Text>
              <View style={styles.modalScoreDisplay}>
                <Text style={styles.modalScore}>
                  {ratingCount > 0 ? averageRating.toFixed(1) : '—'}
                </Text>
                <View style={styles.modalStars}>
                  {renderStars(24)}
                </View>
              </View>
            </View>

            <View style={[styles.modalLevelBadge, { backgroundColor: `${reputation.color}20` }]}>
              <MaterialIcons 
                name={reputation.level === 'Excellent' ? 'emoji-events' : 'trending-up'} 
                size={24} 
                color={reputation.color} 
              />
              <View>
                <Text style={[styles.modalLevelText, { color: reputation.color }]}>
                  {reputation.level} Reputation
                </Text>
                <Text style={styles.modalLevelDescription}>{reputation.description}</Text>
              </View>
            </View>

            {/* Stats Summary */}
            <View style={styles.modalStats}>
              <View style={styles.modalStatItem}>
                <Text style={styles.modalStatValue}>{ratingCount}</Text>
                <Text style={styles.modalStatLabel}>Total Ratings</Text>
              </View>
              {completedJobs > 0 && (
                <View style={styles.modalStatItem}>
                  <Text style={styles.modalStatValue}>{completedJobs}</Text>
                  <Text style={styles.modalStatLabel}>Jobs Completed</Text>
                </View>
              )}
            </View>

            {/* How Reputation Works */}
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>How Reputation Works</Text>
              <Text style={styles.infoText}>
                Reputation is calculated based on average ratings and the number of completed transactions. 
                Higher ratings and more activity lead to better reputation levels.
              </Text>
            </View>

            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowModal(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * ReputationScoreCompact - Minimal inline reputation display
 */
export function ReputationScoreCompact({ 
  averageRating, 
  ratingCount 
}: { 
  averageRating: number; 
  ratingCount: number 
}) {
  const reputation = getReputationLevel(averageRating, ratingCount);
  
  return (
    <View style={styles.compactInline}>
      <MaterialIcons name="star" size={14} color="#fbbf24" />
      <Text style={styles.compactScore}>
        {ratingCount > 0 ? averageRating.toFixed(1) : '—'}
      </Text>
      <View style={[styles.compactDot, { backgroundColor: reputation.color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(5, 95, 70, 0.3)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  cardContainer: {
    padding: 16,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 12,
  },
  scoreSection: {
    alignItems: 'center',
    marginBottom: 8,
  },
  scoreValue: {
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: 4,
  },
  ratingCount: {
    color: '#a7f3d0',
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  levelText: {
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#a7f3d0',
  },
  infoHint: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  compactInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compactScore: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  compactDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#065f46',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a7f3d0',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  modalScoreDisplay: {
    alignItems: 'center',
  },
  modalScore: {
    fontSize: 48,
    fontWeight: '800',
    color: '#fff',
  },
  modalStars: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  modalLevelBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  modalLevelText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalLevelDescription: {
    fontSize: 12,
    color: '#d1fae5',
    lineHeight: 18,
    flex: 1,
  },
  modalStats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 20,
  },
  modalStatItem: {
    alignItems: 'center',
  },
  modalStatValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  modalStatLabel: {
    fontSize: 12,
    color: '#a7f3d0',
    marginTop: 2,
  },
  infoBox: {
    backgroundColor: 'rgba(6, 78, 59, 0.5)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6ee7b7',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 12,
    color: '#d1fae5',
    lineHeight: 18,
  },
  closeButton: {
    backgroundColor: '#10b981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
