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
      console.log('[Browser] redirect initiated via in-app browser (WebBrowser)');
      await WebBrowser.openBrowserAsync(url);
      // Any result that doesn't throw means the browser opened and was later
      // dismissed. On iOS, SFSafariViewController always resolves with
      // type: 'cancel' when the user taps "Done" — this is the normal close
      // path, not a failure. Treating it as success: false would prevent
      // callers (e.g. PayoutFailedBanner) from running post-browser logic.
      console.log('[Browser] in-app browser dismissed, control returned to caller');
      return { success: true };
    } catch (webBrowserError) {
      // Not available or failed import: fall back to Linking. Note this path
      // opens the OS browser (leaving the app) rather than an in-app sheet,
      // so — unlike the WebBrowser path — this promise does NOT wait for the
      // user to return; callers awaiting this to then refresh state will
      // refresh immediately, before the user has done anything in Stripe.
      console.warn('[Browser] WebBrowser unavailable, falling back to Linking (external browser)', webBrowserError);
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        console.log('[Browser] redirect initiated via external browser (Linking)');
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
