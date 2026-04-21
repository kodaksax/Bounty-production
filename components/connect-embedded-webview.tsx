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
 *   2. Fetch the shim HTML from the edge function and inject it into the
 *      WebView so the document is always parsed as HTML.
 *   3. When the page posts { type: 'ready' }, send it the credentials +
 *      which component to mount.
 *   4. Propagate onExit / errors back to the host screen.
 *
 * The WebView never receives the Stripe secret key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import Constants from 'expo-constants';

import { API_BASE_URL } from '../lib/config/api';
import { colors } from '../lib/theme';

/**
 * Returns the Supabase anon key, which the Supabase Functions gateway
 * requires on EVERY request (as an `apikey` header or `?apikey=` query
 * param) to route the call to the function — independently of whether
 * `verify_jwt` is enabled. Without it the gateway short-circuits with its
 * own error response, which a WebView then renders as visible raw HTML/JSON.
 */
function getSupabaseAnonKey(): string {
  try {
    const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
    const fromExtra = extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const extraStr = typeof fromExtra === 'string' ? fromExtra.trim() : '';
    return (
      (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
      (process.env.SUPABASE_ANON_KEY as string | undefined)?.trim() ||
      extraStr ||
      ''
    );
  } catch {
    return '';
  }
}

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
  | { type: 'log'; level?: string; message?: string }
  | { type: 'open_popup'; url: string }
  | { type: 'popup_post'; data: string; targetOrigin?: string };

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

function embeddedDocumentBaseUrl(): string {
  const base = (API_BASE_URL || '').replace(/\/$/, '');
  return `${base}/connect/`;
}

function createEmbeddedDocumentRequest(component: ConnectComponent, nonce: number) {
  const anonKey = getSupabaseAnonKey();
  const params = new URLSearchParams({ v: String(nonce), c: component });
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml',
  };

  if (anonKey) {
    headers.apikey = anonKey;
  }

  return {
    url: `${embeddedDocumentBaseUrl()}embedded?${params.toString()}`,
    headers,
  };
}

function looksLikeHtmlDocument(value: string): boolean {
  return /<!doctype html|<html[\s>]/i.test(value);
}

/**
 * JS injected into the MAIN Connect WebView BEFORE content loads.
 *
 * Polyfills `window.open` so Connect.js gets back a "window"-like proxy
 * instead of null when it tries to open the Stripe auth popup. The proxy's
 * `postMessage` is bridged through RN to the popup WebView. Messages posted
 * from the popup back to us (via window.opener.postMessage) are dispatched
 * here as real `message` events so Connect.js's message listener receives
 * them.
 */
const MAIN_INJECTED_JS = `
(function () {
  var _rn = (window.ReactNativeWebView && window.ReactNativeWebView.postMessage)
    ? function (obj) { try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (_) {} }
    : function () {};

  // Track the current popup proxy so window.postMessage interception can
  // route event.source replies to the popup instead of the local window.
  var _popupProxy = null;

  function makePopup(url) {
    var proxy = {
      closed: false,
      name: '',
      location: { href: url, replace: function (u) { this.href = u; } },
      focus: function () {},
      blur: function () {},
      close: function () { this.closed = true; _popupProxy = null; },
      postMessage: function (data, targetOrigin) {
        _rn({
          type: 'popup_post',
          data: (typeof data === 'string') ? data : JSON.stringify(data),
          targetOrigin: targetOrigin || '*'
        });
      }
    };
    _popupProxy = proxy;
    return proxy;
  }

  // Intercept window.postMessage so that when Connect.js responds via
  // event.source.postMessage(...) (and event.source === window because we
  // dispatch with source:window below), the reply is routed to the popup
  // instead of being dispatched back onto the local window.
  var _origWindowPM = window.postMessage;
  window.postMessage = function (data, targetOrigin, transfer) {
    var origin = (typeof targetOrigin === 'string') ? targetOrigin : '*';
    if (_popupProxy && !_popupProxy.closed) {
      var d = (typeof data === 'string') ? data : JSON.stringify(data);
      _rn({ type: 'popup_post', data: d, targetOrigin: origin });
      return;
    }
    if (_origWindowPM) _origWindowPM.call(window, data, targetOrigin, transfer);
  };

  var _origOpen = window.open;
  window.open = function (url, name, features) {
    try {
      var u = String(url || '');
      if (u.indexOf('stripe.network') !== -1 || u.indexOf('connect.stripe.com') !== -1) {
        _rn({ type: 'open_popup', url: u });
        return makePopup(u);
      }
    } catch (_) {}
    try { return _origOpen.call(window, url, name, features); } catch (_) { return null; }
  };

  // RN -> main WebView: relay messages FROM the popup back to us as real
  // 'message' events so Connect.js's window message listeners receive them.
  // source:window lets Connect.js call event.source.postMessage(...) which
  // our overridden window.postMessage above will intercept and route to popup.
  function relayFromPopup(raw) {
    var data = raw;
    try { data = JSON.parse(raw); } catch (_) {}
    try {
      var ev = new MessageEvent('message', {
        data: data,
        origin: 'https://m.stripe.network',
        source: window
      });
      window.dispatchEvent(ev);
    } catch (_) {}
  }
  window.__bountyRelayFromPopup = relayFromPopup;
  true;
})();
`;

