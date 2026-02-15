// Lightweight module-level initial-navigation gate.
// Use this to mark when the app's initial navigation (on cold start/sign-in) has completed.
let done = false;
const listeners: Array<() => void> = [];

const now = () => new Date().toISOString();

function safeTraceCaller() {
  try {
    const s = new Error().stack;
    if (!s) return undefined;
    const parts = s.split('\n').map(p => p.trim()).filter(Boolean);
    // parts[0] is 'Error', parts[1] is this func, parts[2] is caller
    return parts[2];
  } catch {
    return undefined;
  }
}

export function markInitialNavigationDone() {
  if (done) {
    console.debug(`[initial-navigation] markInitialNavigationDone called but already done: ${now()}`)
    return;
  }
  done = true;
  console.debug(`[initial-navigation] markInitialNavigationDone called: ${now()} caller=${safeTraceCaller() ?? 'unknown'}`)
  try {
    // invoke listeners
    for (const l of listeners.slice()) {
      try {
        try { l(); } catch (e) { console.debug('[initial-navigation] listener threw', e); }
      } catch {}
    }
  } finally {
    console.debug(`[initial-navigation] invoking listeners complete; clearing ${listeners.length} listeners: ${now()}`)
    listeners.length = 0;
  }
}

export function isInitialNavigationDone() {
  return done;
}

export function onInitialNavigationDone(cb: () => void) {
  if (done) {
    // Call immediately if already done
    console.debug(`[initial-navigation] onInitialNavigationDone called but already done; invoking immediately: ${now()} caller=${safeTraceCaller() ?? 'unknown'}`)
    try { cb(); } catch (e) { console.debug('[initial-navigation] immediate listener threw', e); }
    return () => {};
  }
  listeners.push(cb);
  console.debug(`[initial-navigation] listener registered (pending). total=${listeners.length} ${now()}`)
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx !== -1) {
      listeners.splice(idx, 1);
      console.debug(`[initial-navigation] listener unregistered. total=${listeners.length} ${now()}`)
    }
  };
}

