import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

interface SkeletonWrapperProps {
  /** Whether the content is still loading */
  loading: boolean;
  /** The skeleton component to show while loading */
  skeleton: React.ReactNode;
  /** The actual content to show when loaded */
  children: React.ReactNode;
  /** Duration of the fade animation in milliseconds (default: 300) */
  fadeDuration?: number;
}

/**
 * SkeletonWrapper handles the smooth fade transition between skeleton and content.
 * 
 * When loading=true: Shows skeleton with fade-in
 * When loading=false: Fades out skeleton and fades in content
 * 
 * Usage:
 * ```tsx
 * <SkeletonWrapper loading={isLoading} skeleton={<PostingCardSkeleton />}>
 *   <BountyCard {...bounty} />
 * </SkeletonWrapper>
 * ```
 */
export function SkeletonWrapper({
  loading,
  skeleton,
  children,
  fadeDuration = 300,
}: SkeletonWrapperProps) {
  const skeletonOpacity = useRef(new Animated.Value(loading ? 1 : 0)).current;
  const contentOpacity = useRef(new Animated.Value(loading ? 0 : 1)).current;

  useEffect(() => {
    if (loading) {
      // Show skeleton, hide content
      Animated.parallel([
        Animated.timing(skeletonOpacity, {
          toValue: 1,
          duration: fadeDuration,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: fadeDuration,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Hide skeleton, show content
      Animated.parallel([
        Animated.timing(skeletonOpacity, {
          toValue: 0,
          duration: fadeDuration,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: fadeDuration,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [loading, skeletonOpacity, contentOpacity, fadeDuration]);

  return (
    <View style={styles.container}>
      {/* Content layer */}
      <Animated.View style={{ opacity: contentOpacity }}>
        {children}
      </Animated.View>
      
      {/* Skeleton layer (positioned absolutely on top during loading) */}
      {/* Only render skeleton when loading to stop internal animations */}
      {loading && (
        <Animated.View 
          style={[styles.skeletonLayer, { opacity: skeletonOpacity }]}
          pointerEvents="none"
        >
          {skeleton}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  skeletonLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