/**
 * JS injected into the stripe.network popup WebView BEFORE page content loads.
 * Intercepts window.close() and window.opener.postMessage() so the modal can
 * close and relay auth callbacks back to the main Connect WebView. Also
 * accepts messages from RN (relayed from main WebView) and dispatches them
 * as real `message` events on window so Stripe's popup scripts receive them.
 */
const POPUP_INJECTED_JS = `
(function () {
  var _rn = (window.ReactNativeWebView && window.ReactNativeWebView.postMessage)
    ? function (obj) { try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (_) {} }
    : function () {};

  // window.close is a native method but IS reassignable; override so Stripe
  // can dismiss the popup via window.close().
  try { window.close = function () { _rn({ type: 'popup_close' }); }; } catch (_) {}

  // window.opener is backed by a native read-only accessor in WKWebView when
  // the window was not opened via window.open() — direct assignment silently
  // fails. Object.defineProperty with a getter override works even on
  // native-backed accessors and is the only reliable way to stub opener.
  var _fakeOpener = {
    closed: false,
    name: '',
    focus: function () {},
    blur: function () {},
    location: {
      href: 'https://connect-js.stripe.com/',
      origin: 'https://connect-js.stripe.com',
      hostname: 'connect-js.stripe.com',
      host: 'connect-js.stripe.com',
      protocol: 'https:',
      pathname: '/',
      search: '',
      hash: '',
      toString: function () { return 'https://connect-js.stripe.com/'; },
      assign: function () {},
      replace: function () {},
      reload: function () {}
    },
    postMessage: function (data, targetOrigin) {
      _rn({
        type: 'popup_msg',
        data: (typeof data === 'string') ? data : JSON.stringify(data),
        targetOrigin: targetOrigin || '*',
      });
    }
  };
  try {
    Object.defineProperty(window, 'opener', {
      get: function () { return _fakeOpener; },
      configurable: true,
      enumerable: true
    });
  } catch (_) {
    // Fallback for environments where defineProperty on window is blocked.
    try { window.opener = _fakeOpener; } catch (__) {}
  }

  // RN -> popup: when main WebView posts to the popup, RN sends us the raw
  // payload; dispatch it as a real message event so Stripe's popup listeners
  // receive it.
  function relayFromMain(raw) {
    var data = raw;
    try { data = JSON.parse(raw); } catch (_) {}
    try {
      var ev = new MessageEvent('message', {
        data: data,
        origin: 'https://connect-js.stripe.com',
        source: window.opener
      });
      window.dispatchEvent(ev);
    } catch (_) {}
  }
  window.__bountyRelayFromMain = relayFromMain;

  // Tell RN we are ready to receive relayed messages.
  _rn({ type: 'popup_ready' });

  // Forward console for easier debugging.
  ['log','warn','error'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try {
        _rn({ type: 'log', level: level, message: Array.prototype.slice.call(arguments).map(String).join(' ') });
      } catch (_) {}
      if (orig) orig.apply(console, arguments);
    };
  });
  true;
})();
`;

