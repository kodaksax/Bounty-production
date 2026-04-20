/**
 * ConnectEmbeddedWebView
 *
 * Renders Stripe Connect Embedded Components (onboarding / payments / payouts)
 * inside a React Native WebView. Since Stripe does not publish a native RN
 * binding for Connect Embedded Components, we host a small HTML shim from the
 * `connect` Supabase edge function (GET /connect/embedded) and bridge events
 * between the page and the app via `postMessage`.
 *
 * Flow:
 *   1. Fetch a short-lived client_secret + publishable key from the edge
 *      function (POST /connect/create-account-session).
 *   2. Load the shim HTML in a WebView (no secrets in the URL).
 *   3. When the page posts { type: 'ready' }, send it the credentials +
 *      which component to mount.
 *   4. Propagate onExit / errors back to the host screen.
 *
 * The WebView never receives the Stripe secret key.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import { API_BASE_URL } from '../lib/config/api';
import { colors } from '../lib/theme';

export type ConnectComponent = 'onboarding' | 'payments' | 'payouts';

export interface ConnectEmbeddedWebViewProps {
  /** Supabase access token for the currently authenticated user. */
  authToken: string;
  /** Which embedded component to render. */
  component: ConnectComponent;
  /** Called when the user exits the onboarding flow (embedded onExit). */
  onExit?: () => void;
  /** Called when the embedded component has mounted successfully. */
  onMounted?: (component: ConnectComponent) => void;
  /** Called when loading the session or the embedded SDK fails. */
  onError?: (error: string) => void;
  /**
   * Optional country override passed to `accounts.create` on first-time
   * account creation. Defaults to the profile's country or 'US'.
   */
  country?: string;
}

type InitPayload = {
  clientSecret: string;
  publishableKey: string;
  accountId: string;
};

type BridgeMessage =
  | { type: 'ready' }
  | { type: 'exit' }
  | { type: 'mounted'; component?: string }
  | { type: 'retry' }
  | { type: 'load_error'; error?: string }
  | { type: 'log'; level?: string; message?: string };

/**
 * Derives the base origin of the connect edge function from API_BASE_URL.
 * API_BASE_URL for supabase edge functions looks like:
 *   https://<project>.supabase.co/functions/v1
 * so the embedded shim lives at `${API_BASE_URL}/connect/embedded`.
 */
function embeddedUrl(): string {
  const base = (API_BASE_URL || '').replace(/\/$/, '');
  return `${base}/connect/embedded`;
}

function sessionUrl(): string {
  const base = (API_BASE_URL || '').replace(/\/$/, '');
  return `${base}/connect/create-account-session`;
}

export function ConnectEmbeddedWebView({
  authToken,
  component,
  onExit,
  onMounted,
  onError,
  country,
}: ConnectEmbeddedWebViewProps) {
  const [init, setInit] = useState<InitPayload | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to force WebView reload
  const webViewRef = useRef<WebView | null>(null);
  const readyFiredRef = useRef(false);

  const fetchSession = useCallback(async () => {
    try {
      setError(null);
      setLoadingSession(true);
      readyFiredRef.current = false;
      const components =
        component === 'onboarding'
          ? { account_onboarding: true }
          : component === 'payments'
            ? { payments: true }
            : { payouts: true };
      const response = await fetch(sessionUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ components, country }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data && data.error) || `Failed to create session (HTTP ${response.status})`);
      }
      if (!data.clientSecret || !data.publishableKey) {
        throw new Error('Invalid session response from server.');
      }
      setInit({
        clientSecret: data.clientSecret,
        publishableKey: data.publishableKey,
        accountId: data.accountId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not start Stripe Connect.';
      setError(message);
      onError?.(message);
    } finally {
      setLoadingSession(false);
    }
  }, [authToken, component, country, onError]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Send init to the WebView once both (a) we have session data and (b) the
  // page has posted `ready`. We store the init in a ref-like state so we can
  // re-send on explicit retry.
  const sendInit = useCallback(() => {
    if (!init || !webViewRef.current) return;
    const payload = {
      publishableKey: init.publishableKey,
      clientSecret: init.clientSecret,
      component,
    };
    // URL-encode the JSON payload before interpolation. `encodeURIComponent`
    // guarantees the output contains only characters from a safe subset that
    // cannot terminate the surrounding JS string literal (no quotes, no
    // backslashes, no newlines), so this is not a code-injection sink.
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const js = `(function(){try{window.__bountyConnectInit && window.__bountyConnectInit('${encoded}');}catch(e){}})(); true;`;
    webViewRef.current.injectJavaScript(js);
  }, [component, init]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: BridgeMessage | null = null;
      try {
        msg = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'ready':
          readyFiredRef.current = true;
          sendInit();
          break;
        case 'exit':
          onExit?.();
          break;
        case 'mounted':
          onMounted?.(component);
          break;
        case 'retry':
          setNonce((n) => n + 1);
          fetchSession();
          break;
        case 'load_error': {
          const m = msg.error || 'Stripe Connect failed to load.';
          setError(m);
          onError?.(m);
          break;
        }
        case 'log':
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[ConnectEmbedded:${msg.level ?? 'log'}]`, msg.message);
          }
          break;
      }
    },
    [component, fetchSession, onError, onExit, onMounted, sendInit]
  );

  // If the WebView loads *after* session data is ready, the `ready` message
  // from the page will trigger sendInit. If session data arrives after the
  // page is ready, push it immediately.
  useEffect(() => {
    if (init && readyFiredRef.current) sendInit();
  }, [init, sendInit]);

  const source = useMemo(
    () => ({ uri: `${embeddedUrl()}?v=${nonce}&c=${component}` }),
    [component, nonce]
  );

  if (loadingSession && !init) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
        <Text style={styles.muted}>Preparing secure Stripe session…</Text>
      </View>
    );
  }

  if (error && !init) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>We couldn’t start Stripe Connect.</Text>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setNonce((n) => n + 1);
            fetchSession();
          }}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <WebView
        ref={webViewRef}
        source={source}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary[500]} />
          </View>
        )}
        onMessage={handleMessage}
        onHttpError={({ nativeEvent }) => {
          const m = `HTTP ${nativeEvent.statusCode} loading Stripe page.`;
          setError(m);
          onError?.(m);
        }}
        onError={({ nativeEvent }) => {
          const m = nativeEvent.description || 'Failed to load Stripe page.';
          setError(m);
          onError?.(m);
        }}
        onShouldStartLoadWithRequest={(req) => {
          // Keep navigation inside our origin; open any other URLs externally.
          try {
            const u = new URL(req.url);
            const our = new URL(embeddedUrl());
            if (u.origin === our.origin) return true;
            if (u.origin === 'about:blank' || req.url.startsWith('about:')) return true;
            // Stripe may open hosted verification flows (e.g. identity) in new
            // tabs — allow only genuine Stripe hostnames (exact match or proper
            // subdomain of stripe.com). This prevents domains like
            // `evil-stripe.com` from being treated as Stripe.
            const host = u.hostname.toLowerCase();
            if (host === 'stripe.com' || host.endsWith('.stripe.com')) return true;
            Alert.alert('External link', u.origin);
            return false;
          } catch {
            return true;
          }
        }}
        style={styles.flex}
      />
    </View>
  );
}

export default ConnectEmbeddedWebView;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background.primary },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background.primary,
  },
  muted: {
    marginTop: 12,
    color: colors.text.secondary,
    fontSize: 14,
    textAlign: 'center',
  },
  errorTitle: {
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: colors.primary[500],
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
