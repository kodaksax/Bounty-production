import * as Sentry from '@sentry/react-native';
import { ThemeProvider } from "components/theme-provider";
import { Asset } from 'expo-asset';
import { useFonts } from 'expo-font';
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import "../global.css";
import { useAuthContext } from '../hooks/use-auth-context';
import { useSessionMonitor } from '../hooks/useSessionMonitor';
import { AdminProvider } from '../lib/admin-context';
import { COLORS } from "../lib/constants/accessibility";
import { BackgroundColorProvider, useBackgroundColor } from '../lib/context/BackgroundColorContext';
import { NotificationProvider } from '../lib/context/notification-context';
import { initMixpanel, track } from "../lib/mixpanel";
import { StripeProvider } from '../lib/stripe-context';
import { WalletProvider } from '../lib/wallet-context';
import AuthProvider from '../providers/auth-provider';
import { WebSocketProvider } from '../providers/websocket-provider';
import BrandedSplash, { hideNativeSplashSafely, showNativeSplash } from './auth/splash';
import { getUserFriendlyError } from '../lib/utils/error-messages';


// Load test utilities in development
if (__DEV__) {
  require('../lib/utils/test-profile-utils');
}

// Ensure Sentry is initialized as early as possible so that Sentry.wrap
// (used at the bottom of this file) is called after initialization.
import { initializeSentry } from '../lib/services/sentry-init';
initializeSentry();

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
    generator: 'v0.dev'
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

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary] Caught error', error, info);
  }
  render() {
    if (this.state.error) {
      // Get user-friendly error message (hides technical details)
      const userError = getUserFriendlyError(this.state.error);
      
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ maxWidth: 320, width: '100%' }}>
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: '700', marginBottom: 4 }}>{userError.title}</Text>
              <Text style={{ color: 'white', fontSize: 14, opacity: 0.85 }} numberOfLines={4}>{userError.message}</Text>
            </View>
            <Text style={{ color: 'white', fontSize: 12, opacity: 0.6 }}>
              {userError.retryable 
                ? 'Please restart the app to try again.'
                : 'Please restart the app or contact support if the problem persists.'}
            </Text>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootLayout({ children }: { children: React.ReactNode }) {
  const [appIsReady, setAppIsReady] = useState(false);
  // phases: 'native' (Expo static) -> 'brand' (React BrandedSplash) -> 'app'
  const [phase, setPhase] = useState<'native' | 'brand' | 'app'>('native');
  const BRANDED_MIN_MS = 1500; // adjust this value to control branded splash visible time

  // Load any custom fonts (add family names if you have them)
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    // Initialize Mixpanel and send an initial page view once at app start.
    // We await initMixpanel so early events are not dropped if init is async.
    let cancelled = false;
    const start = Date.now();

    (async () => {
      try {
        await initMixpanel();
        try {
          track('Page View', { screen: 'root' });
        } catch (e) {
          // ignore analytics failures
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Mixpanel] init failed', e);
      }

      try {
        await showNativeSplash();
        await Asset.loadAsync([ require('../assets/images/icon.png') ]);
      } catch (e) {
        console.warn('[Splash] preparation error', e);
      } finally {
        if (!cancelled) {
          setAppIsReady(true);
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
  // Runtime instrumentation: log presence of critical stubs once (development only)
  if (__DEV__) {
    try {
      const slot = require('../stubs/radix-slot')
      const sonner = require('../stubs/sonner')
      const themes = require('../stubs/next-themes')
      // Avoid verbose output; just confirm default/named exports shape.
      // eslint-disable-next-line no-console
      console.log('[RuntimeCheck] radix-slot keys:', Object.keys(slot), 'default' in slot ? 'hasDefault' : 'noDefault')
      // eslint-disable-next-line no-console
      console.log('[RuntimeCheck] sonner keys:', Object.keys(sonner), 'default' in sonner ? 'hasDefault' : 'noDefault')
      // eslint-disable-next-line no-console
      console.log('[RuntimeCheck] next-themes keys:', Object.keys(themes), 'default' in themes ? 'hasDefault' : 'noDefault')
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[RuntimeCheck] instrumentation failed', e)
    }
  }
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
                      <RootErrorBoundary>
                        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
                          <View style={styles.inner}>
                            <Slot />
                          </View>
                        </ThemeProvider>
                      </RootErrorBoundary>
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

export default Sentry.wrap(RootLayout);