export function ConnectEmbeddedWebView({
  authToken,
  component,
  onExit,
  onMounted,
  onError,
  country,
}: ConnectEmbeddedWebViewProps) {
  const [init, setInit] = useState<InitPayload | null>(null);
  const [embeddedHtml, setEmbeddedHtml] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to force WebView reload
  const [popupUrl, setPopupUrl] = useState<string | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  const popupWebViewRef = useRef<WebView | null>(null);
  const popupReadyRef = useRef(false);
  const pendingPopupMessagesRef = useRef<string[]>([]);
  const readyFiredRef = useRef(false);

  const fetchSession = useCallback(async () => {
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

    return {
      clientSecret: data.clientSecret,
      publishableKey: data.publishableKey,
      accountId: data.accountId,
    } satisfies InitPayload;
  }, [authToken, component, country]);

  const fetchEmbeddedDocument = useCallback(async () => {
    const request = createEmbeddedDocumentRequest(component, nonce);
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
    });
    const html = await response.text().catch(() => '');

    if (!response.ok) {
      throw new Error(`Failed to load Stripe shell (HTTP ${response.status})`);
    }

    if (!looksLikeHtmlDocument(html)) {
      throw new Error('Stripe shell returned an invalid HTML document.');
    }

    return html;
  }, [component, nonce]);

  const reloadWebView = useCallback(() => {
    readyFiredRef.current = false;
    setError(null);
    setInit(null);
    setEmbeddedHtml(null);
    setLoadingSession(true);
    setPopupUrl(null);
    setNonce(value => value + 1);
  }, []);

  /** Send a raw JSON payload to the popup WebView, queueing until it's ready. */
  const sendToPopup = useCallback((payload: string) => {
    if (popupReadyRef.current && popupWebViewRef.current) {
      popupWebViewRef.current.injectJavaScript(
        `try { window.__bountyRelayFromMain && window.__bountyRelayFromMain(${payload}); } catch (_) {} true;`
      );
    } else {
      pendingPopupMessagesRef.current.push(payload);
    }
  }, []);

  /** Handles messages posted from the stripe.network popup WebView. */
  const handlePopupMessage = useCallback(
    (event: WebViewMessageEvent) => {
      type PopupMsg = { type: string; data?: string; level?: string; message?: string };
      let msg: PopupMsg | null = null;
      try {
        msg = JSON.parse(event.nativeEvent.data) as PopupMsg;
      } catch {
        return;
      }
      if (!msg) return;
      switch (msg.type) {
        case 'popup_ready':
          popupReadyRef.current = true;
          // Flush any queued messages from the main WebView.
          if (popupWebViewRef.current) {
            const queue = pendingPopupMessagesRef.current.splice(0);
            queue.forEach(p => {
              popupWebViewRef.current?.injectJavaScript(
                `try { window.__bountyRelayFromMain && window.__bountyRelayFromMain(${p}); } catch (_) {} true;`
              );
            });
          }
          break;
        case 'popup_close':
          setPopupUrl(null);
          popupReadyRef.current = false;
          pendingPopupMessagesRef.current = [];
          // Reload so the Connect component picks up the completed auth state.
          reloadWebView();
          break;
        case 'popup_msg':
          // Relay the auth callback to the main Connect WebView as a real
          // `message` event (Connect.js listens for window 'message' events).
          if (msg.data && webViewRef.current) {
            const safe = JSON.stringify(msg.data);
            webViewRef.current.injectJavaScript(
              `try { window.__bountyRelayFromPopup && window.__bountyRelayFromPopup(${safe}); } catch (_) {} true;`
            );
          }
          break;
        case 'log':
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[ConnectEmbeddedPopup:${msg.level ?? 'log'}]`, msg.message);
          }
          break;
      }
    },
    [reloadWebView]
  );

  const bootstrap = useCallback(async () => {
    try {
      setError(null);
      setLoadingSession(true);
      setInit(null);
      setEmbeddedHtml(null);
      readyFiredRef.current = false;

      const [sessionInit, html] = await Promise.all([fetchSession(), fetchEmbeddedDocument()]);
      setInit(sessionInit);
      setEmbeddedHtml(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not start Stripe Connect.';
      setError(message);
      onError?.(message);
    } finally {
      setLoadingSession(false);
    }
  }, [fetchEmbeddedDocument, fetchSession, onError]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Send init to the WebView once both (a) we have session data and (b) the
  // page has posted `ready`. Uses the WebView's native `postMessage` API
  // (delivered to the page's `window.addEventListener('message', …)`) rather
  // than `injectJavaScript`, so no JS source is ever constructed from our
  // payload — this eliminates any code-injection sink entirely.
  const sendInit = useCallback(() => {
    if (!init || !webViewRef.current) return;
    const payload = {
      type: 'init',
      publishableKey: init.publishableKey,
      clientSecret: init.clientSecret,
      component,
    };
    webViewRef.current.postMessage(JSON.stringify(payload));
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
          reloadWebView();
          break;
        case 'load_error': {
          const m = msg.error || 'Stripe Connect failed to load.';
          setError(m);
          onError?.(m);
          break;
        }
        case 'open_popup':
          // Connect.js called window.open(url) for an auth popup. Show it in
          // our in-app modal WebView instead.
          if (msg.url) {
            popupReadyRef.current = false;
            pendingPopupMessagesRef.current = [];
            setPopupUrl(msg.url);
          }
          break;
        case 'popup_post':
          // Main WebView called popup.postMessage(...) on the fake window
          // proxy. Forward to the popup WebView.
          if (msg.data) sendToPopup(msg.data);
          break;
        case 'log':
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log(`[ConnectEmbedded:${msg.level ?? 'log'}]`, msg.message);
          }
          break;
      }
    },
    [component, onError, onExit, onMounted, reloadWebView, sendInit, sendToPopup]
  );

  // If the WebView loads *after* session data is ready, the `ready` message
  // from the page will trigger sendInit. If session data arrives after the
  // page is ready, push it immediately.
  useEffect(() => {
    if (init && readyFiredRef.current) sendInit();
  }, [init, sendInit]);

  const source = useMemo(() => {
    if (!embeddedHtml) return null;

    return {
      html: embeddedHtml,
      baseUrl: embeddedDocumentBaseUrl(),
    };
  }, [embeddedHtml]);

  if (error && !loadingSession) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>We couldn’t start Stripe Connect.</Text>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={reloadWebView}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loadingSession || !init || !source) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
        <Text style={styles.muted}>Preparing secure Stripe session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <WebView
        key={`connect-${component}-${nonce}`}
        ref={webViewRef}
        source={source}
        injectedJavaScriptBeforeContentLoaded={MAIN_INJECTED_JS}
        // The initial document is injected HTML (about:blank/baseUrl), then it
        // loads Stripe assets over HTTPS. Allow the document bootstrap origin.
        // loads Stripe assets over HTTPS. Allow only the bootstrap document
        // origin and secure remote origins required by Stripe.
        originWhitelist={['about:blank', 'https://*']}
        domStorageEnabled
        cacheEnabled={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
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
        onShouldStartLoadWithRequest={req => {
          // Allow navigation inside our origin; open known-safe external links
          // (Stripe) in the system browser; block everything else. Fails
          // CLOSED on any parsing or validation error.
          let u: URL;
          let our: URL;
          try {
            u = new URL(req.url);
            our = new URL(embeddedUrl());
          } catch {
            Alert.alert(
              'Invalid link blocked',
              'For your security, this app blocked a link that could not be validated.'
            );
            return false;
          }

          if (u.origin === our.origin) return true;
          if (req.url.startsWith('about:')) return true;

          // Only allow genuine Stripe hostnames (exact match or proper
          // subdomain of stripe.com) over HTTPS. This prevents domains like
          // `evil-stripe.com` from being treated as Stripe and blocks insecure
          // `http://stripe.com/...` navigations.
          const host = u.hostname.toLowerCase();
          const isStripeCom =
            u.protocol === 'https:' && (host === 'stripe.com' || host.endsWith('.stripe.com'));
          if (isStripeCom) return true;

          // Stripe's mobile auth popup domain (m.stripe.network, etc.).
          // These URLs are opened by Connect.js via window.open() and must
          // NOT navigate the main WebView frame — open them in our in-app
          // popup modal instead so the auth session stays inside the app.
          const isStripeNetwork =
            u.protocol === 'https:' &&
            (host === 'stripe.network' || host.endsWith('.stripe.network'));
          if (isStripeNetwork) {
            setPopupUrl(req.url);
            return false;
          }

          // For any other HTTPS link the page tries to open (support pages,
          // bank partner sites, …), hand it off to the system browser so the
          // user stays in control of where they navigate, and keep the
          // embedded WebView scoped to our own HTML shim.
          if (u.protocol === 'https:') {
            Linking.openURL(req.url).catch(() => {
              Alert.alert('Could not open link', 'This app could not open the external link.');
            });
            return false;
          }

          Alert.alert(
            'External link blocked',
            `For your security, only links to Bounty or Stripe can open here.\n\nOrigin: ${u.origin}`
          );
          return false;
        }}
        style={styles.flex}
      />

      {/* In-app popup for Stripe mobile auth (m.stripe.network) */}
      <Modal
        visible={!!popupUrl}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setPopupUrl(null);
          reloadWebView();
        }}
      >
        <View style={styles.popupContainer}>
          <View style={styles.popupHeader}>
            <TouchableOpacity
              onPress={() => {
                if (popupUrl) {
                  Linking.openURL(popupUrl).catch(() => {
                    Alert.alert('Could not open browser', 'Please try again.');
                  });
                }
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Open in browser"
            >
              <Text style={styles.popupSecondaryText}>Open in browser</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setPopupUrl(null);
                reloadWebView();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.popupDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
          {popupUrl ? (
            <WebView
              ref={popupWebViewRef}
              source={{ uri: popupUrl }}
              injectedJavaScriptBeforeContentLoaded={POPUP_INJECTED_JS}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['https://*.stripe.com', 'https://*.stripe.network', 'about:blank']}
              setSupportMultipleWindows={false}
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              cacheEnabled={false}
              onMessage={handlePopupMessage}
              style={styles.flex}
              onShouldStartLoadWithRequest={popupReq => {
                try {
                  if (popupReq.url.startsWith('about:')) return true;
                  const pu = new URL(popupReq.url);
                  const ph = pu.hostname.toLowerCase();
                  // Allow all Stripe domains inside the popup
                  if (
                    pu.protocol === 'https:' &&
                    (ph === 'stripe.com' ||
                      ph.endsWith('.stripe.com') ||
                      ph === 'stripe.network' ||
                      ph.endsWith('.stripe.network'))
                  ) {
                    return true;
                  }
                  // Anything else → open in system browser and stay in popup
                  if (pu.protocol === 'https:') {
                    Linking.openURL(popupReq.url).catch(() => {});
                    return false;
                  }
                  return false;
                } catch {
                  return false;
                }
              }}
            />
          ) : null}
        </View>
      </Modal>
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
  popupContainer: { flex: 1, backgroundColor: colors.background.primary },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.muted,
    backgroundColor: colors.background.secondary,
  },
  popupDoneText: { color: colors.primary[500], fontSize: 16, fontWeight: '600' },
  popupSecondaryText: { color: colors.text.secondary, fontSize: 14 },
});
