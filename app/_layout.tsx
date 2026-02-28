import { ThemeProvider } from "components/theme-provider";
import { Asset } from 'expo-asset';
import { useFonts } from 'expo-font';
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import "../global.css";
import { useAuthContext } from '../hooks/use-auth-context';
import { useSessionMonitor } from '../hooks/useSessionMonitor';
import { AdminProvider } from '../lib/admin-context';
import { COLORS } from "../lib/constants/accessibility";
import { BackgroundColorProvider, useBackgroundColor } from '../lib/context/BackgroundColorContext';
import { NotificationProvider } from '../lib/context/notification-context';
import { ErrorBoundary } from '../lib/error-boundary';
import { initMixpanel, track } from "../lib/mixpanel";
import { StripeProvider } from '../lib/stripe-context';
import { WalletProvider } from '../lib/wallet-context';
import AuthProvider from '../providers/auth-provider';
import { WebSocketProvider } from '../providers/websocket-provider';
import { hideNativeSplashSafely, showNativeSplash } from './auth/splash';
import { isInitialNavigationDone, onInitialNavigationDone } from './initial-navigation/initialNavigation';

// Sentry initialization is deferred to RootLayout useEffect to avoid early native module access
import { getSentry as getSentryFromInit, initializeSentry } from '../lib/services/sentry-init';
// Initialize our global JS error handlers that log to device console (captured by Xcode/TestFlight)
import { initGlobalErrorHandlers } from '../lib/error-handling';

import { registerDeviceSession } from '../lib/services/auth-service';

// Lazily require Sentry to avoid importing native module at module-evaluation time
let Sentry: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  Sentry = require('@sentry/react-native');
} catch {
  // Sentry not available in this runtime (e.g., Expo Go) — we'll fall back to no-op
  Sentry = null;
}

// NOTE: Sentry initialization moved into RootLayout startup effect
// to avoid any chance of native-module access at module-evaluation time.

// Load test utilities in development
if (__DEV__) {
  require('../lib/utils/test-profile-utils');
}

if (__DEV__) {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('SafeAreaView has been deprecated')) {
      console.trace('SafeAreaView warning stack');
    }
    // PowerShell needs tuple typing to satisfy TS since args is unknown[]
    originalWarn(...(args as [unknown, ...unknown[]]));
  };
}

// Removed `metadata` export: this was a Next.js/web-only export and is a no-op on native.
// Leaving it in can be misleading; remove to avoid confusion.

// Simple luminance check to pick light/dark content for the status bar
const getBarStyleForHex = (hex: string): "light" | "dark" => {
  // strip #
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  // relative luminance
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? "dark" : "light";
};

const RootFrame = ({ children, bgColor = COLORS.EMERALD_500 }: { children: React.ReactNode; bgColor?: string }) => {
  const insets = useSafeAreaInsets();
  const barStyle = getBarStyleForHex(bgColor);

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* top safe area behind status icons (time, battery, network) */}
      <View style={{ height: insets.top, backgroundColor: bgColor }} />

      {/* app content */}
      <View style={styles.content}>{children}</View>

      {/* bottom safe area behind home indicator */}
      <View style={{ height: insets.bottom || 0, backgroundColor: bgColor }} />

      {/* status bar; expo-status-bar maps to appropriate platform APIs */}
      <StatusBar style={barStyle} backgroundColor={bgColor} />
    </View>
  );
};

