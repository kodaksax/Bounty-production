// Global JS error handlers to capture uncaught exceptions and unhandled promise rejections
import { Alert } from 'react-native';

// Preserve original handlers
const originalConsoleError = console.error;

export function initGlobalErrorHandlers() {
  // Catch uncaught exceptions (React Native)
  // @ts-ignore
  if (global.ErrorUtils && typeof global.ErrorUtils.setGlobalHandler === 'function') {
    // @ts-ignore
    global.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      try {
        const message = `GlobalHandler: ${error?.name || 'Error'}: ${error?.message || error}`;
        // send to remote logger or console
        originalConsoleError(message, error);
        // Also send to native (console.log appears in device logs)
        console.log('ERROR_HANDLING_CAPTURE', message);
        if (isFatal) {
          // Show minimal alert in release to avoid silent crash (optional)
          try { Alert.alert('An error occurred', message); } catch (e) {}
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
        } catch (e) {
          originalConsoleError('Error handling unhandledrejection', e);
        }
      });
    } catch (e) {
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
    } catch (e) {
      // swallow
    }
    originalConsoleError.apply(console, args as any);
  };
}
