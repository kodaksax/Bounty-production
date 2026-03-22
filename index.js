import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import 'react-native-gesture-handler';

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

export function App() {
    const ctx = require.context('./app');
    return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
