/**
 * Theme Showcase Example
 * 
 * This file demonstrates how to use the emerald theme system and animated components
 * You can use this as a reference when implementing new features
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { ThemeProvider } from '../components/theme-provider';
import { useAppTheme } from '../hooks/use-app-theme';
import { AnimatedCard } from '../components/ui/animated-card';
import { AnimatedScreen } from '../components/ui/animated-screen';
import { EmptyState, BountyEmptyState } from '../components/ui/empty-state';
import { Button } from '../components/ui/button';

/**
 * Example 1: Using theme tokens in custom components
 */
function ThemedContainer() {
  const { colors, spacing, shadows, borderRadius } = useAppTheme();

  const styles = StyleSheet.create({
    container: {
      backgroundColor: colors.background.surface,
      padding: spacing.lg,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border.muted,
      ...shadows.md,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text.primary,
      marginBottom: spacing.md,
    },
    description: {
      fontSize: 15,
      color: colors.text.secondary,
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Themed Container</Text>
      <Text style={styles.description}>
        This container uses theme tokens for consistent styling
      </Text>
    </View>
  );
}

/**
 * Example 2: Button variants showcase
 */
function ButtonShowcase() {
  const { spacing } = useAppTheme();

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
        Button Variants
      </Text>
      
      <Button onPress={() => console.log('Default pressed')}>
        Default Button
      </Button>
      
      <Button variant="outline" onPress={() => console.log('Outline pressed')}>
        Outline Button
      </Button>
      
      <Button variant="secondary" onPress={() => console.log('Secondary pressed')}>
        Secondary Button
      </Button>
      
      <Button variant="ghost" onPress={() => console.log('Ghost pressed')}>
        Ghost Button
      </Button>
      
      <Button variant="destructive" onPress={() => console.log('Delete pressed')}>
        Delete Action
      </Button>
      
      <Button disabled onPress={() => console.log('Should not fire')}>
        Disabled Button
      </Button>
    </View>
  );
}

/**
 * Example 3: AnimatedCard variations
 */
function CardShowcase() {
  const [expanded, setExpanded] = useState(false);
  const { spacing } = useAppTheme();

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
        Animated Cards
      </Text>

      {/* Basic card */}
      <AnimatedCard>
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
          Basic Card
        </Text>
        <Text style={{ color: 'rgba(255, 254, 245, 0.8)', marginTop: 8 }}>
          Static card with default styling
        </Text>
      </AnimatedCard>

      {/* Elevated card with press feedback */}
      <AnimatedCard 
        variant="elevated" 
        pressable 
        onPress={() => console.log('Card pressed')}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
          Pressable Elevated Card
        </Text>
        <Text style={{ color: 'rgba(255, 254, 245, 0.8)', marginTop: 8 }}>
          Tap to see press animation with emerald glow
        </Text>
      </AnimatedCard>

      {/* Expandable card */}
      <AnimatedCard 
        expandable
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
          Expandable Card {expanded ? '▼' : '▶'}
        </Text>
        {expanded && (
          <Text style={{ color: 'rgba(255, 254, 245, 0.8)', marginTop: 8 }}>
            This content appears when expanded with smooth LayoutAnimation
          </Text>
        )}
      </AnimatedCard>
    </View>
  );
}

/**
 * Example 4: Empty states
 */
function EmptyStateShowcase() {
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'completed'>('all');
  const { spacing } = useAppTheme();

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
        Empty States
      </Text>

      {/* Filter controls */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button 
          size="sm" 
          variant={filter === 'all' ? 'default' : 'outline'}
          onPress={() => setFilter('all')}
        >
          All
        </Button>
        <Button 
          size="sm"
          variant={filter === 'open' ? 'default' : 'outline'}
          onPress={() => setFilter('open')}
        >
          Open
        </Button>
        <Button 
          size="sm"
          variant={filter === 'in_progress' ? 'default' : 'outline'}
          onPress={() => setFilter('in_progress')}
        >
          In Progress
        </Button>
        <Button 
          size="sm"
          variant={filter === 'completed' ? 'default' : 'outline'}
          onPress={() => setFilter('completed')}
        >
          Completed
        </Button>
      </View>

      {/* Empty state with filter-specific messaging */}
      <View style={{ minHeight: 300 }}>
        <BountyEmptyState 
          filter={filter}
          onClearFilter={() => setFilter('all')}
        />
      </View>
    </View>
  );
}

/**
 * Example 5: Screen transitions
 */
function ScreenTransitionShowcase() {
  const [animationType, setAnimationType] = useState<'fade' | 'slide' | 'scale'>('fade');
  const [key, setKey] = useState(0);

  const triggerTransition = (type: 'fade' | 'slide' | 'scale') => {
    setAnimationType(type);
    setKey(prev => prev + 1); // Force remount to show animation
  };

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600', marginBottom: 16 }}>
        Screen Transitions
      </Text>

      {/* Animation type controls */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button 
          size="sm"
          variant={animationType === 'fade' ? 'default' : 'outline'}
          onPress={() => triggerTransition('fade')}
        >
          Fade
        </Button>
        <Button 
          size="sm"
          variant={animationType === 'slide' ? 'default' : 'outline'}
          onPress={() => triggerTransition('slide')}
        >
          Slide
        </Button>
        <Button 
          size="sm"
          variant={animationType === 'scale' ? 'default' : 'outline'}
          onPress={() => triggerTransition('scale')}
        >
          Scale
        </Button>
      </View>

      {/* Animated content */}
      <AnimatedScreen key={key} animationType={animationType} duration={400}>
        <AnimatedCard variant="elevated">
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
            Current Animation: {animationType}
          </Text>
          <Text style={{ color: 'rgba(255, 254, 245, 0.8)', marginTop: 8 }}>
            Click a button above to see the animation again
          </Text>
        </AnimatedCard>
      </AnimatedScreen>
    </View>
  );
}

/**
 * Main showcase component
 */
export default function ThemeShowcase() {
  const { colors, spacing } = useAppTheme();

  return (
    <ThemeProvider>
      <ScrollView 
        style={{ 
          flex: 1, 
          backgroundColor: colors.background.primary,
        }}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing['2xl'],
        }}
      >
        <View>
          <Text style={{ 
            color: colors.text.primary, 
            fontSize: 28, 
            fontWeight: '700',
            marginBottom: spacing.md,
          }}>
            Theme System Showcase
          </Text>
          <Text style={{ 
            color: colors.text.secondary, 
            fontSize: 16,
            marginBottom: spacing.lg,
          }}>
            Emerald-themed components with micro-interactions
          </Text>
        </View>

        <ThemedContainer />
        <ButtonShowcase />
        <CardShowcase />
        <EmptyStateShowcase />
        <ScreenTransitionShowcase />

        <View style={{ paddingBottom: spacing['4xl'] }} />
      </ScrollView>
    </ThemeProvider>
  );
}
