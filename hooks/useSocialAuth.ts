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
import { useEffect, useRef, useState } from 'react';
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
  // Correlation id for the attempt CURRENTLY in flight: set once when
  // `promptGoogleSignIn` starts the native prompt, then reused by the
  // `googleResponse` effect below (which fires later, on its own render pass
  // once the prompt resolves) for every event it emits. Previously each call
  // site minted its own id with `generateCorrelationId`, so a prompt-level
  // failure's AUTH_ATTEMPT_FAILED carried a correlation_id unrelated to the
  // AUTH_ATTEMPT_STARTED that preceded it — the two could not be stitched
  // together in analytics.
  const googleCorrelationIdRef = useRef<string | null>(null);

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
  const googleClientIdForPlatform = Platform.select({
    ios: iosGoogleClientId,
    android: androidGoogleClientId,
    default: webGoogleClientId,
  });
  const isGoogleConfigured = Boolean(
    googleClientIdForPlatform && !googleClientIdForPlatform.includes('placeholder')
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
        // EVERY non-success outcome has to be both visible to the user and
        // recorded. Previously only `type === 'error'` was handled, so the
        // `dismiss` / `cancel` / `locked` outcomes returned here silently: the
        // button cleared its spinner and nothing else happened, with no event
        // emitted. On Android that is the whole observed failure — production
        // telemetry shows users tapping "Continue with Google" repeatedly with
        // no AUTH_ATTEMPT_* event of any kind following the tap — so the break
        // was invisible in the funnel and looked to the user like a dead button.
        //
        // Reuse the id stashed when the prompt started so this failure stitches
        // to its AUTH_ATTEMPT_STARTED. The fallback only fires if this effect
        // somehow ran with no prior prompt (shouldn't happen — a response only
        // exists after promptGoogleSignIn ran) and exists purely so the event
        // still carries an id rather than throwing.
        const correlationId = googleCorrelationIdRef.current ?? generateCorrelationId('social_google');
        if (googleResponse.type === 'error') {
          setError(
            googleResponse.error?.message ??
              'Google sign-in failed. Please try again or continue with email.'
          );
          posthogCapture('AUTH_ATTEMPT_FAILED', {
            correlation_id: correlationId,
            method: 'google',
            error_code: googleResponse.error?.code ?? 'google_prompt_error',
            failure_stage: 'google_prompt',
            outcome: 'unavailable',
          });
        } else if (googleResponse.type === 'cancel') {
          // Explicit user cancellation — no error banner, but still measurable.
          posthogCapture('AUTH_ATTEMPT_FAILED', {
            correlation_id: correlationId,
            method: 'google',
            error_code: 'google_prompt_cancelled',
            failure_stage: 'google_prompt',
            outcome: 'cancelled',
          });
        } else if (googleResponse.type === 'locked') {
          setError('A sign-in window is already open. Close it and try again.');
          posthogCapture('AUTH_ATTEMPT_FAILED', {
            correlation_id: correlationId,
            method: 'google',
            error_code: 'google_prompt_locked',
            failure_stage: 'google_prompt',
            outcome: 'rejected',
          });
        } else {
          // `dismiss` (and anything new): the browser closed without returning
          // a result. This is what a misconfigured native Google client looks
          // like from JS, so say something actionable rather than nothing.
          setError(
            'Google sign-in did not complete. Please try again, or continue with email instead.'
          );
          posthogCapture('AUTH_ATTEMPT_FAILED', {
            correlation_id: correlationId,
            method: 'google',
            error_code: `google_prompt_${googleResponse.type}`,
            failure_stage: 'google_prompt',
            outcome: 'dismissed',
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
      // Same reuse-over-regenerate rule as above — this is the same user
      // attempt continuing into the token-exchange stage, not a new one.
      const correlationId = googleCorrelationIdRef.current ?? generateCorrelationId('social_google');
      try {
        posthogCapture('AUTH_ATTEMPT_STARTED', {
          correlation_id: correlationId,
          method: 'google',
          stage: 'google_token_exchange',
        });
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

  const promptGoogleSignIn = async () => {
    setError(null);

    // `promptAsync` is a no-op until the AuthRequest has finished loading its
    // discovery document. Tapping before then produced no prompt, no response
    // and no event — indistinguishable from a dead button.
    if (!googleRequest) {
      setError('Google sign-in is still getting ready. Please try again in a moment.');
      posthogCapture('AUTH_ATTEMPT_FAILED', {
        correlation_id: generateCorrelationId('social_google'),
        method: 'google',
        error_code: 'google_request_not_ready',
        failure_stage: 'google_prompt',
        outcome: 'unavailable',
      });
      return;
    }

    setLoading(true);
    // One id for the whole attempt, stashed in the ref so the `googleResponse`
    // effect (which fires later, on a separate render once the prompt
    // resolves) and this function's own catch below reuse it instead of each
    // minting their own — see the ref's declaration for why that mattered.
    const correlationId = generateCorrelationId('social_google');
    googleCorrelationIdRef.current = correlationId;
    // Marks the real start of the Google funnel. Without it the only evidence
    // a user tried Google at all was the caller's own screen event, so a prompt
    // that never returned left no trace between "tapped" and nothing.
    posthogCapture('AUTH_ATTEMPT_STARTED', {
      correlation_id: correlationId,
      method: 'google',
      stage: 'google_prompt',
    });
    try {
      // Previously fire-and-forget: a throw from the native prompt became an
      // unhandled rejection and left `loading` stuck true with no message.
      await promptGoogleAsync();
    } catch (e: any) {
      setLoading(false);
      setError(getAuthErrorMessage(e));
      posthogCapture('AUTH_ATTEMPT_FAILED', {
        correlation_id: correlationId,
        method: 'google',
        error_code: e?.code ?? 'google_prompt_threw',
        failure_stage: 'google_prompt',
        outcome: 'rejected',
      });
    }
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
