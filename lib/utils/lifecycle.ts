export type TeardownFn = () => void;

export type CleanupHandle =
  | TeardownFn
  | {
      remove?: TeardownFn;
      unsubscribe?: TeardownFn;
      off?: TeardownFn;
      close?: TeardownFn;
      disconnect?: TeardownFn;
      destroy?: TeardownFn;
    }
  | null
  | undefined;

export interface DeferredCleanupController {
  setHandle: (handle: CleanupHandle) => void;
  cleanup: () => void;
  requested: () => boolean;
}

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return !!value && typeof (value as PromiseLike<T>).then === 'function';
}

function toTeardown(handle: CleanupHandle): TeardownFn | undefined {
  if (!handle) return undefined;
  if (typeof handle === 'function') return handle;
  return (
    handle.unsubscribe ||
    handle.remove ||
    handle.off ||
    handle.close ||
    handle.disconnect ||
    handle.destroy
  );
}

export function safeCleanup(handle: CleanupHandle, onError?: (error: unknown) => void): void {
  const teardown = toTeardown(handle);
  if (!teardown) return;
  try {
    teardown();
  } catch (error) {
    onError?.(error);
  }
}

export function resolveMaybeAsyncRegistration<T>(
  registration: T | PromiseLike<T>,
  onResolved: (value: T) => void,
  onError?: (error: unknown) => void
): void {
  if (isPromiseLike(registration)) {
    Promise.resolve(registration)
      .then(onResolved)
      .catch(error => {
        onError?.(error);
      });
    return;
  }

  onResolved(registration);
}

export function createDeferredCleanupController(
  onError?: (error: unknown) => void
): DeferredCleanupController {
  let cleanupRequested = false;
  let handle: CleanupHandle;

  return {
    setHandle: (nextHandle: CleanupHandle) => {
      handle = nextHandle;
      if (cleanupRequested) {
        safeCleanup(handle, onError);
      }
    },
    cleanup: () => {
      cleanupRequested = true;
      safeCleanup(handle, onError);
    },
    requested: () => cleanupRequested,
  };
}
