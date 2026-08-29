/**
 * useSocialAuth
 * Reusable Apple / Google sign-in for screens that need real authentication
 * outside of the main app/auth/sign-in-form.tsx (e.g. the onboarding sign-in
 * screen). Performs the actual Supabase auth call; the caller decides what
 * to do once a session exists.
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { ResponseType } from 'expo-auth-session';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { capture as posthogCapture } from '../lib/posthog';
import { supabase } from '../lib/supabase';
import { runAuthStageWithTimeout } from '../lib/utils/auth-diagnostics';
import {
    AUTH_RETRY_CONFIG,
    generateCorrelationId,
    getAuthErrorMessage,
} from '../lib/utils/auth-errors';

// Required so the browser-based Google OAuth redirect resolves back into the
// app. app/auth/sign-in-form.tsx also calls this at module scope; doing so
// here too keeps this hook self-contained if it's ever used somewhere that
// screen isn't loaded. Safe to call more than once.
WebBrowser.maybeCompleteAuthSession();

export function useSocialAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleSessionReady, setGoogleSessionReady] = useState(false);
  const [isAppleAvailable, setIsAppleAvailable] = useState(false);

  // Apple sign-in works only on iOS 13+. Keep the button hidden everywhere
  // else so Android and older iOS users never reach a dead end.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setIsAppleAvailable(available);
      })
      .catch(() => {
        if (active) setIsAppleAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const iosGoogleClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'placeholder-ios-client-id';
  const androidGoogleClientId =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'placeholder-android-client-id';
  const webGoogleClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'placeholder-web-client-id';
  const isGoogleConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  );

  // See app/auth/sign-in-form.tsx for why no custom redirectUri is passed here.
  const [googleRequest, googleResponse, promptGoogleAsync] = useIdTokenAuthRequest({
    responseType: ResponseType.IdToken,
    clientId: Platform.select({
      ios: iosGoogleClientId,
      android: androidGoogleClientId,
      default: webGoogleClientId,
    })!,
    iosClientId: iosGoogleClientId,
    androidClientId: androidGoogleClientId,
    webClientId: webGoogleClientId,
    scopes: ['openid', 'email', 'profile'],
  });

  useEffect(() => {
    if (!googleResponse) return;
    (async () => {
      if (googleResponse.type !== 'success') {
        setLoading(false);
        if (googleResponse.type === 'error') {
          setError(googleResponse.error?.message ?? 'Google sign-in failed');
          // The prompt failed before any token exchange — e.g. the native
          // Google Sign-In config is missing from the build. Record it so the
          // break shows up in analytics instead of only in a bug report (#727).
          posthogCapture('AUTH_ATTEMPT_FAILED', {
            correlation_id: generateCorrelationId('social_google'),
            method: 'google',
            error_code: googleResponse.error?.code ?? 'google_prompt_error',
            outcome: 'unavailable',
          });
        }
        return;
      }
      const idToken = googleResponse.params.id_token;
      if (!idToken) {
        setError('Google did not return id_token');
        setLoading(false);
        return;
      }
      const correlationId = generateCorrelationId('social_google');
      try {
        posthogCapture('AUTH_ATTEMPT_STARTED', { correlation_id: correlationId, method: 'google' });
        const { error: authError } = await runAuthStageWithTimeout({
          correlationId,
          stage: 'social-auth:google-signInWithIdToken',
          timeoutMs: AUTH_RETRY_CONFIG.SOCIAL_AUTH_TIMEOUT,
          run: () =>
            supabase.auth.signInWithIdToken({
              provider: 'google',
              token: idToken,
            }),
          metadata: { surface: 'useSocialAuth' },
        });
        if (authError) throw authError;
        setGoogleSessionReady(true);
      } catch (e: any) {
        setError(getAuthErrorMessage(e));
        posthogCapture('AUTH_ATTEMPT_FAILED', {
          correlation_id: correlationId,
          method: 'google',
          error_code: e?.code ?? 'unknown',
          outcome: e?.code === 'AUTH_STAGE_TIMEOUT' ? 'timed_out' : 'rejected',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [googleResponse]);

  const promptGoogleSignIn = () => {
    setError(null);
    setLoading(true);
    promptGoogleAsync();
  };

  const signInWithApple = async (): Promise<boolean> => {
    setError(null);
    setLoading(true);
    let correlationId: string | undefined;
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        setError('Apple did not return an identity token');
        return false;
      }
      const identityToken = credential.identityToken;
      correlationId = generateCorrelationId('social_apple');
      posthogCapture('AUTH_ATTEMPT_STARTED', { correlation_id: correlationId, method: 'apple' });
      const { error: authError } = await runAuthStageWithTimeout({
        correlationId,
        stage: 'social-auth:apple-signInWithIdToken',
        timeoutMs: AUTH_RETRY_CONFIG.SOCIAL_AUTH_TIMEOUT,
        run: () =>
          supabase.auth.signInWithIdToken({
            provider: 'apple',
            token: identityToken,
          }),
        metadata: { surface: 'useSocialAuth' },
      });
      if (authError) throw authError;
      return true;
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError(getAuthErrorMessage(e));
        posthogCapture('AUTH_ATTEMPT_FAILED', {
          correlation_id: correlationId ?? 'unknown',
          method: 'apple',
          error_code: e?.code ?? 'unknown',
          outcome: e?.code === 'AUTH_STAGE_TIMEOUT' ? 'timed_out' : 'rejected',
        });
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    isAppleAvailable,
    isGoogleConfigured,
    googleRequest,
    promptGoogleSignIn,
    googleSessionReady,
    signInWithApple,
    loading,
    error,
    clearError: () => setError(null),
  };
}
