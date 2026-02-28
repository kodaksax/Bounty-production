/**
 * Auth Callback Screen
 * Handles deep links from email confirmation, password reset, and other auth flows
 * Universal Link: https://bountyfinder.app/auth/callback
 */

import { MaterialIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { ROUTES } from '../../lib/routes';
import { supabase } from '../../lib/supabase';
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation';

import { colors } from '../../lib/theme';
type CallbackStatus = 'loading' | 'success' | 'error' | 'expired';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  
  const [status, setStatus] = useState<CallbackStatus>('loading');
  const [message, setMessage] = useState('Processing your request...');
  const [errorDetails, setErrorDetails] = useState('');
  const [callbackType, setCallbackType] = useState<string>('');

  const handleAuthCallback = useCallback(async () => {
    try {
      // Get URL parameters from deep link
      // Supabase sends: ?token=xxx&type=signup|recovery|invite|email_change|magiclink
      const token = Array.isArray(params.token) ? params.token[0] : params.token;
      const type = Array.isArray(params.type) ? params.type[0] : params.type;
      const access_token = Array.isArray(params.access_token) ? params.access_token[0] : params.access_token;
      const refresh_token = Array.isArray(params.refresh_token) ? params.refresh_token[0] : params.refresh_token;

      console.log('[auth-callback] Received parameters:', { 
        hasToken: !!token, 
        type, 
        hasAccessToken: !!access_token,
        hasRefreshToken: !!refresh_token
      });

      // Handle different auth callback types
      if (type === 'signup' || type === 'email_change') {
        // Email confirmation
        setCallbackType('email_confirmation');
        if (token) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: token as string,
            type: type === 'signup' ? 'signup' : 'email_change',
          });

          if (error) {
            console.error('[auth-callback] Email confirmation error:', error);
            setStatus('error');
            setMessage('Email Confirmation Failed');
            setErrorDetails(error.message || 'The confirmation link may have expired.');
            return;
          }

          setStatus('success');
          setMessage('Email Confirmed!');
          
          // Wait a moment to show success, then redirect
          setTimeout(() => {
            router.replace('/tabs/bounty-app' as Href);
            try { markInitialNavigationDone(); } catch {}
          }, 2000);
          return;
        }
      } else if (type === 'recovery') {
        // Password reset flow - must establish a session before navigating
        setCallbackType('recovery');
        if (access_token && refresh_token) {
          // Implicit flow: Supabase sent access_token + refresh_token
          const { error } = await supabase.auth.setSession({
            access_token: access_token as string,
            refresh_token: refresh_token as string,
          });

          if (error) {
            console.error('[auth-callback] Recovery setSession error:', error);
            setStatus('error');
            setMessage('Password Reset Failed');
            setErrorDetails(error.message || 'The reset link may have expired.');
            return;
          }

          setStatus('success');
          setMessage('Redirecting to Password Reset...');

          setTimeout(() => {
            router.replace('/auth/update-password' as Href);
            try { markInitialNavigationDone(); } catch {}
          }, 1500);
          return;
        } else if (token) {
          // Token-hash flow: verify the OTP to establish a session
          const { error } = await supabase.auth.verifyOtp({
            token_hash: token as string,
            type: 'recovery',
          });

          if (error) {
            console.error('[auth-callback] Recovery verifyOtp error:', error);
            setStatus('error');
            setMessage('Password Reset Failed');
            setErrorDetails(error.message || 'The reset link may have expired.');
            return;
          }

          setStatus('success');
          setMessage('Redirecting to Password Reset...');

          setTimeout(() => {
            router.replace('/auth/update-password' as Href);
            try { markInitialNavigationDone(); } catch {}
          }, 1500);
          return;
        }
      } else if (type === 'magiclink') {
        // Magic link sign in
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: access_token as string,
            refresh_token: refresh_token as string,
          });

          if (error) {
            console.error('[auth-callback] Magic link error:', error);
            setStatus('error');
            setMessage('Sign In Failed');
            setErrorDetails(error.message || 'The magic link may have expired.');
            return;
          }

          setStatus('success');
          setMessage('Successfully Signed In!');
          
          setTimeout(() => {
            router.replace('/tabs/bounty-app' as Href);
            try { markInitialNavigationDone(); } catch {}
          }, 2000);
          return;
        }
      }

      // If we get here, the link might be invalid or expired
      console.warn('[auth-callback] Unknown or invalid callback parameters:', params);
      setStatus('error');
      setMessage('Invalid Confirmation Link');
      setErrorDetails('This link may have expired or is invalid. Please request a new confirmation email.');

    } catch (error) {
      console.error('[auth-callback] Error processing callback:', error);
      setStatus('error');
      setMessage('Something Went Wrong');
      setErrorDetails('An unexpected error occurred. Please try again.');
    }
  }, [params, router]);

  useEffect(() => {
    handleAuthCallback();
  }, [handleAuthCallback]);

  const handleGoToSignIn = () => {
    router.replace(ROUTES.AUTH.SIGN_IN as Href);
    try { markInitialNavigationDone(); } catch {}
  };

  const handleRequestNewResetLink = () => {
    router.replace(ROUTES.AUTH.RESET_PASSWORD as Href);
    try { markInitialNavigationDone(); } catch {}
  };

  const handleOpenEmail = async () => {
    // Try to open default email app
    const emailUrl = 'message://';
    const canOpen = await Linking.canOpenURL(emailUrl);
    
    if (canOpen) {
      await Linking.openURL(emailUrl);
    } else {
      // Fallback for Android
      await Linking.openURL('mailto:');
    }
  };

  const isRecovery = callbackType === 'recovery';

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#a7f3d0" />
            <Text style={styles.title}>{message}</Text>
            <Text style={styles.description}>
              {isRecovery
                ? 'Please wait while we verify your reset link...'
                : 'Please wait while we verify your email...'}
            </Text>
          </View>
        );

      case 'success':
        return (
          <View style={styles.centerContent}>
            <View style={styles.successIconCircle}>
              <MaterialIcons name="check-circle" size={64} color="#052e1b" />
            </View>
            <Text style={styles.title}>{message}</Text>
            <Text style={styles.description}>
              {isRecovery
                ? 'Your reset link has been verified. You will be redirected to set your new password.'
                : 'Your email has been verified. You can now access all features of BOUNTY.'}
            </Text>
          </View>
        );

      case 'error':
        return (
          <View style={styles.centerContent}>
            <View style={styles.errorIconCircle}>
              <MaterialIcons name="error-outline" size={64} color="#7f1d1d" />
            </View>
            <Text style={styles.title}>{message}</Text>
            <Text style={styles.description}>{errorDetails}</Text>

            {/* Help section */}
            <View style={styles.helpBox}>
              <MaterialIcons name="info-outline" size={20} color="#a7f3d0" />
              <View style={styles.helpContent}>
                <Text style={styles.helpTitle}>
                  {isRecovery ? 'Need a new reset link?' : 'Need a new confirmation email?'}
                </Text>
                <Text style={styles.helpText}>
                  {isRecovery
                    ? "Request a new password reset link and we'll send it to your email."
                    : "Sign in to your account and we'll send you a new verification link."}
                </Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.errorActions}>
              {isRecovery ? (
                <>
                  <TouchableOpacity style={styles.primaryButton} onPress={handleRequestNewResetLink}>
                    <Text style={styles.primaryButtonText}>Request New Reset Link</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={handleGoToSignIn}>
                    <MaterialIcons name="login" size={20} color="#a7f3d0" />
                    <Text style={styles.secondaryButtonText}>Back to Sign In</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.secondaryButton} onPress={handleOpenEmail}>
                    <MaterialIcons name="email" size={20} color="#a7f3d0" />
                    <Text style={styles.secondaryButtonText}>Check Email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryButton} onPress={handleGoToSignIn}>
                    <Text style={styles.primaryButtonText}>Go to Sign In</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );

      default:
        return null;
    }
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
        {renderContent()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
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
  centerContent: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconCircle: {
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
    marginBottom: 24,
  },
  errorIconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fecaca',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  helpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(5,46,27,0.4)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  helpContent: {
    flex: 1,
    marginLeft: 12,
  },
  helpTitle: {
    color: '#a7f3d0',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  helpText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 20,
  },
  errorActions: {
    width: '100%',
    gap: 12,
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
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,46,27,0.4)',
    paddingVertical: 16,
    borderRadius: 999,
    gap: 8,
    borderWidth: 2,
    borderColor: '#a7f3d0',
  },
  secondaryButtonText: {
    color: '#a7f3d0',
    fontSize: 16,
    fontWeight: '600',
  },
});
