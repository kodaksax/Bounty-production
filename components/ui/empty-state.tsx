import React from 'react';
import { View, Text, StyleSheet, ViewStyle, Animated, AccessibilityInfo } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SPACING, SIZING, TYPOGRAPHY, A11Y } from '../../lib/constants/accessibility';
import { Button } from './button';

interface EmptyStateProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Secondary action for additional options
   */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /**
   * Visual variant for different contexts
   */
  variant?: 'default' | 'compact' | 'card';
  /**
   * Size of the empty state
   */
  size?: 'sm' | 'md' | 'lg';
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
  secondaryActionLabel,
  onSecondaryAction,
  variant = 'default',
  size = 'md',
  style 
}: EmptyStateProps) {
  const iconScale = React.useRef(new Animated.Value(0)).current;
  const contentOpacity = React.useRef(new Animated.Value(0)).current;
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  // Check for reduced motion preference
  React.useEffect(() => {
    const checkMotionPreference = async () => {
      try {
        const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
        setPrefersReducedMotion(isReduceMotionEnabled);
      } catch {
        setPrefersReducedMotion(false);
      }
    };
    checkMotionPreference();
  }, []);

  React.useEffect(() => {
    const animDuration = prefersReducedMotion ? 0 : A11Y.ANIMATION_SLOW;
    const contentDuration = prefersReducedMotion ? 0 : A11Y.ANIMATION_NORMAL;

    Animated.sequence([
      Animated.timing(iconScale, {
        toValue: 1,
        duration: animDuration,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: contentDuration,
        useNativeDriver: true,
      }),
    ]).start();
  }, [iconScale, contentOpacity, prefersReducedMotion]);

  // Size-based configuration
  const sizeConfig = {
    sm: {
      iconSize: 36,
      iconContainerSize: SIZING.AVATAR_LARGE,
      titleSize: TYPOGRAPHY.SIZE_BODY,
      descSize: TYPOGRAPHY.SIZE_SMALL,
      padding: SPACING.SCREEN_HORIZONTAL,
    },
    md: {
      iconSize: 48,
      iconContainerSize: SIZING.AVATAR_XLARGE,
      titleSize: TYPOGRAPHY.SIZE_LARGE,
      descSize: TYPOGRAPHY.SIZE_DEFAULT,
      padding: 32,
    },
    lg: {
      iconSize: 56,
      iconContainerSize: SIZING.AVATAR_XLARGE + 16,
      titleSize: TYPOGRAPHY.SIZE_XLARGE,
      descSize: TYPOGRAPHY.SIZE_BODY,
      padding: 40,
    },
  };

  const config = sizeConfig[size];

  return (
    <View 
      style={[
        styles.container, 
        variant === 'card' && styles.cardContainer,
        variant === 'compact' && styles.compactContainer,
        { paddingHorizontal: config.padding },
        style
      ]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${description}`}
    >
      <Animated.View 
        style={[
          styles.iconContainer,
          {
            width: config.iconContainerSize,
            height: config.iconContainerSize,
            borderRadius: config.iconContainerSize / 2,
            transform: [{ scale: iconScale }],
          },
        ]}
      >
        <MaterialIcons 
          name={icon} 
          size={config.iconSize} 
          color="#007423" 
          accessibilityElementsHidden={true}
        />
      </Animated.View>
      
      <Animated.View style={{ opacity: contentOpacity }}>
        <Text 
          style={[styles.title, { fontSize: config.titleSize }]} 
          accessibilityRole="header"
        >
          {title}
        </Text>
        
        <Text style={[styles.description, { fontSize: config.descSize }]}>
          {description}
        </Text>
        
        {(actionLabel && onAction) && (
          <Button
            onPress={onAction}
            style={styles.actionButton}
            accessibilityLabel={actionLabel}
            accessibilityHint="Primary action for this empty state"
          >
            {actionLabel}
          </Button>
        )}

        {(secondaryActionLabel && onSecondaryAction) && (
          <Button
            variant="ghost"
            onPress={onSecondaryAction}
            style={styles.secondaryButton}
            accessibilityLabel={secondaryActionLabel}
            accessibilityHint="Secondary action for this empty state"
          >
            {secondaryActionLabel}
          </Button>
        )}
      </Animated.View>
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
  cardContainer: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginHorizontal: SPACING.SCREEN_HORIZONTAL,
    marginVertical: SPACING.ELEMENT_GAP,
  },
  compactContainer: {
    paddingVertical: SPACING.SECTION_GAP,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
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
  secondaryButton: {
    marginTop: SPACING.COMPACT_GAP,
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
