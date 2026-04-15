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
      await WebBrowser.openBrowserAsync(url);
      // Any result that doesn't throw means the browser opened and was later
      // dismissed. On iOS, SFSafariViewController always resolves with
      // type: 'cancel' when the user taps "Done" — this is the normal close
      // path, not a failure. Treating it as success: false would prevent
      // callers (e.g. PayoutFailedBanner) from running post-browser logic.
      return { success: true };
    } catch {
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
