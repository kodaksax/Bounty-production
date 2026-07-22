/**
 * Onboarding Welcome
 * First screen of onboarding: logo + core trust points + role/intent pick
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function OnboardingWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { updateData } = useOnboarding();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    analyticsService.trackEvent('onboarding_welcome_viewed');
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const handleSelectIntent = (intent: 'poster' | 'hunter') => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_role_selected', { role: intent });
    updateData({ intent });
    router.replace('/onboarding/username');
  };

  const handleLogIn = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_login_tapped');
    router.push('/auth/sign-in-form');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top * 0.3, paddingBottom: insets.bottom }]}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <BrandingLogo size="large" containerStyle={styles.logo} />

        <View style={styles.point}>
          <View style={[styles.pointIcon, { backgroundColor: theme.surface }]}>
            <MaterialIcons name="check" size={32} color="#6ee7b7" />
          </View>
          <Text style={styles.pointText}>You set the price</Text>
        </View>

        <View style={styles.point}>
          <View style={[styles.pointIcon, { backgroundColor: theme.surface }]}>
            <MaterialIcons name="lock" size={32} color="#9CA3AF" />
          </View>
          <Text style={styles.pointText}>Your money stays protected until the job&rsquo;s done</Text>
        </View>
      </Animated.View>

      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.posterButton}
          onPress={() => handleSelectIntent('poster')}
          accessibilityRole="button"
          accessibilityLabel="Get something done — post a task and hire someone nearby"
        >
          <Text style={styles.posterButtonText}>Get something done</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.hunterButton, { backgroundColor: theme.primary }]}
          onPress={() => handleSelectIntent('hunter')}
          accessibilityRole="button"
          accessibilityLabel="Start earning nearby — browse and accept paid tasks"
        >
          <Text style={styles.hunterButtonText}>Start earning nearby</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.loginButton}
          onPress={handleLogIn}
          accessibilityRole="button"
          accessibilityLabel="Log in to an existing account"
        >
          <Text style={styles.loginButtonText}>Log In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingHorizontal: 40,
    },
    logo: {
      marginBottom: 64,
    },
    point: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 28,
      width: '100%',
    },
    pointIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 16,
      borderWidth: 3,
      borderColor: theme.border,
    },
    pointText: {
      flex: 1,
      fontSize: 20,
      fontWeight: '600',
      color: theme.text,
    },
    actionContainer: {
      paddingHorizontal: 24,
      paddingBottom: 40,
      gap: 12,
    },
    posterButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      borderWidth: 2,
      borderColor: '#000000',
      paddingVertical: 16,
      borderRadius: 999,
    },
    posterButtonText: {
      color: '#000000',
      fontSize: 18,
      fontWeight: 'bold',
    },
    hunterButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 999,
    },
    hunterButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    loginButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    loginButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
