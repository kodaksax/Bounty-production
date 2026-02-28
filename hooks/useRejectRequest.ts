import { useCallback } from 'react'
import { Alert } from 'react-native'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { bountyRequestService } from 'lib/services/bounty-request-service'

interface UseRejectRequestParams {
  setBountyRequests: React.Dispatch<React.SetStateAction<BountyRequestWithDetails[]>>
  setIsLoading: React.Dispatch<React.SetStateAction<{ myBounties: boolean; inProgress: boolean; requests: boolean }>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useRejectRequest({
  setBountyRequests,
  setIsLoading,
  setError,
}: UseRejectRequestParams) {
  const handleRejectRequest = useCallback(async (requestId: string | number) => {
    try {
      // Show quick-refresh indicator for requests
      setIsLoading((prev) => ({ ...prev, requests: true }))

      // Delete the request entirely (user asked rejected requests be deleted)
      const deleted = await bountyRequestService.delete(requestId)

      if (!deleted) {
        throw new Error("Failed to delete rejected request")
      }

      // Update local state - remove the rejected request from the list
      setBountyRequests((prev) => prev.filter((req) => String(req.id) !== String(requestId)))

      // Show confirmation toast
      Alert.alert('Request Rejected', 'The request has been rejected and removed.', [{ text: 'OK' }])
    } catch (err: any) {
      console.error("Error rejecting request:", err)
      setError(err.message || "Failed to reject request")
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false }))
    }
  }, [setBountyRequests, setIsLoading, setError])

  return { handleRejectRequest }
}
