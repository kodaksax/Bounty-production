/**
 * Every new string behind the `poster-local-proof` flag, in one place for
 * founder approval.
 *
 * `proofLine` counts accounts with the hunter role that opened the app in the
 * last 7 days within the feed radius. It doesn't mean they earned anything.
 */

export const localProofStrings = {
  /** Top of the Post tab. Only shown at or above LOCAL_PROOF_MIN. */
  proofLine: (count: number) => `${count} people nearby are looking for tasks on Bounty this week`,

  /** Top of the Post tab, for a known location outside the service area. */
  outOfAreaLead: "Bounty isn't live here yet.",
  outOfAreaLink: 'Join the waitlist',

  /** Home feed, when there are no results. */
  postATask: 'Post a task',
} as const;
