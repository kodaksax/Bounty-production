// Global JS error handlers to capture uncaught exceptions and unhandled promise rejections
import { Alert } from 'react-native';

// Preserve original handlers
const originalConsoleError = console.error;

let installed = false;

export function initGlobalErrorHandlers() {
  // Once per JS runtime. A second call used to replace whatever handler had
  // been chained on top of this one since the first (Sentry's), and Sentry
  // installs its own only once, so it never came back.
  if (installed) return;
  installed = true;

  // Catch uncaught exceptions (React Native)
  // @ts-ignore
  if (global.ErrorUtils && typeof global.ErrorUtils.setGlobalHandler === 'function') {
    // Whatever was installed before us — PostHog's error tracking (lib/posthog.ts)
    // or React Native's default. Forwarded below so it still sees every error.
    // @ts-ignore
    const previousHandler = global.ErrorUtils.getGlobalHandler?.();
    // @ts-ignore
    global.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      try {
        // Always as non-fatal: this handler deliberately shows an alert
        // instead of letting a fatal JS error take the app down, and the
        // default handler would crash on isFatal=true.
        previousHandler?.(error, false);
      } catch {
        // a reporter failing must not stop the alert below
      }
      try {
        const message = `GlobalHandler: ${error?.name || 'Error'}: ${error?.message || error}`;
        // send to remote logger or console
        originalConsoleError(message, error);
        // Also send to native (console.log appears in device logs)
        console.log('ERROR_HANDLING_CAPTURE', message);
        if (isFatal) {
          // Show minimal alert in release to avoid silent crash (optional)
          try { Alert.alert('An error occurred', message); } catch { }
        }
      } catch (e) {
        originalConsoleError('Error in global handler', e);
      }
    });
  }

  // Unhandled promise rejections
  // @ts-ignore
  if (typeof globalThis.addEventListener === 'function') {
    // In RN, this may not be available; register a fallback
    try {
      // @ts-ignore
      globalThis.addEventListener('unhandledrejection', (event) => {
        try {
          const reason = event.reason || event;
          console.log('UNHANDLED_PROMISE_REJECTION', reason);
          originalConsoleError('Unhandled promise rejection', reason);
        } catch {
            originalConsoleError('Error handling unhandledrejection');
          }
      });
    } catch {
      // Fallback: patch Promise
      const origThen = Promise.prototype.then;
      (Promise.prototype as any).then = function (onFulfilled: any, onRejected: any) {
        return (origThen as any).call(this, onFulfilled, onRejected).catch((err: any) => {
          console.log('UNHANDLED_PROMISE_REJECTION_FALLBACK', err);
          originalConsoleError('Unhandled promise rejection (fallback)', err);
          throw err;
        });
      };
    }
  }

  // Hook console.error to capture any runtime errors
  console.error = (...args: any[]) => {
    try {
      console.log('CONSOLE_ERROR_CAPTURE', ...args);
    } catch {
      // swallow
    }
    originalConsoleError.apply(console, args as any);
  };
}
