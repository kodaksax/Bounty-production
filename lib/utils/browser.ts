import { Linking } from 'react-native';

/**
 * Open a URL in the system/browser. Prefers Expo WebBrowser if available,
 * falls back to React Native Linking on non-Expo or web environments.
 */
export async function openUrlInBrowser(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!url) return { success: false, error: 'No URL provided' };

    // Attempt dynamic import of Expo WebBrowser
    try {
      const WebBrowser = await import('expo-web-browser');
      const res = await WebBrowser.openBrowserAsync(url);
      return { success: res.type !== 'cancel' };
    } catch (_expoErr) {
      // Not available or failed import: fall back to Linking
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return { success: true };
      }
      return { success: false, error: 'Cannot open URL' };
    }
  } catch (error: any) {
    console.error('[Browser] Failed to open URL:', error);
    return { success: false, error: error?.message || 'Failed to open URL' };
  }
}
