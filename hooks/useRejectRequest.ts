import { useCallback } from 'react'
import { Alert } from 'react-native'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { analyticsService } from 'lib/services/analytics-service'
import { useSingleFlight } from './useSingleFlight'

interface UseRejectRequestParams {
  /** The applicant list currently on screen, used to resolve bounty/hunter/trust-tier context for analytics. */
  bountyRequests: BountyRequestWithDetails[]
  setBountyRequests: React.Dispatch<React.SetStateAction<BountyRequestWithDetails[]>>
  setIsLoading: React.Dispatch<React.SetStateAction<{ myBounties: boolean; inProgress: boolean; requests: boolean }>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useRejectRequest({
  bountyRequests,
  setBountyRequests,
  setIsLoading,
  setError,
}: UseRejectRequestParams) {
  const rejectRequestOnce = useCallback(async (requestId: string | number) => {
    try {
      // Show quick-refresh indicator for requests
      setIsLoading((prev) => ({ ...prev, requests: true }))

      // Resolve context BEFORE the delete -- once removed from the DB there's
      // nothing left to look up.
      const request = bountyRequests.find((req) => String(req.id) === String(requestId))
      const hunterId = (request as any)?.hunter_id || (request as any)?.user_id

      // Delete the request entirely (user asked rejected requests be deleted)
      const deleted = await bountyRequestService.delete(requestId)

      if (!deleted) {
        throw new Error("Failed to delete rejected request")
      }

      // Update local state - remove the rejected request from the list
      setBountyRequests((prev) => prev.filter((req) => String(req.id) !== String(requestId)))

      // No reason-capture UI exists on the decline confirmation (Cancel /
      // Decline only) -- `reason` is intentionally never set here. Add it
      // only once a real reason-picker ships; never infer one.
      try {
        await analyticsService.trackEvent('application_declined', {
          bountyId: request?.bounty_id ? String(request.bounty_id) : undefined,
          hunterId: hunterId ? String(hunterId) : undefined,
          // Joins to application_viewed / application_dismissed /
          // accept_blocked_by_payment / application_accepted (added 2026-11-05).
          application_id: String(requestId),
          trustTier: (request?.bounty as any)?.trust_tier || 'standard',
        })
      } catch {
        /* analytics is best-effort */
      }

      // Show confirmation with next-step guidance
      const nextSteps = `\n\nNext steps:\n• Review your other applicants in My Bounties, or edit the posting from there.`
      Alert.alert('Request Rejected', `The request has been rejected and removed.${nextSteps}`, [{ text: 'OK' }])
    } catch (err: any) {
      console.error("Error rejecting request:", err)
      setError(err.message || "Failed to reject request")
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false }))
    }
  }, [bountyRequests, setBountyRequests, setIsLoading, setError])

  // One decline at a time: a second confirmation tapped while the first is
  // deleting joins it, rather than deleting an already-deleted request and
  // surfacing "Failed to reject request" for a decline that worked.
  const rejectFlight = useSingleFlight()
  const handleRejectRequest = useCallback(
    (requestId: string | number) => rejectFlight.run(() => rejectRequestOnce(requestId)),
    [rejectFlight, rejectRequestOnce]
  )

  return { handleRejectRequest }
}
