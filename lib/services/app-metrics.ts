/**
 * Guarded access to expo-observe (Expo App Metrics).
 *
 * expo-observe calls requireNativeModule('ExpoAppMetrics') when it is first
 * imported. A binary built before the dependency was added (an old dev
 * client, Expo Go) does not have that module, so a static import throws while
 * app/_layout.tsx is being evaluated. That kills the root layout, and the
 * router then renders routes with no providers above them, which shows up as
 * a second, misleading error ("useAppThemeContext must be used within
 * AppThemeProvider").
 *
 * Loading it here turns that one known failure, a missing native module, into
 * a no-op: the app starts, and only the startup metrics are lost. Any other
 * load error is a real bug (bad resolution, changed API) and is rethrown in
 * development; in production it is logged and metrics are skipped, because a
 * metrics library must never be what stops the app from starting.
 */
import type { ComponentType } from 'react';

type WrapFn = <P extends Record<string, unknown>>(
  Component: ComponentType<P>
) => ComponentType<P>;

interface AppMetricsApi {
  markInteractive: () => void;
}

const MISSING_NATIVE_MODULE = /Cannot find native module/i;

export function isMissingNativeModuleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return MISSING_NATIVE_MODULE.test(message);
}

let appMetrics: AppMetricsApi | null = null;
let wrapRoot: WrapFn | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const observe = require('expo-observe');
  appMetrics = observe.AppMetrics ?? null;
  wrapRoot = observe.AppMetricsRoot?.wrap ?? null;
} catch (e) {
  if (isMissingNativeModuleError(e)) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[app-metrics] ExpoAppMetrics is not in this binary; startup metrics disabled. ' +
          'Rebuild the dev client to include expo-observe.'
      );
    }
  } else if (__DEV__) {
    throw e;
  } else {
    // eslint-disable-next-line no-console
    console.error('[app-metrics] expo-observe failed to load; startup metrics disabled.', e);
  }
}

/** Marks the app interactive for Expo App Metrics. Never throws. */
export function markAppInteractive(): void {
  try {
    appMetrics?.markInteractive();
  } catch {
    // metrics are best-effort
  }
}

/** Wraps the root component with AppMetricsRoot when available; otherwise returns it unchanged. */
export function wrapWithAppMetrics<P extends Record<string, unknown>>(
  Component: ComponentType<P>
): ComponentType<P> {
  if (!wrapRoot) return Component;
  try {
    return wrapRoot(Component);
  } catch {
    return Component;
  }
}
