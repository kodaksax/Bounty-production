import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

interface TypingIndicatorProps {
  userName?: string;
}

/**
 * Animated typing indicator showing three bouncing dots
 */
export function TypingIndicator({ userName = 'Someone' }: TypingIndicatorProps) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createAnimation = (dotValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dotValue, {
            toValue: -8,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(dotValue, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const animations = Animated.parallel([
      createAnimation(dot1, 0),
      createAnimation(dot2, 200),
      createAnimation(dot3, 400),
    ]);

    animations.start();

    return () => {
      animations.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.container}>
      <View style={styles.bubble}>
        <View style={styles.dotsContainer}>
          <Animated.View style={[styles.dot, { transform: [{ translateY: dot1 }] }]} />
          <Animated.View style={[styles.dot, { transform: [{ translateY: dot2 }] }]} />
          <Animated.View style={[styles.dot, { transform: [{ translateY: dot3 }] }]} />
        </View>
      </View>
      <Text style={styles.text}>{userName} is typing...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  bubble: {
    backgroundColor: 'rgba(6, 95, 70, 0.6)', // emerald-700/60
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomLeftRadius: 4,
    marginRight: 8,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d1fae5', // emerald-200
  },
  text: {
    fontSize: 12,
    color: '#d1fae5',
    fontStyle: 'italic',
  },
});
