import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

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

export function AnimatedSection({ title, expanded, onToggle, children, locked = false }: AnimatedSectionProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
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

  const accentColor = theme.isDark ? '#6ee7b7' : theme.primary;

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={s.container}>
      <TouchableOpacity
        style={s.header}
        onPress={handleToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${expanded ? 'expanded' : 'collapsed'}`}
        accessibilityHint="Tap to toggle section"
        disabled={(locked ?? false)}
      >
        <Text style={[s.title, { color: accentColor }]}>{title}</Text>
        {locked ? (
          <MaterialIcons name="lock" size={20} color={theme.textDisabled} />
        ) : (
          <Animated.View style={{ transform: [{ rotate }] }}>
            <MaterialIcons name="expand-more" size={24} color={accentColor} />
          </Animated.View>
        )}
      </TouchableOpacity>
      {expanded && (
        <View style={s.content} pointerEvents="box-none">
          {children}
        </View>
      )}
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: t.isDark ? 'rgba(5, 150, 105, 0.15)' : 'rgba(5, 150, 105, 0.06)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? '#374151' : 'rgba(5, 150, 105, 0.25)',
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
}
