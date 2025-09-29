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
  return (
    <View 
      style={[styles.container, style]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${description}`}
    >
      <View style={styles.iconContainer}>
        <MaterialIcons 
          name={icon} 
          size={48} 
          color="rgba(16, 185, 129, 0.4)" 
          accessibilityElementsHidden={true}
        />
      </View>
      
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
        title="No bounties match this filter"
        description={`Try browsing other categories or clearing your ${filter} filter to see more opportunities.`}
        actionLabel="Clear Filter"
        onAction={onClearFilter}
      />
    );
  }

  return (
    <EmptyState
      icon="work-outline"
      title="No bounties available"
      description="Be the first to post a bounty! Create opportunities for others to earn while helping you complete tasks."
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
    backgroundColor: 'rgba(16, 97, 62, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    // Add subtle glow
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
    // Add subtle text shadow
    textShadowColor: 'rgba(16, 185, 129, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  description: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  actionButton: {
    minWidth: 160,
  },
});