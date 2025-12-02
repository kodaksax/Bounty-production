import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AnimatedSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  locked?: boolean;
}

/**
 * Collapsible/animated section with header and expandable content.
 * Uses LayoutAnimation for smooth expansion/collapse.
 */
export function AnimatedSection({ title, expanded, onToggle, children, locked = false }: AnimatedSectionProps) {
  const rotateAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotateAnim, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded, rotateAnim]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={handleToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${expanded ? 'expanded' : 'collapsed'}`}
        accessibilityHint="Tap to toggle section"
        disabled={(locked ?? false)}
      >
        <Text style={styles.title}>{title}</Text>
        {locked ? (
          <MaterialIcons name="lock" size={20} color="rgba(255,255,255,0.45)" />
        ) : (
          <Animated.View style={{ transform: [{ rotate }] }}>
            <MaterialIcons name="expand-more" size={24} color="#80c795" />
          </Animated.View>
        )}
      </TouchableOpacity>
      {expanded && (
        // Use pointerEvents='box-none' so the container itself doesn't block
        // parent scroll gestures while children remain interactive.
        <View style={styles.content} pointerEvents="box-none">
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 117, 35, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 142, 42, 0.2)',
    marginVertical: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  title: {
    color: '#80c795',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  content: {
    padding: 12,
    paddingTop: 0,
  },
});
