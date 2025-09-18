import { ThemeProvider } from "components/theme-provider";
import { Slot } from "expo-router";
import type React from "react";
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import "../global.css";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
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
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <View style={styles.inner}>
            <Slot />
          </View>
        </ThemeProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
