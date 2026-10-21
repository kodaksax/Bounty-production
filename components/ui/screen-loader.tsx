/**
 * Full-screen loading state for the launch path (root gate → tabs guard →
 * tab shell). Those three used to draw three different spinners — one on a
 * hard-coded dark page even in light mode — so cold start blinked between
 * them as each handed off to the next. They share this one now: same page
 * color, same indicator in the same place, so a handoff is invisible.
 *
 * On native the indicator holds back for `duration.loaderDelay` and then
 * fades up: a wait shorter than that shows only the calm page color instead
 * of a spinner that flashes and disappears. On web it shows at once — the
 * static export prerenders this screen as HTML that is on screen while the
 * JS bundle downloads, and an animation can't start before that bundle runs,
 * so a delayed reveal would leave a blank page for the whole download.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { duration, easeOut } from '../../lib/motion';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

interface ScreenLoaderProps {
  /** Shown under the indicator. Optional; existing screens pass their own copy. */
  label?: string;
}

export function ScreenLoader({ label }: ScreenLoaderProps) {
  const { theme } = useAppThemeContext();
  const revealAtOnce = Platform.OS === 'web';
  const reveal = useRef(new Animated.Value(revealAtOnce ? 1 : 0)).current;

  useEffect(() => {
    if (revealAtOnce) return;
    const anim = Animated.timing(reveal, {
      toValue: 1,
      delay: duration.loaderDelay,
      duration: duration.base,
      easing: easeOut,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reveal, revealAtOnce]);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.background }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
    >
      <Animated.View style={[styles.content, { opacity: reveal }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        {label ? (
          <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
  },
  label: {
    marginTop: 16,
    fontSize: 15,
  },
});
