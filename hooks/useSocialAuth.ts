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
import { setRememberMePreference } from '../lib/auth-session-storage';
import { supabase } from '../lib/supabase';
import { getAuthErrorMessage } from '../lib/utils/auth-errors';

// Required so the browser-based Google OAuth redirect resolves back into the
// app. app/auth/sign-in-form.tsx also calls this at module scope; doing so
// here too keeps this hook self-contained if it's ever used somewhere that
// screen isn't loaded. Safe to call more than once.
WebBrowser.maybeCompleteAuthSession();

export function useSocialAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleSessionReady, setGoogleSessionReady] = useState(false);

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
        }
        return;
      }
      const idToken = googleResponse.params.id_token;
      if (!idToken) {
        setError('Google did not return id_token');
        setLoading(false);
        return;
      }
      try {
        await setRememberMePreference(true);
        const { error: authError } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (authError) throw authError;
        setGoogleSessionReady(true);
      } catch (e) {
        setError(getAuthErrorMessage(e));
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
      await setRememberMePreference(true);
      const { error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (authError) throw authError;
      return true;
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError(getAuthErrorMessage(e));
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
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
