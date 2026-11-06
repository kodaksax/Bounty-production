import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, type ViewToken } from 'react-native'
import {
  buildApplicationEventProps,
  countApplicantsByBounty,
  type ApplicationViewSurface,
} from 'lib/analytics/application-view'
import { consumeFirstApplicationViewOnSurface, markApplicationViewed } from 'lib/analytics/sessionFlags'
import { analyticsService } from 'lib/services/analytics-service'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { useIsScreenFocused } from './useRouteFocus'

/**
 * The hook enforces a 250 ms visible exposure after FlatList reports geometry.
 * Module constant because FlatList throws if viewabilityConfig changes identity
 * between renders.
 */
export const APPLICATION_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 0,
} as const

/**
 * Fires `application_viewed` for each pending application that is actually on
 * screen in a poster's applicant LIST (Inbox > My Bounties rows, or the legacy
 * Requests tab cards). Replaces `applicant_list_viewed` (retired 2026-11-05),
 * which fired per bounty when the list merely rendered -- including while the
 * Inbox sat preloaded off-screen beside Wallet.
 *
 * Spread the returned props onto the FlatList. `enabled` must be true only
 * while the poster can see that list (right tab of the right segment); rows
 * already on screen when it turns true are reported at that moment.
 *
 * One event per application per surface per app session.
 */
export function useApplicationListViews<T>({
  surface,
  enabled,
  bountyRequests,
  getApplication,
}: {
  surface: Exclude<ApplicationViewSurface, 'bounty_thread'>
  enabled: boolean
  bountyRequests: BountyRequestWithDetails[]
  /** Maps a list item to its pending application, or null for non-application rows. */
  getApplication: (item: T) => BountyRequestWithDetails | null
}) {
  const visibleRef = useRef<Map<string, BountyRequestWithDetails>>(new Map())
  const focused = useIsScreenFocused()
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active')
  const screenVisibleRef = useRef(false)
  screenVisibleRef.current = focused && appActive
  const canReportRef = useRef(false)
  canReportRef.current = enabled && focused && appActive
  const getApplicationRef = useRef(getApplication)
  getApplicationRef.current = getApplication
  const countsRef = useRef<Map<string, number>>(new Map())
  countsRef.current = countApplicantsByBounty(bountyRequests)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const report = useCallback(
    (request: BountyRequestWithDetails) => {
      const applicationId = String(request.id)
      if (!consumeFirstApplicationViewOnSurface(applicationId, surface)) return
      const props = buildApplicationEventProps(request)
      const firstView = markApplicationViewed(applicationId)
      void analyticsService
        .trackEvent('application_viewed', {
          ...props,
          applicant_count: props.bounty_id ? countsRef.current.get(props.bounty_id) : undefined,
          surface,
          first_view_this_session: firstView,
        })
        .catch(() => {})
    },
    [surface]
  )
  const reportRef = useRef(report)
  reportRef.current = report
  const clearTimer = useCallback((applicationId: string) => {
    const timer = timersRef.current.get(applicationId)
    if (timer !== undefined) clearTimeout(timer)
    timersRef.current.delete(applicationId)
  }, [])
  const scheduleReport = useCallback((request: BountyRequestWithDetails) => {
    const applicationId = String(request.id)
    if (!canReportRef.current || timersRef.current.has(applicationId)) return
    const timer = setTimeout(() => {
      timersRef.current.delete(applicationId)
      if (canReportRef.current && visibleRef.current.has(applicationId)) reportRef.current(request)
    }, 250)
    timersRef.current.set(applicationId, timer)
  }, [])

  // Stable for the FlatList's lifetime (it must never change identity).
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (!screenVisibleRef.current) return
    const next = new Map<string, BountyRequestWithDetails>()
    for (const token of viewableItems) {
      if (!token.isViewable) continue
      const request = getApplicationRef.current(token.item as T)
      if (request && request.status === 'pending') next.set(String(request.id), request)
    }
    timersRef.current.forEach((_, id) => {
      if (!next.has(id)) clearTimer(id)
    })
    visibleRef.current = next
    if (canReportRef.current) next.forEach(scheduleReport)
  }).current

  // The list became visible with rows already on screen (tab switch, segment
  // swipe settling): start their exposure interval here, too.
  useEffect(() => {
    if (!enabled || !focused || !appActive) {
      timersRef.current.forEach((_, id) => clearTimer(id))
      return
    }
    visibleRef.current.forEach(scheduleReport)
  }, [enabled, focused, appActive, clearTimer, scheduleReport])

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setAppActive(next === 'active'))
    return () => sub.remove()
  }, [])

  useEffect(
    () => () => {
      timersRef.current.forEach((_, id) => clearTimer(id))
    },
    [clearTimer]
  )

  return { onViewableItemsChanged, viewabilityConfig: APPLICATION_VIEWABILITY_CONFIG }
}
