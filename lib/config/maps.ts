import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Whether native map views can be rendered on this binary, and with which
 * provider.
 *
 * Android only has the Google Maps SDK, and it throws
 * `IllegalStateException: API key not found` on a background thread (a hard
 * native crash) when the manifest has no com.google.android.geo.API_KEY.
 * iOS can always fall back to Apple Maps, which needs no key; asking for
 * PROVIDER_GOOGLE on a binary built without a key fails instead.
 *
 * The flags are written by app.config.js from EXPO_GOOGLE_MAPS_*_KEY. Bundles
 * from before they existed read as `false`, which matches those binaries.
 *
 * Deliberately does not import react-native-maps so screens can check
 * availability without loading the (lazy) map module.
 */
// expoConfig is the normal source; EAS Update bundles can surface the config
// only through manifest2 (expoClient) and legacy runtimes through manifest.
const extra = (Constants.expoConfig?.extra ??
  (Constants as any).manifest2?.extra?.expoClient?.extra ??
  (Constants as any).manifest?.extra ??
  {}) as Record<string, unknown>;

const hasGoogleKey =
  Platform.OS === 'android'
    ? extra.googleMapsAndroidKeyConfigured === true
    : Platform.OS === 'ios'
      ? extra.googleMapsIosKeyConfigured === true
      : true; // web: unchanged behaviour, no native SDK involved

/** False on Android binaries built without a Maps key — do not mount a MapView. */
export const isNativeMapAvailable = Platform.OS !== 'android' || hasGoogleKey;

/** Value for MapView's `provider` prop: 'google' when keyed, else the platform default. */
export const mapProvider: 'google' | undefined = hasGoogleKey ? 'google' : undefined;
