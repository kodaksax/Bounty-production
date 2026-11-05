import { useCallback, useEffect, useRef } from 'react'
import type { ViewToken } from 'react-native'
import {
  buildApplicationEventProps,
  countApplicantsByBounty,
  type ApplicationViewSurface,
} from 'lib/analytics/application-view'
import { consumeFirstApplicationViewOnSurface, markApplicationViewed } from 'lib/analytics/sessionFlags'
import { analyticsService } from 'lib/services/analytics-service'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'

/**
 * Half-visible for a quarter second: a row the poster could actually read,
 * not one that flicked past during a fling. Module constant because FlatList
 * throws if viewabilityConfig changes identity between renders.
 */
export const APPLICATION_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 250,
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
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const getApplicationRef = useRef(getApplication)
  getApplicationRef.current = getApplication
  const countsRef = useRef<Map<string, number>>(new Map())
  countsRef.current = countApplicantsByBounty(bountyRequests)

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

  // Stable for the FlatList's lifetime (it must never change identity).
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const next = new Map<string, BountyRequestWithDetails>()
    for (const token of viewableItems) {
      if (!token.isViewable) continue
      const request = getApplicationRef.current(token.item as T)
      if (request && request.status === 'pending') next.set(String(request.id), request)
    }
    visibleRef.current = next
    if (enabledRef.current) next.forEach(r => reportRef.current(r))
  }).current

  // The list became visible with rows already on screen (tab switch, segment
  // swipe settling): those rows don't produce a viewability change, so report
  // them here.
  useEffect(() => {
    if (!enabled) return
    visibleRef.current.forEach(r => report(r))
  }, [enabled, report])

  return { onViewableItemsChanged, viewabilityConfig: APPLICATION_VIEWABILITY_CONFIG }
}
