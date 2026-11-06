import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { buildApplicationEventProps } from 'lib/analytics/application-view'
import { markApplicationViewed } from 'lib/analytics/sessionFlags'
import { analyticsService } from 'lib/services/analytics-service'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { useIsScreenFocused } from './useRouteFocus'

/** Something the poster did with the application that is not walking away. */
export type ApplicationEngagement = 'accept' | 'decline' | 'message'

interface Visit {
  request: BountyRequestWithDetails
  startedAt: number
}

/**
 * Poster-side visits to ONE pending application in the bounty thread -- the
 * screen with Accept / Pass on it.
 *
 * A visit is a stretch of foreground time on the thread while the application
 * is pending. It starts with `application_viewed` (surface 'bounty_thread')
 * and, if the poster leaves (back / unmount) or backgrounds the app without
 * accepting, passing or messaging, ends with `application_dismissed`.
 * Returning to the foreground starts a new visit.
 *
 * `application_dismissed` is the implicit counterpart of
 * `application_declined`: declined = tapped Pass; dismissed = looked and
 * left. Together with `application_viewed` (did they look at all?) and
 * `accept_blocked_by_payment` (tried to hire, payment stopped it) they split
 * an unaccepted application into exactly one bucket.
 *
 * Once the poster engages in a mount (e.g. taps Accept, which can background
 * the app for Apple Pay / 3DS), later visits in that mount are neither
 * re-viewed nor dismissed: the hire attempt's outcome is already measured by
 * the accept/pay-gate events, and counting it again would double-classify it.
 *
 * Nothing fires when the application stops being pending while the thread is
 * open (accepted, declined, withdrawn by the hunter): that is not the poster
 * walking away.
 */
export function useApplicationDecisionVisit({
  request,
  enabled,
}: {
  request: BountyRequestWithDetails | null
  /** Poster viewing a pending application. */
  enabled: boolean
}): { markEngaged: (action: ApplicationEngagement) => void } {
  const visitRef = useRef<Visit | null>(null)
  const engagedRef = useRef(false)
  const requestRef = useRef(request)
  requestRef.current = request
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const focused = useIsScreenFocused()
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const appActiveRef = useRef(AppState.currentState === 'active')
  const applicationId = enabled && request ? String(request.id) : null

  const startVisit = useCallback(() => {
    const current = requestRef.current
    if (!current || !enabledRef.current || !focusedRef.current || !appActiveRef.current || engagedRef.current || visitRef.current) return
    visitRef.current = { request: current, startedAt: Date.now() }
    const firstView = markApplicationViewed(String(current.id))
    void analyticsService
      .trackEvent('application_viewed', {
        ...buildApplicationEventProps(current),
        surface: 'bounty_thread',
        first_view_this_session: firstView,
      })
      .catch(() => {})
  }, [])

  /** `trigger` null = the application stopped being pending: close silently. */
  const endVisit = useCallback((trigger: 'leave' | 'background' | null) => {
    const visit = visitRef.current
    visitRef.current = null
    if (!visit || !trigger || engagedRef.current) return
    void analyticsService
      .trackEvent('application_dismissed', {
        ...buildApplicationEventProps(visit.request),
        surface: 'bounty_thread',
        trigger,
        dwell_ms: Math.round((Date.now() - visit.startedAt) / 100) * 100,
      })
      .catch(() => {})
  }, [])

  // A different application (or none) means a fresh engagement slate.
  useEffect(() => {
    engagedRef.current = false
    if (!applicationId) return
    if (focused && appActiveRef.current) startVisit()
    return () => {
      // Route blur or unmount while still pending counts as leaving. A change
      // in application status closes silently.
      endVisit(enabledRef.current && requestRef.current && String(requestRef.current.id) === applicationId ? 'leave' : null)
    }
  }, [applicationId, focused, startVisit, endVisit])

  useEffect(() => {
    const sub = AppState?.addEventListener?.('change', next => {
      appActiveRef.current = next === 'active'
      if (next !== 'active') endVisit('background')
      else if (focusedRef.current) startVisit()
    })
    return () => sub?.remove?.()
  }, [startVisit, endVisit])

  const markEngaged = useCallback((_action: ApplicationEngagement) => {
    engagedRef.current = true
  }, [])

  return { markEngaged }
}
