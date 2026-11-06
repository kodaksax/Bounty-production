// Lightweight module-level flags for "has X already happened this app
// session" analytics properties. Plain module state (not AsyncStorage/Context)
// so it naturally resets on cold start, matching "session" semantics without
// any persistence or async read.

let hasSeenBountyList = false

// Returns whether this is the first bounty_list_viewed of the session, and
// marks the session as having seen one. Call once per fire, right before
// capturing the event.
export function consumeIsFirstBountyListViewOfSession(): boolean {
  const isFirst = !hasSeenBountyList
  hasSeenBountyList = true
  return isFirst
}

// Hunter profiles a poster has opened from an applicant-selection surface
// this session, keyed by `${bountyId}:${hunterId}`. Backs
// `application_accepted`'s `profileViewedBeforeAccept` property -- the
// screens involved (InboxScreen's Requests tab, the profile screen) unmount
// on navigation (see issue #779), so this can't live in component state.
const viewedApplicantProfiles = new Set<string>()

function applicantProfileKey(bountyId: string, hunterId: string): string {
  return `${bountyId}:${hunterId}`
}

export function markApplicantProfileViewed(bountyId: string, hunterId: string): void {
  viewedApplicantProfiles.add(applicantProfileKey(bountyId, hunterId))
}

export function wasApplicantProfileViewed(bountyId: string, hunterId: string): boolean {
  return viewedApplicantProfiles.has(applicantProfileKey(bountyId, hunterId))
}

// Applications the poster has seen this session. `byId` backs
// application_viewed's `first_view_this_session`; `bySurface` keeps the LIST
// surfaces (Inbox rows, legacy Requests cards) to one application_viewed per
// application per session, so scrolling a row in and out never refires it.
// The bounty thread deliberately does not use `bySurface`: every visit there
// is its own view, paired with at most one application_dismissed.
const viewedApplicationIds = new Set<string>()
const viewedApplicationSurfaces = new Set<string>()

/** Records a view; returns whether it was the first of this application on ANY surface. */
export function markApplicationViewed(applicationId: string): boolean {
  const first = !viewedApplicationIds.has(applicationId)
  viewedApplicationIds.add(applicationId)
  return first
}

/** True the first time (applicationId, surface) is seen this session, false after. */
export function consumeFirstApplicationViewOnSurface(applicationId: string, surface: string): boolean {
  const key = `${surface}:${applicationId}`
  if (viewedApplicationSurfaces.has(key)) return false
  viewedApplicationSurfaces.add(key)
  return true
}

/** Test-only: module state otherwise lives for the app session. */
export function __resetApplicationViewFlagsForTests(): void {
  viewedApplicationIds.clear()
  viewedApplicationSurfaces.clear()
}
