import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
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
 * EmptyState component with emerald theming and entrance animations
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
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 300,
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
    paddingVertical: 48,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(0, 145, 44, 0.1)', // emerald-500 background
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: 'rgba(0, 145, 44, 0.3)', // emerald-600 border
    // Enhanced emerald glow
    shadowColor: '#00912C', // emerald-600
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fffef5',
    textAlign: 'center',
    marginBottom: 12,
    // Emerald text shadow
    textShadowColor: 'rgba(0, 145, 44, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  description: {
    fontSize: 15,
    color: 'rgba(255, 254, 245, 0.8)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  actionButton: {
    marginTop: 8,
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
