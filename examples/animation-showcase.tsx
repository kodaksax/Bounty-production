/**
 * Animation Showcase Screen
 * 
 * This example screen demonstrates all the new animation components.
 * Use this as a reference for implementing animations in your own screens.
 * 
 * To test: Navigate to this screen and interact with the buttons.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { SkeletonCard, SkeletonCardList } from '../components/ui/skeleton-card';
import { SuccessAnimation, ConfettiAnimation } from '../components/ui/success-animation';
import { AccessibleTouchable, AccessibleIconButton } from '../components/ui/accessible-touchable';
import { MaterialIcons } from '@expo/vector-icons';
import { PostingsListSkeleton } from '../components/ui/skeleton-loaders';

export default function AnimationShowcaseScreen() {
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showSkeletons, setShowSkeletons] = useState(false);
  const [showEmptyState, setShowEmptyState] = useState(false);

  const triggerSuccess = () => {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const triggerConfetti = () => {
    setShowConfetti(true);
    setShowSuccess(true);
    setTimeout(() => {
      setShowConfetti(false);
      setShowSuccess(false);
    }, 3000);
  };

  const toggleSkeletons = () => {
    setShowSkeletons(!showSkeletons);
  };

  const toggleEmptyState = () => {
    setShowEmptyState(!showEmptyState);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Animation Showcase</Text>
          <Text style={styles.subtitle}>
            Tap buttons to see different animations in action
          </Text>
        </View>

        {/* Section 1: Button Animations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Button Press Animations</Text>
          <Text style={styles.description}>
            All buttons scale to 0.95 on press with haptic feedback
          </Text>
          
          <View style={styles.buttonRow}>
            <Button onPress={() => console.log('Pressed!')} size="sm">
              Small
            </Button>
            <Button onPress={() => console.log('Pressed!')} size="default">
              Default
            </Button>
            <Button onPress={() => console.log('Pressed!')} size="lg">
              Large
            </Button>
          </View>

          <View style={styles.buttonRow}>
            <Button variant="destructive" onPress={() => console.log('Danger!')}>
              Destructive
            </Button>
            <Button variant="outline" onPress={() => console.log('Outlined!')}>
              Outline
            </Button>
          </View>
        </View>

        {/* Section 2: Success Animations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Success Animations</Text>
          <Text style={styles.description}>
            Checkmark and confetti animations for celebrations
          </Text>
          
          <View style={styles.buttonRow}>
            <Button onPress={triggerSuccess}>
              Show Success ✓
            </Button>
            <Button onPress={triggerConfetti}>
              Success + Confetti 🎉
            </Button>
          </View>
        </View>

        {/* Section 3: Skeleton Loaders */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Skeleton Loaders</Text>
          <Text style={styles.description}>
            Animated placeholder cards with shimmer effect
          </Text>
          
          <Button onPress={toggleSkeletons}>
            {showSkeletons ? 'Hide' : 'Show'} Skeletons
          </Button>

          {showSkeletons && (
            <View style={styles.skeletonsContainer}>
              <Text style={styles.label}>Bounty Card Skeleton:</Text>
              <SkeletonCard />
              
              <Text style={styles.label}>Multiple Skeletons:</Text>
              <PostingsListSkeleton count={2} />
            </View>
          )}
        </View>

        {/* Section 4: Empty States */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Empty State Animations</Text>
          <Text style={styles.description}>
            Bounce entrance with subtle float effect
          </Text>
          
          <Button onPress={toggleEmptyState}>
            {showEmptyState ? 'Hide' : 'Show'} Empty State
          </Button>

          {showEmptyState && (
            <View style={styles.emptyStateContainer}>
              <EmptyState
                icon="inbox"
                title="Nothing Here Yet"
                description="This is what users see when there's no content. The icon bounces in and has a subtle floating animation."
                actionLabel="Create Something"
                onAction={() => console.log('Action clicked!')}
                size="sm"
              />
            </View>
          )}
        </View>

        {/* Section 5: Accessible Touchables */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Accessible Touchables</Text>
          <Text style={styles.description}>
            Custom touchables with built-in haptics and animations
          </Text>
          
          <View style={styles.buttonRow}>
            <AccessibleTouchable
              onPress={() => console.log('Custom touchable pressed!')}
              haptic="medium"
              accessibilityLabel="Custom button"
            >
              <View style={styles.customButton}>
                <Text style={styles.customButtonText}>Custom Button</Text>
              </View>
            </AccessibleTouchable>

            <AccessibleIconButton
              size="md"
              onPress={() => console.log('Icon button pressed!')}
              haptic="light"
              accessibilityLabel="Settings"
            >
              <MaterialIcons name="settings" size={24} color="#10b981" />
            </AccessibleIconButton>

            <AccessibleIconButton
              size="lg"
              onPress={() => console.log('Large icon pressed!')}
              haptic="heavy"
              accessibilityLabel="Favorite"
            >
              <MaterialIcons name="favorite" size={32} color="#ef4444" />
            </AccessibleIconButton>
          </View>
        </View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <MaterialIcons name="info-outline" size={24} color="#6ee7b7" />
          <Text style={styles.infoText}>
            All animations respect reduced motion preferences and include haptic feedback for better accessibility.
          </Text>
        </View>
      </ScrollView>

      {/* Overlay Animations */}
      <SuccessAnimation
        visible={showSuccess}
        icon="check-circle"
        size={80}
        color="#10b981"
      />
      <ConfettiAnimation visible={showConfetti} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
    paddingTop: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,254,245,0.7)',
    lineHeight: 22,
  },
  section: {
    marginBottom: 32,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#6ee7b7',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.7)',
    marginBottom: 16,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    color: '#6ee7b7',
    marginTop: 16,
    marginBottom: 8,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  customButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  customButtonText: {
    color: '#10b981',
    fontSize: 15,
    fontWeight: '600',
  },
  skeletonsContainer: {
    marginTop: 16,
  },
  emptyStateContainer: {
    marginTop: 16,
    minHeight: 300,
  },
  infoSection: {
    flexDirection: 'row',
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  infoText: {
    flex: 1,
    color: '#6ee7b7',
    fontSize: 13,
    lineHeight: 18,
  },
});
