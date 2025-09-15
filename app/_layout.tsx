
import "../global.css"
import { ThemeProvider } from "components/theme-provider";
import type React from "react";
import { StyleSheet, View } from 'react-native';

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
  return (
    <View style={styles.container}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <View style={styles.inner}>{children}</View>
      </ThemeProvider>
    </View>
  );
}
