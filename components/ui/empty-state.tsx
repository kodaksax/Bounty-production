import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Button } from './button';

interface EmptyStateProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: any;
}

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

interface BountyEmptyStateProps {
  filter?: string;
  onClearFilter?: () => void;
}

export function BountyEmptyState({ filter, onClearFilter }: BountyEmptyStateProps) {
  if (filter && filter !== 'all') {
    return (
      <EmptyState
        icon="filter-list-off"
        title="No matching bounties"
        description={`We couldn't find any bounties for "${filter}". Try exploring other categories or clear your filter to discover more opportunities.`}
        actionLabel="Clear Filter"
        onAction={onClearFilter}
      />
    );
  }

  return (
    <EmptyState
      icon="work-outline"
      title="No bounties yet"
      description="Be the first to create a bounty! Post tasks, set rewards, and connect with talented people ready to help you succeed."
      actionLabel="Create First Bounty"
      onAction={() => {
        // This would navigate to create bounty screen
        console.log('Navigate to create bounty');
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 116, 35, 0.2)', // emerald-700 with opacity
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 32,
    maxWidth: 320,
  },
  actionButton: {
    minWidth: 160,
  },
});