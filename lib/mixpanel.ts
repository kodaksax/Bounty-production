// lib/mixpanel.ts

const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN || process.env.EXPO_PUBLIC_MIXPANEL_TOKEN || "837ee21ece9dc2a5f371972186b06072";

let _mixpanel: any | null = null;
let _initialized = false;

// Initialize the native Mixpanel SDK. This wrapper assumes a purely
// React Native mobile app (iOS/Android) and therefore only uses the
// native `@mixpanel/react-native` package. No web/browser fallbacks
// or mixpanel-browser imports are used.
export async function initMixpanel() {
  if (_initialized) return;
  _initialized = true; // mark attempted to avoid repeated noisy logs

  try {
    const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

    if (isWeb) {
      // web/browser environment: prefer `mixpanel-browser` when available
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const webModule = await import('mixpanel-browser');
      const webPkg: any = (webModule as any).default ?? webModule;
      if (typeof webPkg.init === 'function') {
        webPkg.init(MIXPANEL_TOKEN);
      }
      _mixpanel = webPkg;
      return;
    }

    // runtime import for native package; @ts-ignore because types may not exist
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const nativeModule = await import('@mixpanel/react-native');
    const nativePkg: any = (nativeModule as any).default ?? nativeModule;

    if (typeof nativePkg.init === 'function') {
      const instance = await nativePkg.init(MIXPANEL_TOKEN);
      _mixpanel = instance ?? nativePkg;
    } else if (typeof nativePkg.create === 'function') {
      _mixpanel = await nativePkg.create(MIXPANEL_TOKEN);
    } else if (typeof nativePkg === 'function') {
      const instance = new nativePkg(MIXPANEL_TOKEN);
      if (typeof instance.init === 'function') await instance.init();
      _mixpanel = instance;
    } else {
      _mixpanel = nativePkg;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mixpanel] native init failed or not installed', e);
    console.error('[mixpanel] To fix: install `@mixpanel/react-native` for native apps and rebuild, or `mixpanel-browser` for web.');
    _mixpanel = null;
  }
}

export const isMixpanelReady = () => !!_mixpanel;

export const identify = (id: string, props?: Record<string, any>) => {
  try {
    if (!_mixpanel) {
      if (__DEV__) console.error('[mixpanel] identify called but SDK not initialized');
      return;
    }
    if (typeof _mixpanel.identify === 'function') {
      _mixpanel.identify(id);
    }
    // Set people properties if supported
    try {
      const people = typeof _mixpanel.getPeople === 'function' ? _mixpanel.getPeople() : _mixpanel.people;
      if (people && typeof people.set === 'function' && props) {
        people.set(props);
      }
    } catch (e) {
      // ignore people-set failures
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('mixpanel identify failed', e);
  }
};

export const track = (event: string, props?: Record<string, any>) => {
  try {
    if (!_mixpanel) {
      if (__DEV__) console.error('[mixpanel] track called but SDK not initialized. Event:', event, props);
      return;
    }
    if (typeof _mixpanel.track === 'function') {
      _mixpanel.track(event, props);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('mixpanel track failed', e);
  }
};

export default function getMixpanel() {
  return _mixpanel;
}
