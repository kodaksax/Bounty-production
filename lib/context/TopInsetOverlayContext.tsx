import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type { Animated } from 'react-native';

/**
 * Lets one screen paint the status-bar strip that RootFrame (app/_layout.tsx)
 * reserves above the app content.
 *
 * BackgroundColorContext already covers "make that strip a flat color". This is
 * for the case where the strip has to be the *continuation of a gradient* the
 * screen draws immediately below it — the grid feed's banner — where a flat
 * approximation would show a seam at the boundary.
 *
 * The overlay describes the whole gradient the strip is a slice of, not the
 * slice itself: give it the same colors/start/end and the full height of the
 * element below, and RootFrame clips it to the strip. That makes the visible
 * pixels identical to the ones the screen's own gradient would have drawn there
 * if content weren't laid out below the inset.
 */
export type TopInsetOverlay = {
  /** Same array passed to the LinearGradient below the strip. */
  colors: readonly [string, string, ...string[]];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  /** Full height of the gradient below, so the strip shows its true top slice. */
  height: number;
  /**
   * Scroll offset of the list the gradient lives in. The strip translates with
   * it, so the seam holds while scrolling. Animated so this doesn't re-render
   * the whole app on every frame.
   */
  scrollY?: Animated.Value;
  /**
   * Horizontal offset of the screen that owns the overlay, for a screen that
   * lives in the tab shell's swipe pager (see components/ui/tab-pager.ts).
   * The strip slides with its page, frame for frame, instead of switching
   * when the swipe commits. May be natively driven.
   */
  translateX?: Animated.AnimatedInterpolation<number>;
  /** Flat stand-in for the strip's color, used to pick the status-bar icon style. */
  barColor: string;
};

/** Overlays not tied to a tab-shell page use this key. */
export const DEFAULT_OVERLAY_KEY = 'default';

type TopInsetOverlaySetters = {
  /**
   * Sets (or, with null, clears) the overlay under `key`. Several can be up
   * at once — e.g. the grid feed's and the Post tab's, each sliding with its
   * own pager page.
   */
  setOverlay: (overlay: TopInsetOverlay | null, key?: string) => void;
  /**
   * Which key's overlay picks the status-bar icon style — the tab shell sets
   * the tab that is mostly on screen. Null: the default overlay, if any.
   */
  setFocusKey: (key: string | null) => void;
};

type TopInsetOverlayState = {
  overlays: Readonly<Record<string, TopInsetOverlay>>;
  focusKey: string | null;
};

// Split so a screen that only sets overlays (the feed) isn't re-rendered by
// RootFrame-facing state changes — the setters never change identity.
const TopInsetOverlaySettersContext = createContext<TopInsetOverlaySetters | undefined>(undefined);
const TopInsetOverlayStateContext = createContext<TopInsetOverlayState | undefined>(undefined);

export const TopInsetOverlayProvider = ({ children }: { children: ReactNode }) => {
  const [overlays, setOverlays] = useState<Readonly<Record<string, TopInsetOverlay>>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const setOverlay = useCallback((overlay: TopInsetOverlay | null, key: string = DEFAULT_OVERLAY_KEY) => {
    setOverlays(prev => {
      if (overlay) return { ...prev, [key]: overlay };
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const setters = useMemo(() => ({ setOverlay, setFocusKey }), [setOverlay]);
  const state = useMemo(() => ({ overlays, focusKey }), [overlays, focusKey]);
  return (
    <TopInsetOverlaySettersContext.Provider value={setters}>
      <TopInsetOverlayStateContext.Provider value={state}>{children}</TopInsetOverlayStateContext.Provider>
    </TopInsetOverlaySettersContext.Provider>
  );
};

/**
 * Returns null outside a provider rather than throwing: screens that use this
 * also render in isolation (tests, previews), where there is no inset to paint.
 */
export const useTopInsetOverlay = () => useContext(TopInsetOverlaySettersContext) ?? null;

const EMPTY_STATE: TopInsetOverlayState = { overlays: {}, focusKey: null };

/** For RootFrame: every overlay currently up, and which one sets the bar style. */
export const useTopInsetOverlayState = () => useContext(TopInsetOverlayStateContext) ?? EMPTY_STATE;

export default TopInsetOverlaySettersContext;
