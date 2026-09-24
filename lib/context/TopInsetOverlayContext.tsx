import React, { createContext, ReactNode, useContext, useMemo, useState } from 'react';
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
  /** Flat stand-in for the strip's color, used to pick the status-bar icon style. */
  barColor: string;
};

type TopInsetOverlayContextValue = {
  overlay: TopInsetOverlay | null;
  setOverlay: (overlay: TopInsetOverlay | null) => void;
};

const TopInsetOverlayContext = createContext<TopInsetOverlayContextValue | undefined>(undefined);

export const TopInsetOverlayProvider = ({ children }: { children: ReactNode }) => {
  const [overlay, setOverlay] = useState<TopInsetOverlay | null>(null);
  const value = useMemo(() => ({ overlay, setOverlay }), [overlay]);
  return (
    <TopInsetOverlayContext.Provider value={value}>{children}</TopInsetOverlayContext.Provider>
  );
};

/**
 * Returns null outside a provider rather than throwing: screens that use this
 * also render in isolation (tests, previews), where there is no inset to paint.
 */
export const useTopInsetOverlay = () => useContext(TopInsetOverlayContext) ?? null;

export default TopInsetOverlayContext;
