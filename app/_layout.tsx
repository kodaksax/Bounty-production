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
import BrandedSplash, { hideNativeSplashSafely, showNativeSplash } from './auth/splash';

// Sentry initialization is deferred to RootLayout useEffect to avoid early native module access
import { initializeSentry } from '../lib/services/sentry-init';

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

export const metadata = {
  title: "Bounty App",
  description: "Find and complete bounties near you",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no",
  appleMobileWebAppCapable: "yes",
  appleStatusBarStyle: "black-translucent",
  generator: 'v0.dev',
}

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

function RootLayout({ children }: { children: React.ReactNode }) {
  // phases: 'native' (Expo static) -> 'brand' (React BrandedSplash) -> 'app'
  const [phase, setPhase] = useState<'native' | 'brand' | 'app'>('native');
  const BRANDED_MIN_MS = 1500; // adjust this value to control branded splash visible time

  // Load any custom fonts (add family names if you have them)
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    // Initialize Sentry, Mixpanel and send an initial page view once at app start.
    // We await initMixpanel so early events are not dropped if init is async.
    let cancelled = false;
    const start = Date.now();

    (async () => {
      // Initialize Sentry first (deferred from module-level to avoid early native access)
      try {
        initializeSentry();
      } catch (_e) {
        console.error('[Sentry] Initialization failed:', _e);
      }

      try {
        await initMixpanel();
        try {
          track('Page View', { screen: 'root' });
        } catch {
          // ignore analytics failures
        }
      } catch (_e) {
        // eslint-disable-next-line no-console
        console.error('[Mixpanel] init failed', _e);
      }

      try {
        await showNativeSplash();
        await Asset.loadAsync([require('../assets/images/icon.png')]);
      } catch (e) {
        console.error('[Splash] preparation error', e);
      } finally {
        if (!cancelled) {
          setPhase('brand'); // immediately move to branded React splash
          // Ensure native splash is hidden now that branded phase is active
          hideNativeSplashSafely();
          // Enforce minimum branded duration
          const elapsed = Date.now() - start;
          const remaining = BRANDED_MIN_MS - elapsed;
          if (remaining > 0) {
            setTimeout(() => setPhase(p => p === 'brand' ? 'app' : p), remaining);
          } else {
            setPhase('app');
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Safety fallback: if something stalls, move to app after max 8s
  useEffect(() => {
    if (phase === 'app') return;
    const safety = setTimeout(() => setPhase('app'), 8000);
    return () => clearTimeout(safety);
  }, [phase]);

  const showBranded = phase === 'brand' || (phase !== 'app' && !fontsLoaded);

  const LayoutContent = () => {
    const { color } = useBackgroundColor();

    return (
      <RootFrame bgColor={color}>
        {showBranded ? (
          <BrandedSplash />
        ) : (
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
        )}
      </RootFrame>
    );
  };

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
} catch {
  // ignore; fall back to unwrapped root
}

export default WrappedRoot;