// Defined outside RootLayout so the component reference is stable across
// RootLayout re-renders (e.g. when `phase` or `fontsLoaded` change).
// If defined inline, React would see a new component type on every render and
// unmount/remount the entire provider tree, causing cascading state updates
// that trigger a "Maximum update depth exceeded" error.
const LayoutContent = () => {
  const { color } = useBackgroundColor();

  return (
    <RootFrame bgColor={color}>
      <AuthProvider>
          <SessionMonitorGate />
          <AdminProvider>
            <StripeProvider>
              <WalletProvider>
                <NotificationProvider>
                  <WebSocketProvider>
                    <ErrorBoundary
                      onError={(error, errorInfo) => {
                        // Add custom breadcrumb for additional context (do not capture exception again)
                        try {
                          if (Sentry && typeof Sentry.addBreadcrumb === 'function') {
                            Sentry.addBreadcrumb({
                              category: 'root_layout',
                              message: 'Error caught in root layout',
                              level: 'error',
                              data: {
                                componentStack: errorInfo.componentStack,
                              },
                            });
                          }
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
                        <View style={styles.inner}>
                          <Slot />
                        </View>
                      </ThemeProvider>
                    </ErrorBoundary>
                  </WebSocketProvider>
                </NotificationProvider>
              </WalletProvider>
            </StripeProvider>
          </AdminProvider>
        </AuthProvider>
    </RootFrame>
  );
};

function RootLayout({ children }: { children: React.ReactNode }) {
  // phases: 'native' (Expo static) -> 'brand' (React BrandedSplash) -> 'app'
  const [phase, setPhase] = useState<'native' | 'brand' | 'app'>('native');
  const BRANDED_MIN_MS = 800; // kept for compatibility but branded splash disabled

  // Load fonts used by the app (SpaceMono + a couple common icon families).
  // Adding icon fonts ensures icons render consistently on first mount.
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    MaterialIcons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf'),
    Ionicons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
  });

  // Single startup gate: perform one-time startup tasks and only transition
  // to the app UI once both startup tasks and font loading complete. A
  // safety timeout moves to the app after 8s to avoid indefinite stalls.
  useEffect(() => {
    let cancelled = false;
    const SAFETY_MS = 8000;
    const NAV_MAX_WAIT_MS = 3000;
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setPhase('app');
    }, SAFETY_MS);

    const startedRef = { started: false } as { started: boolean };
    const startupDone = { value: false } as { value: boolean };

    const runStartup = async () => {
      if (startedRef.started) return;
      startedRef.started = true;

      try {
        initGlobalErrorHandlers();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ErrorHandling] failed to init global handlers', e);
      }

      try {
        initializeSentry();
        getSentryFromInit();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[Sentry] startup init failed:', e);
      }

      try {
        await Promise.race([initMixpanel(), new Promise(r => setTimeout(r, 2000))]);
        try { track('Page View', { screen: 'root' }); } catch { /* ignore */ }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[Mixpanel] init failed', e);
      }

      try {
        await showNativeSplash();
        await Asset.loadAsync([require('../assets/images/icon.png')]);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[Splash] preparation error', e);
      }

      // Wait for initial navigation (short bounded wait) then mark startup done
      try {
        if (!isInitialNavigationDone()) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, NAV_MAX_WAIT_MS);
            const unsub = onInitialNavigationDone(() => {
              clearTimeout(timer);
              resolve();
              if (typeof unsub === 'function') unsub();
            });
          });
        }
      } catch {
        // ignore
      }

      startupDone.value = true;

      // If fonts already loaded, finalize transition now
      if (fontsLoaded && !cancelled) {
        try { hideNativeSplashSafely(); } catch {}
        setPhase('app');
      }
    };

    runStartup();

    // If startup already finished earlier and fonts just became available,
    // finalize transition here when both conditions are true.
    if (startupDone.value && fontsLoaded && !cancelled) {
      try { hideNativeSplashSafely(); } catch {}
      setPhase('app');
    }

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, [fontsLoaded]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BackgroundColorProvider>
          <LayoutContent />
        </BackgroundColorProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

// Lightweight gate component that mounts the session monitor once auth context is available
const SessionMonitorGate = () => {
  const { isLoggedIn } = useAuthContext();
  useSessionMonitor({ enabled: !!isLoggedIn });

  // Register device when logged in
  useEffect(() => {
    if (isLoggedIn) {
      registerDeviceSession();
    }
  }, [isLoggedIn]);

  return null;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
  },
  inner: {
    flex: 1,
    // Add any additional styling needed for "iphone-container"
  },
  content: { flex: 1 },
});

let WrappedRoot = RootLayout;
try {
  if (Sentry && typeof Sentry.wrap === 'function') {
    WrappedRoot = Sentry.wrap(RootLayout);
  }
} catch (e) {
  // ignore; fall back to unwrapped root
  // eslint-disable-next-line no-console
  console.error('[Sentry] wrap failed at module-eval:', e);
}

export default WrappedRoot;