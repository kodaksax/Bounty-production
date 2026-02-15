/**
 * Email Confirmation Screen
 * Shown after successful sign-up to explain email verification
 */

import { MaterialIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    Animated,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation';

export default function EmailConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    // Create pulsing animation for the email icon
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const handleGoToSignIn = () => {
    router.replace('/auth/sign-in-form' as Href);
    try { markInitialNavigationDone(); } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Branding Header */}
      <View style={styles.brandingHeader}>
        <BrandingLogo size="large" />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Animated Email Icon */}
        <Animated.View
          style={[
            styles.iconContainer,
            { transform: [{ scale: pulseAnim }] }
          ]}
        >
          <View style={styles.iconCircle}>
            <MaterialIcons name="mark-email-read" size={64} color="#052e1b" />
          </View>
        </Animated.View>

        <Text style={styles.title}>Check Your Email</Text>

        <View style={styles.stepsContainer}>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Open your inbox</Text>
              <Text style={styles.stepDescription}>
                We
                {"'"}
                ve sent a confirmation link to your email address
              </Text>
            </View>
          </View>

          <View style={styles.stepDivider} />

          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Click the link</Text>
              <Text style={styles.stepDescription}>
                Tap the confirmation link in our email to verify your account
              </Text>
            </View>
          </View>

          <View style={styles.stepDivider} />

          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Sign in</Text>
              <Text style={styles.stepDescription}>
                Return here and sign in with your credentials to get started
              </Text>
            </View>
          </View>
        </View>

        {/* Info box */}
        <View style={styles.infoBox}>
          <MaterialIcons name="info-outline" size={18} color="#a7f3d0" />
          <Text style={styles.infoText}>
            Can
            {"'"}
            t find the email? Check your spam folder or request a new confirmation email.
          </Text>
        </View>
      </ScrollView>

      {/* Action Button */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleGoToSignIn}>
          <Text style={styles.primaryButtonText}>Go to Sign In</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
    paddingHorizontal: 24,
  },
  brandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 24,
  },

  iconContainer: {
    marginBottom: 24,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 32,
    textAlign: 'center',
  },
  stepsContainer: {
    width: '100%',
    backgroundColor: 'rgba(5,46,27,0.4)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    marginBottom: 24,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: '#052e1b',
    fontSize: 14,
    fontWeight: 'bold',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  stepDescription: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 20,
  },
  stepDivider: {
    width: 2,
    height: 20,
    backgroundColor: 'rgba(167,243,208,0.3)',
    marginLeft: 13,
    marginVertical: 8,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(5,46,27,0.4)',
    borderRadius: 12,
    padding: 14,
    width: '100%',
  },
  infoText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 20,
    marginLeft: 10,
    flex: 1,
  },
  actions: {
    paddingVertical: 24,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    borderRadius: 999,
    gap: 8,
  },
  primaryButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
