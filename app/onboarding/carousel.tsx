/**
 * Onboarding Carousel
 * Shows 5 screens explaining app features on first launch
 * Includes a trust + intent welcome, condensed poster workflow, hunter perspective,
 * and a final trust/safety slide with role-aware CTAs
 * ("Get something done" vs "Start earning nearby").
 * Features skip confirmation modal and visual step indicators.
 * See docs/onboarding/ONBOARDING_FINAL_SPEC.md for the full spec.
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Animated,
  Dimensions,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { ONBOARDING_ROLE_KEY, type OnboardingRole } from '../../lib/storage/onboarding';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ONBOARDING_KEY = '@bounty_onboarding_complete';

// Workflow step configuration
const WORKFLOW_STEP_START = 1; // Slide index for first workflow step (slide 2)
const WORKFLOW_STEP_END = 2;   // Slide index for last workflow step (slide 3)

type SlideData = {
  id: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  color: string;
};

const slides: SlideData[] = [
  {
    id: '1',
    icon: 'gps-fixed',
    title: 'Welcome to Bounty',
    description: 'Post tasks and trusted locals get them done — or earn money completing tasks nearby. Your money stays protected until the job is done.',
    color: '#9CA3AF',
  },
  {
    id: '2',
    icon: 'add-circle-outline',
    title: 'Post What You Need Done',
    description: 'Describe the task, set your budget and location. Nearby hunters apply — review their profiles and ratings, then accept the best match.',
    color: '#6ee7b7',
  },
  {
    id: '3',
    icon: 'chat-bubble',
    title: 'Chat, Complete & Pay',
    description: 'Coordinate in the app while your payment is held safely in escrow. Confirm completion to release it, then rate each other to build trust.',
    color: '#059669',
  },
  {
    id: '4',
    icon: 'attach-money',
    title: 'Or Browse & Earn',
    description: 'Browse bounties near you, apply to the ones that fit your skills, and get paid when the work is done. You work on your schedule.',
    color: '#6ee7b7',
  },
  {
    id: '5',
    icon: 'security',
    title: "You're Protected",
    description: 'Escrow-backed payments, verified profiles, and ratings on every job. How do you want to start?',
    color: '#9CA3AF',
  },
];

export default function OnboardingCarousel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSkipModal, setShowSkipModal] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setCurrentIndex(nextIndex);
    }
  };

  const handleSkip = () => {
    setShowSkipModal(true);
  };

  const handleConfirmSkip = async () => {
    setShowSkipModal(false);
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/onboarding/username');
  };

  const handleCancelSkip = () => {
    setShowSkipModal(false);
  };

  const handleGetStarted = async (role?: OnboardingRole) => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      if (role) {
        await AsyncStorage.setItem(ONBOARDING_ROLE_KEY, role);
      }
    } catch (error) {
      console.error('Error saving onboarding state:', error);
    }
    router.replace('/onboarding/username');
  };

  const renderSlide = ({ item, index }: { item: SlideData; index: number }) => {
    // Fade in animation based on scroll position
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];

    const opacity = scrollX.interpolate({
      inputRange,
      outputRange: [0.3, 1, 0.3],
      extrapolate: 'clamp',
    });

    const scale = scrollX.interpolate({
      inputRange,
      outputRange: [0.8, 1, 0.8],
      extrapolate: 'clamp',
    });

    // Determine if this is a workflow step (slides 2-5, which are indices 1-4)
    const isWorkflowStep = index >= WORKFLOW_STEP_START && index <= WORKFLOW_STEP_END;
    const stepNumber = isWorkflowStep ? index : null;

    return (
      <View style={styles.slide}>
        <Animated.View style={[styles.slideContent, { opacity, transform: [{ scale }] }]}>
          {stepNumber && (
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>STEP {stepNumber}</Text>
            </View>
          )}
          
          <View style={[styles.iconContainer, { backgroundColor: theme.surface }]}>
            <MaterialIcons name={item.icon} size={80} color={item.color} />
          </View>

          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </Animated.View>
      </View>
    );
  };

  const renderDots = () => {
    return (
      <View style={styles.dotsContainer}>
        {slides.map((_, index) => {
          const inputRange = [
            (index - 1) * SCREEN_WIDTH,
            index * SCREEN_WIDTH,
            (index + 1) * SCREEN_WIDTH,
          ];

          const dotWidth = scrollX.interpolate({
            inputRange,
            outputRange: [8, 24, 8],
            extrapolate: 'clamp',
          });

          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.3, 1, 0.3],
            extrapolate: 'clamp',
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  width: dotWidth,
                  opacity,
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: false,
      listener: (event: any) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(offsetX / SCREEN_WIDTH);
        setCurrentIndex(index);
      },
    }
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Branding Header */}
      <View style={styles.brandingHeader}>
        <BrandingLogo size="medium" />
      </View>

      {/* Skip button */}
      <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Carousel */}
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={SCREEN_WIDTH}
      />

      {/* Dots indicator */}
      {renderDots()}

      {/* Action buttons */}
      <View style={styles.actionContainer}>
        {currentIndex === slides.length - 1 ? (
          <>
            <TouchableOpacity
              style={styles.nextButton}
              onPress={() => handleGetStarted('hunter')}
              accessibilityRole="button"
              accessibilityLabel="Start earning nearby"
            >
              <Text style={styles.nextButtonText}>Start earning nearby</Text>
              <MaterialIcons name="attach-money" size={20} color="#052e1b" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => handleGetStarted('poster')}
              accessibilityRole="button"
              accessibilityLabel="Get something done"
            >
              <Text style={styles.secondaryButtonText}>Get something done</Text>
              <MaterialIcons name="add-circle-outline" size={20} color={theme.text} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
          >
            <Text style={styles.nextButtonText}>Next</Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color="#052e1b"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Skip Confirmation Modal */}
      <Modal
        visible={showSkipModal}
        transparent
        animationType="fade"
        onRequestClose={handleCancelSkip}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <MaterialIcons name="info-outline" size={48} color="#059669" />
            <Text style={styles.modalTitle}>Skip Tutorial?</Text>
            <Text style={styles.modalDescription}>
              This quick tour helps you understand how Bounty works. You can always come back to it later in settings.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalButtonSecondary}
                onPress={handleCancelSkip}
              >
                <Text style={styles.modalButtonTextSecondary}>Continue Tour</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonPrimary}
                onPress={handleConfirmSkip}
              >
                <Text style={styles.modalButtonTextPrimary}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    brandingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 16,
      paddingBottom: 8,
    },
    brandingText: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      letterSpacing: 3,
      marginLeft: 8,
    },
    skipButton: {
      position: 'absolute',
      top: 60,
      right: 24,
      zIndex: 10,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    skipText: {
      color: theme.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    slide: {
      width: SCREEN_WIDTH,
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    slideContent: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBadge: {
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderRadius: 20,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: theme.border,
    },
    stepBadgeText: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: 'bold',
      letterSpacing: 1.5,
    },
    iconContainer: {
      width: 160,
      height: 160,
      borderRadius: 80,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 40,
      borderWidth: 3,
      borderColor: theme.border,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 16,
      textAlign: 'center',
    },
    description: {
      fontSize: 16,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
      paddingHorizontal: 20,
    },
    dotsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 40,
      height: 24,
    },
    dot: {
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.primary,
      marginHorizontal: 4,
    },
    actionContainer: {
      paddingHorizontal: 24,
      paddingBottom: 40,
    },
    nextButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      gap: 8,
    },
    nextButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      paddingVertical: 16,
      borderRadius: 999,
      gap: 8,
      marginTop: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    secondaryButtonText: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalContent: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 400,
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: theme.text,
      marginTop: 16,
      marginBottom: 12,
      textAlign: 'center',
    },
    modalDescription: {
      fontSize: 16,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: 24,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    modalButtonPrimary: {
      flex: 1,
      backgroundColor: '#059669',
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    modalButtonSecondary: {
      flex: 1,
      backgroundColor: theme.surfaceSecondary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    modalButtonTextPrimary: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '600',
    },
    modalButtonTextSecondary: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
