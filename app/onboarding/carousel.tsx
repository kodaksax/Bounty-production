/**
 * Onboarding Carousel
 * Shows 4 screens explaining app features on first launch
 * Includes value statement and Bounty branding
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ONBOARDING_KEY = '@bounty_onboarding_complete';

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
    description: 'A marketplace where you can post tasks, find help, and get things done safely. Post a bounty or become a hunter — it\'s that simple.',
    color: '#a7f3d0',
  },
  {
    id: '2',
    icon: 'work-outline',
    title: 'Post Tasks & Earn',
    description: 'Create bounties for tasks you need done, or complete bounties posted by others to earn money and build your reputation.',
    color: '#6ee7b7',
  },
  {
    id: '3',
    icon: 'chat-bubble-outline',
    title: 'Coordinate with Ease',
    description: 'Chat directly with your match to discuss details, share updates, and coordinate — all within the app.',
    color: '#34d399',
  },
  {
    id: '4',
    icon: 'verified-user',
    title: 'Safe & Secure Payments',
    description: 'Funds are held in escrow until work is complete. Your money is protected every step of the way, ensuring trust for everyone.',
    color: '#10b981',
  },
];

export default function OnboardingCarousel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setCurrentIndex(nextIndex);
    } else {
      handleGetStarted();
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/onboarding/username');
  };

  const handleGetStarted = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
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

    return (
      <View style={styles.slide}>
        <Animated.View style={[styles.slideContent, { opacity, transform: [{ scale }] }]}>
          <View style={[styles.iconContainer, { backgroundColor: 'rgba(5,46,27,0.5)' }]}>
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
        <MaterialIcons name="gps-fixed" size={28} color="#a7f3d0" />
        <Text style={styles.brandingText}>BOUNTY</Text>
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
        <TouchableOpacity
          style={styles.nextButton}
          onPress={handleNext}
        >
          <Text style={styles.nextButtonText}>
            {currentIndex === slides.length - 1 ? "Get Started" : "Next"}
          </Text>
          <MaterialIcons
            name={currentIndex === slides.length - 1 ? "check" : "arrow-forward"}
            size={20}
            color="#052e1b"
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
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
    color: '#ffffff',
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
    color: 'rgba(255,255,255,0.9)',
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
  iconContainer: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 3,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.85)',
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
    backgroundColor: '#a7f3d0',
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
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    borderRadius: 999,
    gap: 8,
  },
  nextButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
