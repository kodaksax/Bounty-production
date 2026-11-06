/**
 * Shared payload for the poster-side "did they look at this application?"
 * events: `application_viewed` and `application_dismissed`.
 *
 * Both answer the same question from opposite ends -- is the acceptance
 * problem "posters aren't coming back to look" or "posters look and walk
 * away" -- so they carry identical identifying fields and join to
 * `application_accepted` / `application_declined` / `accept_blocked_by_payment`
 * on `application_id` (all snake_case, matching application_accepted).
 *
 * Never carries the application's message text, only whether one exists.
 */
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { deriveCoarseVerificationStatus } from 'lib/utils/normalize-profile'

/**
 * Where the poster saw the application.
 *  - inbox_list:    a row in Inbox > My Bounties (name, distance, message preview).
 *  - requests_list: an ApplicantCard on the legacy postings-screen Requests tab
 *                   (still reachable from moments); Accept/Decline are on the card.
 *  - bounty_thread: the application opened on its own, with Accept / Pass. The
 *                   only surface `application_dismissed` fires from.
 */
export type ApplicationViewSurface = 'inbox_list' | 'requests_list' | 'bounty_thread'

/** Hours between the application arriving and `now`, one decimal place. */
export function applicationAgeHours(createdAt: unknown, now: number = Date.now()): number | undefined {
  if (typeof createdAt !== 'string' || !createdAt) return undefined
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, Math.round(((now - t) / 3_600_000) * 10) / 10)
}

/** Pending applications per bounty id, for `applicant_count`. */
export function countApplicantsByBounty(requests: BountyRequestWithDetails[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of requests) {
    const bountyId = (r as any)?.bounty_id ?? (r.bounty as any)?.id
    if (bountyId == null) continue
    const key = String(bountyId)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function buildApplicationEventProps(
  request: BountyRequestWithDetails,
  opts: { applicantCount?: number; now?: number } = {}
) {
  const bountyId = (request as any)?.bounty_id ?? (request.bounty as any)?.id
  const hunterId = (request as any)?.hunter_id ?? (request as any)?.user_id
  const bounty = (request.bounty ?? {}) as any
  return {
    role: 'poster' as const,
    bounty_id: bountyId != null ? String(bountyId) : undefined,
    application_id: String(request.id),
    hunter_id: hunterId != null ? String(hunterId) : undefined,
    applicant_count: opts.applicantCount,
    // How long the application had been waiting when the poster saw it. The
    // "are posters coming back?" half of the question lives in this number.
    application_age_hours: applicationAgeHours((request as any)?.created_at, opts.now),
    hunter_verified:
      deriveCoarseVerificationStatus(
        (request.profile as any)?.stripe_identity_status,
        (request.profile as any)?.id_verification_status
      ) === 'verified',
    hunter_completed: (request.profile as any)?.hunterCompleted ?? 0,
    has_message: !!(request as any)?.message,
    // Server-stamped whole miles (SBA-02); omitted for online jobs / unknown.
    applicant_distance_mi: (request as any)?.distance_mi ?? undefined,
    is_for_honor: !!bounty.is_for_honor,
    amount: bounty.amount ?? undefined,
    trustTier: bounty.trust_tier || 'standard',
  }
}
