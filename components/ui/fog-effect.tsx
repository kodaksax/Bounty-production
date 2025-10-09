import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface FogEffectProps {
  intensity?: number;
  speed?: number;
  color?: string;
  opacity?: number;
}

export function FogEffect({ 
  intensity = 3, 
  speed = 1, 
  color = '#00912C', // emerald-600 (primary brand color)
  opacity = 0.15 
}: FogEffectProps) {
  // Create multiple animated values for different fog layers
  const animatedValues = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const scaleValues = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  useEffect(() => {
    // Create continuous floating animation for each fog layer
    const animations = animatedValues.map((animatedValue, index) => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: (8000 + index * 2000) / speed,
            useNativeDriver: true,
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: (8000 + index * 2000) / speed,
            useNativeDriver: true,
          }),
        ])
      );
    });

    const scaleAnimations = scaleValues.map((scaleValue, index) => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(scaleValue, {
            toValue: 1.2 + (index * 0.1),
            duration: (6000 + index * 1500) / speed,
            useNativeDriver: true,
          }),
          Animated.timing(scaleValue, {
            toValue: 0.8 + (index * 0.1),
            duration: (6000 + index * 1500) / speed,
            useNativeDriver: true,
          }),
        ])
      );
    });

    // Start all animations
    Animated.parallel([...animations, ...scaleAnimations]).start();

    // Cleanup
    return () => {
      [...animations, ...scaleAnimations].forEach(anim => anim.stop());
    };
  }, [speed]);

  const renderFogLayer = (index: number) => {
    const translateX = animatedValues[index].interpolate({
      inputRange: [0, 1],
      outputRange: [-screenWidth * 0.3, screenWidth * 0.3],
    });

    const translateY = animatedValues[index].interpolate({
      inputRange: [0, 1],
      outputRange: [-50, 50],
    });

    const fogOpacity = animatedValues[index].interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [opacity * 0.3, opacity, opacity * 0.3],
    });

    // Different positions for each layer (using numeric values)
    const leftPercent = [10, 60, 20, 70, 40][index];
    const topPercent = [20, 10, 60, 50, 80][index];

    return (
      <Animated.View
        key={index}
        style={[
          styles.fogLayer,
          {
            left: `${leftPercent}%`,
            top: `${topPercent}%`,
            opacity: fogOpacity,
            transform: [
              { translateX },
              { translateY },
              { scale: scaleValues[index] },
            ],
          },
        ]}
      >
        <Svg width={200 + index * 50} height={200 + index * 50}>
          <Defs>
            <RadialGradient
              id={`fogGradient${index}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <Stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <Stop offset="30%" stopColor={color} stopOpacity={0.2} />
              <Stop offset="70%" stopColor={color} stopOpacity={0.1} />
              <Stop offset="100%" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle
            cx="50%"
            cy="50%"
            r="50%"
            fill={`url(#fogGradient${index})`}
          />
        </Svg>
      </Animated.View>
    );
  };

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Base gradient overlay for atmospheric depth */}
      <LinearGradient
        colors={[
          `${color}10`, // 10% opacity
          `${color}05`, // 5% opacity
          `${color}08`, // 8% opacity
          `${color}03`, // 3% opacity
        ]}
        locations={[0, 0.3, 0.7, 1]}
        style={styles.baseGradient}
      />
      
      {/* Animated fog layers */}
      {Array.from({ length: intensity }, (_, index) => renderFogLayer(index))}
      
      {/* Additional subtle overlay for depth */}
      <LinearGradient
        colors={[
          'transparent',
          `${color}02`,
          'transparent',
        ]}
        style={styles.depthOverlay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  baseGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  depthOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fogLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});