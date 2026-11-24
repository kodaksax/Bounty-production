/**
 * Duplicate-navigation guard.
 *
 * Root cause this exists for: expo-router's `push` does not navigate
 * synchronously. It appends an action to `routingQueue`, which the root
 * layout drains in an effect after the next render. Nothing de-duplicates that
 * queue, so two taps that land before the first push renders (a fast double
 * tap, or any tap while the JS thread is busy mounting the destination) each
 * enqueue a push and the same screen is stacked twice. Messenger showed it
 * first (double-tapping a conversation opened the chat twice), but every
 * `router.push` in the app had the same exposure.
 *
 * Two layers, deliberately different:
 *
 * 1. Router layer (`wrapRouter`, installed once on expo-router's shared
 *    `router` object, which is what `useRouter()` returns everywhere). A call
 *    IDENTICAL to the last accepted one (same method, same destination) is
 *    dropped while that navigation is still settling. This catches double and
 *    triple taps on every button in the app without touching call sites, and
 *    it cannot break programmatic sequences: `back(); push(x)`,
 *    `replace('/tabs'); push('/bounty/1')`, or a redirect effect on the
 *    screen that just mounted all differ from the call before them, so they
 *    all pass.
 *
 * 2. Press layer (`runPress`). Tapping row A and then row B of a list is two
 *    DIFFERENT destinations, which the router layer must allow (it cannot tell
 *    a tap from code). List rows that navigate opt in to `runPress`, which
 *    admits one navigation tap app-wide per settle window, whatever its
 *    destination. Only tap handlers use it, so redirects never are.
 *
 * "Settling" is measured from the first animation frame AFTER the accepted
 * call, not from the call itself. When the destination is heavy, the JS
 * thread is blocked rendering it, and a tap queued behind that render is
 * handled long after the wall-clock time of the first tap. While that frame
 * has not happened the window is held open, so the queued tap is still
 * recognised as a duplicate. A hard cap keeps a frame that never comes (app
 * backgrounded mid-navigation) from locking navigation indefinitely.
 */

/** How long after the first frame a duplicate is still treated as one.
 *  Covers the native-stack push/pop animation (~350ms) with margin. */
export const NAVIGATION_SETTLE_MS = 500;
/** Upper bound on waiting for that first frame. */
export const NAVIGATION_MAX_PENDING_MS = 3000;

type Clock = () => number;
type FrameScheduler = (callback: () => void) => void;

const defaultScheduleFrame: FrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback());
  else setTimeout(callback, 16);
};

/** A window that opens when a call is accepted and closes once it settles. */
function createSettleWindow(now: Clock, scheduleFrame: FrameScheduler, settleMs: number, maxPendingMs: number) {
  let lastKey: string | null = null;
  let acceptedAt = 0;
  let settledAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  let token = 0;

  const isOpen = () => {
    const t = now();
    if (pending && t - acceptedAt < maxPendingMs) return true;
    return t - settledAt < settleMs;
  };

  return {
    /** Would `key` be refused right now? `matchAny` refuses every key while open. */
    blocks(key: string, matchAny: boolean) {
      return isOpen() && (matchAny || key === lastKey);
    },
    accept(key: string) {
      lastKey = key;
      acceptedAt = now();
      pending = true;
      const mine = ++token;
      scheduleFrame(() => {
        if (mine !== token) return;
        pending = false;
        settledAt = now();
      });
    },
    reset() {
      token++;
      lastKey = null;
      pending = false;
      settledAt = Number.NEGATIVE_INFINITY;
    },
  };
}

/** Normalise an expo-router Href (string or `{ pathname, params }`) to a stable key. */
export function hrefKey(href: unknown): string {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    const { pathname, params } = href as { pathname?: unknown; params?: Record<string, unknown> };
    const sorted =
      params && typeof params === 'object'
        ? Object.keys(params)
            .sort()
            .map((k) => `${k}=${JSON.stringify(params[k])}`)
            .join('&')
        : '';
    return `${String(pathname ?? '')}?${sorted}`;
  }
  return String(href);
}

/** Router methods that take a destination. */
const FORWARD_METHODS = ['push', 'navigate', 'replace', 'dismissTo'] as const;

