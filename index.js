// Load small runtime shims before any other imports to avoid native logger crashes
require('./expo-shims');

const { registerRootComponent } = require('expo');
const { ExpoRoot } = require('expo-router');
const React = require('react');
const { StyleSheet, Text, View } = require('react-native');
require('react-native-gesture-handler');
require('react-native-url-polyfill/auto');
const { supabaseEnv } = require('./lib/supabase');

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

// Last-resort boundary ABOVE the router.
//
// Without this, any throw while a root route module is evaluated (or during
// its first render) leaves the app with no mounted React tree: the native
// splash is never hidden, no crash report is filed, and Sentry is never
// initialized because that happens inside RootLayout. The result is an app
// frozen on the splash screen with zero telemetry -- which is exactly how
// 2.0.5 (iOS build 85) shipped and why it could not be diagnosed remotely.
//
// This converts that silent freeze into a readable on-screen error, and
// makes a best-effort report. Keep its imports limited to react/react-native
// so the boundary itself cannot be the thing that fails.
class RootErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Get the splash out of the way so the error is actually visible.
        try {
            require('expo-splash-screen').hideAsync();
        } catch (e) {
            // no native splash registered — nothing to hide
        }
        try {
            const Sentry = require('@sentry/react-native');
            if (Sentry && typeof Sentry.captureException === 'function') {
                Sentry.captureException(error, {
                    tags: { boundary: 'root_error_boundary' },
                    extra: { componentStack: info && info.componentStack },
                });
            }
        } catch (e) {
            // Sentry unavailable (or never initialized) — the on-screen
            // message below is then the only signal, which is still better
            // than a frozen splash.
        }
        // eslint-disable-next-line no-console
        console.error('[startup] root render failed:', error);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <View style={rootErrorStyles.container}>
                <Text style={rootErrorStyles.title}>BOUNTY failed to start</Text>
                <Text style={rootErrorStyles.message}>
                    {String((error && error.message) || error)}
                </Text>
            </View>
        );
    }
}

const rootErrorStyles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#0B0F14',
    },
    title: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 12,
        textAlign: 'center',
    },
    message: {
        color: '#d1d5db',
        fontSize: 13,
        textAlign: 'center',
    },
});

function Root() {
    return (
        <RootErrorBoundary>
            <App />
        </RootErrorBoundary>
    );
}

registerRootComponent(Root);
