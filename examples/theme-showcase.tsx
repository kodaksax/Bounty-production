/**
 * Theme Showcase Example
 *
 * This file demonstrates how to use the emerald theme system and animated components
 * You can use this as a reference when implementing new features
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ThemeProvider } from '../components/theme-provider';
import { AnimatedCard } from '../components/ui/animated-card';
import { AnimatedScreen } from '../components/ui/animated-screen';
import { Button } from '../components/ui/button';
import { BountyEmptyState } from '../components/ui/empty-state';
import { useAppTheme } from '../hooks/use-app-theme';

/**
 * Example 1: Using theme tokens in custom components
 */
function ThemedContainer() {
  const { theme } = useAppTheme();

  const styles = StyleSheet.create({
    container: {
      backgroundColor: theme.surface,
      padding: 24,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 16,
    },
    description: {
      fontSize: 15,
      color: theme.textSecondary,
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
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: '#fffef5', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
        Button Variants
      </Text>

      <Button onPress={() => console.log('Default pressed')}>Default Button</Button>

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

  return (
    <View style={{ gap: 24 }}>
      <Text style={{ color: '#fffef5', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
        Animated Cards
      </Text>

      {/* Basic card */}
      <AnimatedCard>
        <Text style={{ color: '#fffef5', fontSize: 16, fontWeight: '600' }}>Basic Card</Text>
        <Text style={{ color: 'rgba(255, 254, 245, 0.8)', marginTop: 8 }}>
          Static card with default styling
        </Text>
      </AnimatedCard>

      {/* Elevated card with press feedback */}
      <AnimatedCard variant="elevated" pressable onPress={() => console.log('Card pressed')}>
        <Text style={{ color: '#fffef5', fontSize: 16, fontWeight: '600' }}>
          Pressable Elevated Card
        </Text>
        <Text style={{ color: 'rgba(255, 254, 245, 0.8)', marginTop: 8 }}>
          Tap to see press animation with emerald glow
        </Text>
      </AnimatedCard>

      {/* Expandable card */}
      <AnimatedCard expandable expanded={expanded} onToggle={() => setExpanded(!expanded)}>
        <Text style={{ color: '#fffef5', fontSize: 16, fontWeight: '600' }}>
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

  return (
    <View style={{ gap: 24 }}>
      <Text style={{ color: '#fffef5', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
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
        <BountyEmptyState filter={filter} onClearFilter={() => setFilter('all')} />
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
      <Text style={{ color: '#fffef5', fontSize: 18, fontWeight: '600', marginBottom: 16 }}>
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
          <Text style={{ color: '#fffef5', fontSize: 16, fontWeight: '600' }}>
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
  const { theme } = useAppTheme();

  return (
    <ThemeProvider>
      <ScrollView
        style={{
          flex: 1,
          backgroundColor: theme.background,
        }}
        contentContainerStyle={{
          padding: 24,
          gap: 32,
        }}
      >
        <View>
          <Text
            style={{
              color: theme.text,
              fontSize: 28,
              fontWeight: '700',
              marginBottom: 16,
            }}
          >
            Theme System Showcase
          </Text>
          <Text
            style={{
              color: theme.textSecondary,
              fontSize: 16,
              marginBottom: 24,
            }}
          >
            Emerald-themed components with micro-interactions
          </Text>
        </View>

        <ThemedContainer />
        <ButtonShowcase />
        <CardShowcase />
        <EmptyStateShowcase />
        <ScreenTransitionShowcase />

        <View style={{ paddingBottom: 64 }} />
      </ScrollView>
    </ThemeProvider>
  );
}
