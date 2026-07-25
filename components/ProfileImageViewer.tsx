/**
 * Full-screen profile photo viewer — Instagram/Facebook-style lightbox.
 * Presentational only: visibility and the current image are owned by
 * ProfileImageViewerProvider (lib/context/ProfileImageViewerContext.tsx),
 * which renders this once at the app root.
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { OptimizedImage } from 'lib/components/OptimizedImage';
import React, { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const BACKDROP_MAX_OPACITY = 0.94;
const SPRING_CONFIG = { damping: 24, stiffness: 260, mass: 0.9 };

export interface ProfileImageViewerProps {
  visible: boolean;
  imageUrl: string | null;
  altText?: string;
  onRequestClose: () => void;
}

function clampWorklet(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

function triggerHaptic(style: 'light' | 'medium' = 'light') {
  try {
    Haptics.impactAsync(
      style === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
    );
  } catch {
    // Silently fail if haptics aren't supported on this device.
  }
}

export function ProfileImageViewer({
  visible,
  imageUrl,
  altText,
  onRequestClose,
}: ProfileImageViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Keeps the native Modal mounted only for as long as it's visible or
  // animating closed, so the viewer truly mounts "only when needed" rather
  // than sitting in the tree at all times.
  const [mounted, setMounted] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);
  const imageOpacity = useSharedValue(0);

  const handleRequestClose = useCallback(() => {
    onRequestClose();
  }, [onRequestClose]);

  useEffect(() => {
    if (visible && imageUrl) {
      setMounted(true);
      setLoadState('loading');
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      dismissX.value = 0;
      dismissY.value = 0;
      imageOpacity.value = 0.6;
      backdropOpacity.value = 0;
      backdropOpacity.value = withTiming(BACKDROP_MAX_OPACITY, { duration: 220 });
      imageOpacity.value = withSpring(1, SPRING_CONFIG);
      triggerHaptic('light');
      AccessibilityInfo.announceForAccessibility?.('Profile photo viewer opened');
    } else {
      setMounted(prevMounted => {
        if (!prevMounted) return prevMounted;
        backdropOpacity.value = withTiming(0, { duration: 180 });
        imageOpacity.value = withTiming(0, { duration: 180 }, finished => {
          if (finished) {
            runOnJS(setMounted)(false);
          }
        });
        return prevMounted;
      });
    }
    // Shared values are refs; only visible/imageUrl transitions matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, imageUrl]);

  useEffect(() => {
    if (!mounted) return undefined;

    if (Platform.OS === 'android') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handleRequestClose();
        return true;
      });
      return () => sub.remove();
    }

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') handleRequestClose();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }

    return undefined;
  }, [mounted, handleRequestClose]);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
      dismissX.value = 0;
      dismissY.value = 0;
      backdropOpacity.value = BACKDROP_MAX_OPACITY;
    })
    .onUpdate(e => {
      scale.value = clampWorklet(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withSpring(1, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        const maxX = (width * (scale.value - 1)) / 2;
        const maxY = (height * (scale.value - 1)) / 2;
        const clampedX = clampWorklet(translateX.value, -maxX, maxX);
        const clampedY = clampWorklet(translateY.value, -maxY, maxY);
        translateX.value = withSpring(clampedX, SPRING_CONFIG);
        translateY.value = withSpring(clampedY, SPRING_CONFIG);
        savedTranslateX.value = clampedX;
        savedTranslateY.value = clampedY;
      }
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate(e => {
      if (scale.value > 1.02) {
        const maxX = (width * (scale.value - 1)) / 2;
        const maxY = (height * (scale.value - 1)) / 2;
        translateX.value = clampWorklet(savedTranslateX.value + e.translationX, -maxX, maxX);
        translateY.value = clampWorklet(savedTranslateY.value + e.translationY, -maxY, maxY);
      } else {
        dismissY.value = e.translationY > 0 ? e.translationY : e.translationY * 0.35;
        dismissX.value = e.translationX * 0.4;
        const progress = clampWorklet(Math.abs(dismissY.value) / (DISMISS_DISTANCE * 2.5), 0, 1);
        backdropOpacity.value = BACKDROP_MAX_OPACITY * (1 - progress * 0.7);
      }
    })
    .onEnd(e => {
      if (scale.value > 1.02) {
        return;
      }
      const shouldDismiss = dismissY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;
      if (shouldDismiss) {
        dismissY.value = withTiming(height, { duration: 220 });
        backdropOpacity.value = withTiming(0, { duration: 220 });
        runOnJS(handleRequestClose)();
      } else {
        dismissY.value = withSpring(0, SPRING_CONFIG);
        dismissX.value = withSpring(0, SPRING_CONFIG);
        backdropOpacity.value = withSpring(BACKDROP_MAX_OPACITY, SPRING_CONFIG);
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd(e => {
      if (scale.value > 1.5) {
        scale.value = withSpring(1, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        const originX = e.x - width / 2;
        const originY = e.y - height / 2;
        const maxX = (width * (DOUBLE_TAP_SCALE - 1)) / 2;
        const maxY = (height * (DOUBLE_TAP_SCALE - 1)) / 2;
        const newX = clampWorklet(-originX * (DOUBLE_TAP_SCALE - 1), -maxX, maxX);
        const newY = clampWorklet(-originY * (DOUBLE_TAP_SCALE - 1), -maxY, maxY);
        scale.value = withSpring(DOUBLE_TAP_SCALE, SPRING_CONFIG);
        translateX.value = withSpring(newX, SPRING_CONFIG);
        translateY.value = withSpring(newY, SPRING_CONFIG);
        savedScale.value = DOUBLE_TAP_SCALE;
        savedTranslateX.value = newX;
        savedTranslateY.value = newY;
      }
      runOnJS(triggerHaptic)('light');
    });

  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .requireExternalGestureToFail(doubleTapGesture)
    .onEnd(() => {
      if (scale.value <= 1.02) {
        runOnJS(handleRequestClose)();
      }
    });

  const composedGesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    Gesture.Exclusive(doubleTapGesture, singleTapGesture)
  );

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
    transform: [
      { translateX: translateX.value + dismissX.value },
      { translateY: translateY.value + dismissY.value },
      { scale: scale.value },
    ],
    shadowOpacity: interpolate(scale.value, [1, 1.3, MAX_SCALE], [0, 0.35, 0.35], Extrapolation.CLAMP),
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!mounted) return null;

  const viewerWidth = width;
  const viewerHeight = Math.max(height - insets.top - insets.bottom, 0);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <StatusBar hidden animated style="light" />
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal accessibilityLabel="Profile photo viewer">
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]} />

        <View
          style={[
            styles.content,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[{ width: viewerWidth, height: viewerHeight }, imageAnimatedStyle]}>
              {imageUrl && (
                <OptimizedImage
                  source={{ uri: imageUrl }}
                  style={styles.image}
                  resizeMode="contain"
                  useThumbnail={false}
                  priority="high"
                  alt={altText || 'Profile photo'}
                  onLoadStart={() => setLoadState('loading')}
                  onLoad={() => setLoadState('loaded')}
                  onError={() => setLoadState('error')}
                />
              )}

              {loadState === 'loading' && (
                <View style={styles.centerOverlay} pointerEvents="none">
                  <ActivityIndicator size="large" color="#ffffff" />
                </View>
              )}

              {loadState === 'error' && (
                <View style={styles.centerOverlay} pointerEvents="none">
                  <MaterialIcons name="broken-image" size={48} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.errorText}>Couldn&apos;t load this photo</Text>
                </View>
              )}
            </Animated.View>
          </GestureDetector>
        </View>

        <Pressable
          onPress={handleRequestClose}
          style={[styles.closeButton, { top: insets.top + 12, right: 16 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close photo viewer"
          accessibilityHint="Dismisses the full screen profile photo"
        >
          <MaterialIcons name="close" size={26} color="#ffffff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '500',
  },
  closeButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});
