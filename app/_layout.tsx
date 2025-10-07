import { ThemeProvider } from "components/theme-provider";
import { Asset } from 'expo-asset';
import { useFonts } from 'expo-font';
import { Slot } from "expo-router";
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import "../global.css";
import { AdminProvider } from '../lib/admin-context';
import { StripeProvider } from '../lib/stripe-context';
import BrandedSplash from './auth/splash';

import { SplashScreenController } from '../components/splash-screen-controller';
import { useAuthContext } from '../hooks/use-auth-context';
import AuthProvider from '../providers/auth-provider';

// Load test utilities in development
if (__DEV__) {
  require('../lib/utils/test-profile-utils');
}

export const metadata = {
  title: "Bounty App",
  description: "Find and complete bounties near you",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no",
  appleMobileWebAppCapable: "yes",
  appleStatusBarStyle: "black-translucent",
    generator: 'v0.dev'
}

// Add styles for React Native
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
  },
  inner: {
    flex: 1,
    // Add any additional styling needed for "iphone-container"
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [appIsReady, setAppIsReady] = useState(false);
  // phases: 'native' (Expo static) -> 'brand' (React BrandedSplash) -> 'app'
  const [phase, setPhase] = useState<'native' | 'brand' | 'app'>('native');
  const BRANDED_MIN_MS = 1500; // adjust this value to control branded splash visible time

  //Supabase auth
  const { isLoggedIn } = useAuthContext()

  // Load any custom fonts (add family names if you have them)
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    (async () => {
      try {
        await SplashScreen.preventAutoHideAsync();
        await Asset.loadAsync([ require('../assets/images/icon.png') ]);
      } catch (e) {
        console.warn('[Splash] preparation error', e);
      } finally {
        if (!cancelled) {
          setAppIsReady(true);
          setPhase('brand'); // immediately move to branded React splash
          // Ensure native splash is hidden now that branded phase is active
          SplashScreen.hideAsync().catch(()=>{});
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
  return (
    <SafeAreaProvider>
  <SafeAreaView style={styles.container}>
        {showBranded ? (
          <BrandedSplash />
        ) : (
          <AuthProvider>
            <SplashScreenController />
          <AdminProvider>
            <StripeProvider>
              <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
                <View style={styles.inner}>
                  <Slot />
                </View>
              </ThemeProvider>
            </StripeProvider>
          </AdminProvider>
          </AuthProvider>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
