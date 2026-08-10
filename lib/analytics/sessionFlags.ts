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
