import { createContext, useContext } from 'react'
import type { Animated } from 'react-native'
import type { Gesture } from 'react-native-gesture-handler'

type NativeGesture = ReturnType<typeof Gesture.Native>

/**
 * The tab shell's native horizontal pager (app/tabs/bounty-app.tsx), exposed
 * to the tabs inside it.
 *
 * - `gesture` lets a swipe nested inside a tab take precedence — the Inbox's
 *   My Work / My Bounties pan calls `.blocksExternalGesture(gesture)` so the
 *   pager waits for that pan to fail before it starts scrolling.
 * - `scrollX` (natively driven) plus `pageWidth` / `order` let a tab move
 *   things that live outside its page in step with it — see pageTranslateX.
 *
 * Null outside the shell (tests, any other host).
 */
export type TabPager = {
  gesture: NativeGesture
  scrollX: Animated.Value
  pageWidth: number
  order: readonly string[]
}

export const TabPagerContext = createContext<TabPager | null>(null)

export const useTabPager = () => useContext(TabPagerContext)

/**
 * Horizontal offset of tab `key`'s page relative to the screen, following the
 * pager live: 0 while the page is in view, ±pageWidth once it is off either
 * side (clamped there, so it never drifts further). Used to slide the
 * status-bar strip overlay (lib/context/TopInsetOverlayContext.tsx) with its
 * page instead of switching it when the swipe commits. Undefined when `key`
 * isn't in the pager.
 */
export function pageTranslateX(
  pager: TabPager | null,
  key: string
): Animated.AnimatedInterpolation<number> | undefined {
  if (!pager || pager.pageWidth <= 0) return undefined
  const idx = pager.order.indexOf(key)
  if (idx === -1) return undefined
  const w = pager.pageWidth
  return pager.scrollX.interpolate({
    inputRange: [(idx - 1) * w, idx * w, (idx + 1) * w],
    outputRange: [w, 0, -w],
    extrapolate: 'clamp',
  })
}
