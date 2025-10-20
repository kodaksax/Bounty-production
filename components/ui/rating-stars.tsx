import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface RatingStarsProps {
  rating: number;
  onRatingChange?: (rating: number) => void;
  readonly?: boolean;
  label?: string;
  size?: 'small' | 'medium' | 'large';
}

/**
 * Star rating component for displaying and collecting ratings.
 * @param rating - Current rating value (1-5)
 * @param onRatingChange - Callback when rating changes (if not readonly)
 * @param readonly - If true, stars are display-only
 * @param label - Optional label to display above stars
 * @param size - Size of the stars
 */
export function RatingStars({
  rating,
  onRatingChange,
  readonly = false,
  label,
  size = 'medium',
}: RatingStarsProps) {
  const starSize = size === 'small' ? 16 : size === 'large' ? 32 : 24;

  const handleStarPress = (value: number) => {
    if (!readonly && onRatingChange) {
      onRatingChange(value);
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((value) => {
          const isFilled = value <= rating;
          const StarComponent = readonly ? View : TouchableOpacity;

          return (
            <StarComponent
              key={value}
              onPress={readonly ? undefined : () => handleStarPress(value)}
              disabled={readonly}
              accessibilityRole={readonly ? undefined : 'button'}
              accessibilityLabel={`${value} star${value > 1 ? 's' : ''}`}
              accessibilityState={readonly ? undefined : { selected: isFilled }}
            >
              <MaterialIcons
                name={isFilled ? 'star' : 'star-border'}
                size={starSize}
                color={isFilled ? '#fbbf24' : 'rgba(251, 191, 36, 0.3)'}
              />
            </StarComponent>
          );
        })}
      </View>
      {!readonly && (
        <Text style={styles.hint}>
          {rating === 0 ? 'Tap to rate' : `${rating} star${rating > 1 ? 's' : ''}`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  label: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  starsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hint: {
    color: 'rgba(110,231,183,0.7)',
    fontSize: 11,
    marginTop: -4,
  },
});
