import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { supabaseEnv } from './lib/supabase';

// Global handler for unhandled promise rejections — best-effort report to Sentry
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Sentry = require('@sentry/react-native');
    if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('unhandledrejection', (ev) => {
            try {
                const reason = ev?.reason || ev;
                if (Sentry && typeof Sentry.captureException === 'function') Sentry.captureException(reason);
            } catch (e) {
                // ignore
            }
        });
    }

    if (typeof process !== 'undefined' && process && typeof process.on === 'function') {
        process.on('unhandledRejection', (reason) => {
            try {
                if (Sentry && typeof Sentry.captureException === 'function') Sentry.captureException(reason);
            } catch (e) {
                // ignore
            }
        });
    }
} catch (e) {
    // Sentry not available or environment doesn't support it — ignore
}

// Add a lightweight Sentry breadcrumb and console diagnostic about Supabase
// configuration at app startup. This intentionally avoids logging secret values
// and only records whether a URL/key is present so we can triage mis-injected
// envs in distributed builds (TestFlight / Play Store).
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Sentry = require('@sentry/react-native');
    const safeInfo = {
        hasUrl: Boolean(supabaseEnv?.url),
        hasKey: Boolean(supabaseEnv?.anonKey),
        urlPrefix: supabaseEnv?.url ? String(supabaseEnv.url).substring(0, 40) : undefined,
        env: process.env.EXPO_PUBLIC_ENVIRONMENT || process.env.NODE_ENV || 'unknown',
    };

    if (Sentry && typeof Sentry.addBreadcrumb === 'function') {
        Sentry.addBreadcrumb({
            category: 'diagnostic.supabase',
            message: 'Supabase env at startup',
            data: safeInfo,
            level: 'info',
        });
    }

    // Also log to console for internal builds to help quick debugging
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('[startup] supabaseEnv safe info:', safeInfo);
    }
} catch (e) {
    // ignore if Sentry or supabaseEnv import fails at runtime
}

export function App() {
    const ctx = require.context('./app');
    return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