type RouterLike = Record<string | symbol, unknown>;
const GUARDED = Symbol.for('bounty.navigationGuard');

export interface NavigationGuardOptions {
  now?: Clock;
  scheduleFrame?: FrameScheduler;
  settleMs?: number;
  maxPendingMs?: number;
  onDrop?: (key: string) => void;
}

export function createNavigationGuard(options: NavigationGuardOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
  const settleMs = options.settleMs ?? NAVIGATION_SETTLE_MS;
  const maxPendingMs = options.maxPendingMs ?? NAVIGATION_MAX_PENDING_MS;
  const onDrop = options.onDrop;

  const routerWindow = createSettleWindow(now, scheduleFrame, settleMs, maxPendingMs);
  const pressWindow = createSettleWindow(now, scheduleFrame, settleMs, maxPendingMs);

  /** Accept `key` unless it repeats the call still settling. */
  const admit = (key: string): boolean => {
    if (routerWindow.blocks(key, false)) {
      onDrop?.(key);
      return false;
    }
    routerWindow.accept(key);
    return true;
  };

  /**
   * Patch a router object in place so every caller of it is guarded.
   * Idempotent; methods the object does not have are left alone.
   */
  const wrapRouter = <R extends object>(router: R): R => {
    // A jest mock of expo-router may not export `router` at all.
    if (!router || typeof router !== 'object') return router;
    const target = router as unknown as RouterLike;
    if (target[GUARDED]) return router;

    for (const method of FORWARD_METHODS) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      target[method] = (href: unknown, ...rest: unknown[]) => {
        if (!admit(`${method}:${hrefKey(href)}`)) return undefined;
        return (original as (...args: unknown[]) => unknown).call(router, href, ...rest);
      };
    }

    const back = target.back;
    if (typeof back === 'function') {
      target.back = (...args: unknown[]) => {
        if (!admit('back')) return undefined;
        // Leaving a screen ends whatever tap opened it, so the screen we land
        // on is immediately tappable again.
        pressWindow.reset();
        return (back as (...a: unknown[]) => unknown).apply(router, args);
      };
    }

    const dismiss = target.dismiss;
    if (typeof dismiss === 'function') {
      target.dismiss = (count?: unknown, ...rest: unknown[]) => {
        if (!admit(`dismiss:${count ?? 1}`)) return undefined;
        pressWindow.reset();
        return (dismiss as (...a: unknown[]) => unknown).call(router, count, ...rest);
      };
    }

    const dismissAll = target.dismissAll;
    if (typeof dismissAll === 'function') {
      target.dismissAll = (...args: unknown[]) => {
        if (!admit('dismissAll')) return undefined;
        pressWindow.reset();
        return (dismissAll as (...a: unknown[]) => unknown).apply(router, args);
      };
    }

    Object.defineProperty(target, GUARDED, { value: true, enumerable: false });
    return router;
  };

  /**
   * Run a navigation tap, unless another navigation tap is still settling.
   * For list rows and cards: two rows tapped in quick succession open the
   * first only. Returns whether `navigate` ran.
   */
  const runPress = (navigate: () => void): boolean => {
    if (pressWindow.blocks('*', true)) {
      onDrop?.('press');
      return false;
    }
    pressWindow.accept('*');
    navigate();
    return true;
  };

  /** Is a back navigation still settling? For back helpers that branch on
   *  `canGoBack()`, whose answer has already changed under a second tap. */
  const isBackSettling = () => routerWindow.blocks('back', false);

  const reset = () => {
    routerWindow.reset();
    pressWindow.reset();
  };

  return { wrapRouter, runPress, isBackSettling, reset };
}

const devDrop = (key: string) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.NODE_ENV !== 'test') {
    console.debug(`[navigation-guard] ignored duplicate navigation: ${key}`);
  }
};

/** The app-wide instance. `install-navigation-guard.ts` applies it to expo-router. */
export const navigationGuard = createNavigationGuard({ onDrop: devDrop });

/** See `createNavigationGuard().runPress`. */
export const runNavigationPress = navigationGuard.runPress;
