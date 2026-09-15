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
