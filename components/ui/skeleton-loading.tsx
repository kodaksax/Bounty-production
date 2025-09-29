import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

interface SkeletonLoadingProps {
  width?: number | string;
  height?: number;
  style?: any;
  borderRadius?: number;
}

export function SkeletonLoading({ 
  width = '100%', 
  height = 20, 
  style, 
  borderRadius = 8 
}: SkeletonLoadingProps) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 1000,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: false,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          opacity: pulseAnim,
          borderRadius,
        },
        style,
      ]}
      accessibilityElementsHidden={true}
    />
  );
}

interface BountySkeletonProps {
  count?: number;
}

export function BountySkeleton({ count = 3 }: BountySkeletonProps) {
  return (
    <View 
      style={styles.bountySkeletonContainer}
      accessible={true}
      accessibilityLabel="Loading bounties"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.bountySkeletonItem}>
          <View style={styles.bountySkeletonLeft}>
            <SkeletonLoading width={40} height={40} borderRadius={20} />
          </View>
          <View style={styles.bountySkeletonContent}>
            <SkeletonLoading width="80%" height={18} style={{ marginBottom: 8 }} />
            <SkeletonLoading width="60%" height={14} />
          </View>
          <View style={styles.bountySkeletonRight}>
            <SkeletonLoading width={50} height={20} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  bountySkeletonContainer: {
    paddingHorizontal: 16,
  },
  bountySkeletonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 97, 62, 0.4)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  bountySkeletonLeft: {
    marginRight: 12,
  },
  bountySkeletonContent: {
    flex: 1,
  },
  bountySkeletonRight: {
    marginLeft: 12,
  },
});