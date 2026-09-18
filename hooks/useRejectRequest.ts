import { useCallback } from 'react'
import { Alert } from 'react-native'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { analyticsService } from 'lib/services/analytics-service'

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
  const handleRejectRequest = useCallback(async (requestId: string | number) => {
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
          trustTier: (request?.bounty as any)?.trust_tier || 'standard',
        })
      } catch {
        /* analytics is best-effort */
      }

      // Show confirmation with next-step guidance
      const nextSteps = `\n\nNext steps:\n• Review other applicants in Requests or go to My Postings to edit the posting.`
      Alert.alert('Request Rejected', `The request has been rejected and removed.${nextSteps}`, [{ text: 'OK' }])
    } catch (err: any) {
      console.error("Error rejecting request:", err)
      setError(err.message || "Failed to reject request")
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false }))
    }
  }, [bountyRequests, setBountyRequests, setIsLoading, setError])

  return { handleRejectRequest }
}
