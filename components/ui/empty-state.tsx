import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SPACING, SIZING, TYPOGRAPHY, A11Y } from '../../lib/constants/accessibility';
import { Button } from './button';

interface EmptyStateProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

/**
 * EmptyState component with brand theming and entrance animations
 * Provides helpful messaging and optional CTA for empty data states
 */
export function EmptyState({ 
  icon = 'search-off', 
  title, 
  description, 
  actionLabel, 
  onAction,
  style 
}: EmptyStateProps) {
  const iconScale = React.useRef(new (require('react-native').Animated.Value)(0)).current;
  const contentOpacity = React.useRef(new (require('react-native').Animated.Value)(0)).current;
  const Animated = require('react-native').Animated;

  React.useEffect(() => {
    Animated.sequence([
      Animated.timing(iconScale, {
        toValue: 1,
        duration: A11Y.ANIMATION_SLOW,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: A11Y.ANIMATION_NORMAL,
        useNativeDriver: true,
      }),
    ]).start();
  }, [iconScale, contentOpacity]);

  const AnimatedView = Animated.createAnimatedComponent(View);

  return (
    <View 
      style={[styles.container, style]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${description}`}
    >
      <AnimatedView 
        style={[
          styles.iconContainer,
          {
            transform: [{ scale: iconScale }],
          },
        ]}
      >
        <MaterialIcons 
          name={icon} 
          size={48} 
          color="#007423" 
          accessibilityElementsHidden={true}
        />
      </AnimatedView>
      
      <AnimatedView style={{ opacity: contentOpacity }}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        
        <Text style={styles.description}>
          {description}
        </Text>
        
        {actionLabel && onAction && (
          <Button
            onPress={onAction}
            style={styles.actionButton}
            accessibilityLabel={actionLabel}
            accessibilityHint="Primary action for this empty state"
          >
            {actionLabel}
          </Button>
        )}
      </AnimatedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: SIZING.AVATAR_MEDIUM,
  },
  iconContainer: {
    width: SIZING.AVATAR_XLARGE,
    height: SIZING.AVATAR_XLARGE,
    borderRadius: SIZING.AVATAR_XLARGE / 2,
    backgroundColor: 'rgba(0, 142, 42, 0.1)', // brand-500 background
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.SECTION_GAP,
    borderWidth: 2,
    borderColor: 'rgba(0, 142, 42, 0.3)', // brand-500 border
    // Enhanced brand glow
    shadowColor: '#008e2a', // brand-500
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 6,
  },
  title: {
    fontSize: TYPOGRAPHY.SIZE_LARGE,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: SPACING.ELEMENT_GAP,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_LARGE * TYPOGRAPHY.LINE_HEIGHT_NORMAL),
    // Brand text shadow
    textShadowColor: 'rgba(0, 142, 42, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  description: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: Math.round(TYPOGRAPHY.SIZE_DEFAULT * TYPOGRAPHY.LINE_HEIGHT_RELAXED),
    marginBottom: SPACING.SECTION_GAP,
  },
  actionButton: {
    marginTop: SPACING.COMPACT_GAP,
    minWidth: 200,
  },
});

/**
 * BountyEmptyState - Specialized empty state for bounty lists
 */
interface BountyEmptyStateProps {
  filter?: 'all' | 'open' | 'in_progress' | 'completed';
  onClearFilter?: () => void;
}

export function BountyEmptyState({ filter = 'all', onClearFilter }: BountyEmptyStateProps) {
  const getEmptyStateContent = () => {
    switch (filter) {
      case 'open':
        return {
          icon: 'work-outline' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Open Bounties',
          description: 'There are no open bounties at the moment. Check back later or create a new one!',
        };
      case 'in_progress':
        return {
          icon: 'hourglass-empty' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Active Work',
          description: 'You don\'t have any bounties in progress. Browse available bounties to get started!',
        };
      case 'completed':
        return {
          icon: 'check-circle-outline' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Completed Bounties',
          description: 'Complete your first bounty to see it here!',
        };
      default:
        return {
          icon: 'search-off' as keyof typeof MaterialIcons.glyphMap,
          title: 'No Bounties Found',
          description: 'Start by creating your first bounty or browse available opportunities!',
        };
    }
  };

  const content = getEmptyStateContent();

  return (
    <EmptyState
      icon={content.icon}
      title={content.title}
      description={content.description}
      actionLabel={filter !== 'all' ? 'Clear Filter' : undefined}
      onAction={filter !== 'all' ? onClearFilter : undefined}
    />
  );
}
