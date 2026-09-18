import { useEffect, useRef } from 'react'
import { analyticsService } from 'lib/services/analytics-service'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { deriveCoarseVerificationStatus } from 'lib/utils/normalize-profile'

/**
 * Fires `applicant_list_viewed` for the poster's "Requests" tab.
 *
 * That tab is a single flat list of pending applications across ALL of the
 * poster's open bounties (see app/tabs/inbox-screen.tsx), not grouped by
 * bounty on screen -- so "viewed" is computed per distinct bounty
 * represented in the currently-visible list rather than once per screen
 * mount. Each bounty's (applicantCount, verifiedCount, trustTier) signature
 * is remembered so a re-render doesn't refire it; a bounty refires only when
 * its visible applicant count (or verified count) actually changes, i.e. a
 * new application arrived while the tab is open.
 *
 * Shared between app/tabs/inbox-screen.tsx and the legacy
 * app/tabs/postings-screen.tsx Requests tab -- both render the identical
 * bountyRequests-backed list (see the "still reachable from moments" note in
 * lib/services/analytics-service.ts).
 */
export function useApplicantListViewed(
  bountyRequests: BountyRequestWithDetails[],
  isActive: boolean,
  isLoading: boolean
) {
  const firedSignaturesRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!isActive || isLoading) return

    const byBounty = new Map<string, BountyRequestWithDetails[]>()
    for (const r of bountyRequests) {
      const bountyId = (r as any)?.bounty_id
      if (bountyId == null) continue
      const key = String(bountyId)
      const list = byBounty.get(key) ?? []
      list.push(r)
      byBounty.set(key, list)
    }

    for (const [bountyId, requests] of byBounty) {
      const applicantCount = requests.length
      const verifiedCount = requests.filter(
        (r) =>
          deriveCoarseVerificationStatus(
            (r.profile as any)?.stripe_identity_status,
            (r.profile as any)?.id_verification_status
          ) === 'verified'
      ).length
      const trustTier = (requests[0]?.bounty as any)?.trust_tier || 'standard'
      const signature = `${applicantCount}:${verifiedCount}:${trustTier}`

      if (firedSignaturesRef.current.get(bountyId) === signature) continue
      firedSignaturesRef.current.set(bountyId, signature)

      void analyticsService
        .trackEvent('applicant_list_viewed', {
          bountyId,
          applicantCount,
          verifiedCount,
          trustTier,
        })
        .catch(() => {})
    }
  }, [bountyRequests, isActive, isLoading])
}
