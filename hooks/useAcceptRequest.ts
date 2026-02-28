import { useCallback } from 'react'
import { Alert } from 'react-native'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { bountyService } from 'lib/services/bounty-service'
import type { Bounty } from 'lib/services/database.types'
import { navigationIntent } from 'lib/services/navigation-intent'
import { logClientError, logClientInfo } from 'lib/services/monitoring'
import { supabase } from 'lib/supabase'
import { sendMessage as sendSupabaseMessage } from 'lib/services/supabase-messaging'
import { messageService } from 'lib/services/message-service'

interface UseAcceptRequestParams {
  currentUserId?: string
  balance: number
  bountyRequests: BountyRequestWithDetails[]
  myBounties: Bounty[]
  setBountyRequests: React.Dispatch<React.SetStateAction<BountyRequestWithDetails[]>>
  setMyBounties: React.Dispatch<React.SetStateAction<Bounty[]>>
  setInProgressBounties: React.Dispatch<React.SetStateAction<Bounty[]>>
  setIsLoading: React.Dispatch<React.SetStateAction<{ myBounties: boolean; inProgress: boolean; requests: boolean }>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setShowAddMoney: (show: boolean) => void
  loadMyBounties: () => Promise<void>
  loadInProgress: () => Promise<void>
  loadRequestsForMyBounties: (bounties: Bounty[]) => Promise<void>
  onBountyAccepted?: (bountyId?: string | number) => void
  setActiveScreen: (screen: string) => void
}

export function useAcceptRequest({
  currentUserId,
  balance,
  bountyRequests,
  myBounties,
  setBountyRequests,
  setMyBounties,
  setInProgressBounties,
  setIsLoading,
  setError,
  setShowAddMoney,
  loadMyBounties,
  loadInProgress,
  loadRequestsForMyBounties,
  onBountyAccepted,
  setActiveScreen,
}: UseAcceptRequestParams) {
  const handleAcceptRequest = useCallback(async (requestId: string | number) => {
    try {
      // Show quick-refresh UI for list transitions
      setIsLoading((prev) => ({ ...prev, requests: true, myBounties: true, inProgress: true }))

      // Find the request to get bounty and profile info
      const request = bountyRequests.find(req => String(req.id) === String(requestId))
      if (!request) {
        throw new Error("Request not found")
      }

      // Prepare identifiers and hunter id
      const hunterIdForConv = (request as any).hunter_id || (request as any).user_id
      const resolvedBountyId = (request.bounty as any)?.id ?? (request as any)?.bounty_id

      // Check balance before any optimistic UI updates so the UI stays consistent if we bail early
      if (request.bounty && !request.bounty.is_for_honor && request.bounty.amount > 0) {
        if (balance < request.bounty.amount) {
          Alert.alert(
            'Insufficient Balance',
            `You need $${request.bounty.amount.toFixed(2)} to accept this request. Your current balance is $${balance.toFixed(2)}.\n\nWould you like to add money to your wallet?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Add Money', onPress: () => setShowAddMoney(true) }
            ]
          )
          return
        }
      }

      // Optimistically remove all requests for this bounty so UI moves immediately
      if (resolvedBountyId != null) {
        setBountyRequests((prev) => prev.filter(req => String(req.bounty_id) !== String(resolvedBountyId)))
      } else {
        // If we don't know bounty id, at least remove the single request
        setBountyRequests((prev) => prev.filter(req => String(req.id) !== String(requestId)))
      }

      // Optimistically update My Postings to in_progress
      setMyBounties((prev) =>
        prev.map((b) =>
          String(b.id) === String(resolvedBountyId)
            ? { ...b, status: 'in_progress' as const, accepted_by: hunterIdForConv }
            : b
        )
      )

      // If current user is the accepted hunter, optimistically add to In Progress list
      if (String(hunterIdForConv) === String(currentUserId)) {
        const newBounty = (request.bounty as Bounty) ?? ({ id: resolvedBountyId, title: (request.bounty as any)?.title || '', status: 'in_progress' } as unknown as Bounty)
        setInProgressBounties((prev) => {
          if (resolvedBountyId != null && prev.some(pb => String(pb.id) === String(resolvedBountyId))) return prev
          return [newBounty, ...prev]
        })
      }

      // ANNOTATION: This API call should be transactional on your backend.
      const result = await bountyRequestService.acceptRequest(requestId)

      if (!result) {
        // If accept failed server-side, inform the user and reload lists to reflect server state
        console.error('Accept request failed for', requestId)
        Alert.alert('Accept Failed', 'Failed to accept the request on the server. The UI may be out of sync; please refresh.')
        // Reload lists to attempt to restore correct state
        await Promise.allSettled([loadMyBounties(), loadInProgress(), loadRequestsForMyBounties(myBounties)])
        return
      }

      // Update bounty status to in_progress and set accepted_by
      // Prefer the full bounty object id, but fall back to the canonical bounty_id
      const bountyId = (request.bounty as any)?.id ?? (request as any)?.bounty_id

      // If we don't have the full bounty object available on the request, fetch it
      let bountyObj: Bounty | null = (request.bounty as unknown as Bounty) ?? null
      if (!bountyObj && bountyId != null) {
        try {
          const fetched = await bountyService.getById(bountyId)
          if (fetched) bountyObj = fetched
        } catch (fetchErr) {
          console.error('Accept: failed to fetch bounty details', fetchErr)
          // continue: we still attempt update using bountyId, and skip escrow if bounty data missing
        }
      }
      if (bountyId != null) {
        try {
          const updated = await bountyService.updateStatus(bountyId, 'in_progress')
          if (!updated) {
            console.error('bountyService.updateStatus returned null for', bountyId)
            // Diagnostic: fetch server bounty and log its current state
            try {
              await bountyService.getById(bountyId)
              Alert.alert('Server update failed', `Failed to update bounty ${String(bountyId)}.`)
            } catch (srvErr) {
              console.error('Diagnostic: failed to fetch server bounty after update failure', srvErr)
              Alert.alert('Server update failed', `Failed to update bounty ${String(bountyId)} and failed to fetch server state.`)
            }
          }
        } catch (statusError) {
          console.error('Error updating bounty status:', statusError)
          // Continue with the flow even if status update fails
        }
      }

      // Remove all competing requests for this bounty (cleanup)
      const competingRequests = bountyRequests.filter(
        req => String(req.bounty_id) === String(request.bounty_id) && String(req.id) !== String(requestId)
      )

      if (competingRequests.length > 0) {
        try {
          await Promise.all(
            competingRequests.map(req => bountyRequestService.delete((req.id as any)))
          )
        } catch (cleanupError) {
          console.error('Error cleaning up competing requests:', cleanupError)
          // Continue even if cleanup fails
        }
      }

      // Note: Wallet escrow is created as part of request acceptance, not at bounty posting time.
      // The acceptRequest() flow on the server calls paymentService.createEscrow(...) and updates payment_intent_id.
      // This hook intentionally does NOT create escrow directly; do not add extra escrow creation here to avoid duplicates.

      // Auto-create a conversation for coordination (use bountyId as context)
      try {
        // Use Supabase RPC to create conversation via SECURITY DEFINER function
        // This avoids RLS rejections from client-side inserts.
        try {
          const participantIds = [currentUserId, String(hunterIdForConv)]
          const convName = request.profile?.username || (bountyObj as any)?.title || 'Conversation'
          const { data, error } = await supabase.rpc('rpc_create_conversation', { p_participant_ids: participantIds, p_bounty_id: String(bountyId), p_name: convName })
          if (error) throw error
          const convId = (data as any) ?? null

          if (convId) {
            // send initial message via supabase function or messages table
            try {
              if (currentUserId) {
                await sendSupabaseMessage(convId, `Welcome! You've been selected for: "${(bountyObj as any)?.title || ''}". Let's coordinate the details.`, currentUserId)
              }
            } catch (msgErr) {
              logClientError('Failed to send initial message via supabase messaging', { err: msgErr, convId, bountyId })
            }

            try { await navigationIntent.setPendingConversationId(String(convId)) } catch {}
            logClientInfo('Supabase RPC conversation created', { convId, bountyId })
          }
        } catch (rpcErr: any) {
          // If RPC failed, fallback to local conversation and log error
          logClientError('Error creating conversation via rpc_create_conversation', { error: rpcErr })
          throw rpcErr
        }
      } catch (convError) {
        console.error('Error creating supabase conversation:', convError)
        // If creating the conversation in Supabase fails, fall back to the local persistent layer
        // so the user still has a conversation to coordinate in the app.
        try {
          const localConv = await messageService.getOrCreateConversation(
            [hunterIdForConv],
            request.profile?.username || 'Hunter',
            String(bountyId)
          )

          // Send initial local message (best-effort)
          try {
            await messageService.sendMessage(
              localConv.id,
              `Welcome! You've been selected for: "${(bountyObj as any)?.title || ''}". Let's coordinate the details.`,
              currentUserId
            )
          } catch (localMsgErr) {
            logClientError('Failed to send initial local message', { err: localMsgErr, localConvId: localConv.id })
          }

          try { await navigationIntent.setPendingConversationId(localConv.id) } catch { /* best-effort */ }
        } catch (fallbackErr) {
          console.error('Fallback to local conversation also failed:', fallbackErr)
          logClientError('Fallback to local conversation failed', { err: fallbackErr })
        }
      }

      // Update local state - remove all requests for this bounty since it's now in progress
      setBountyRequests((prev) => prev.filter(req => req.bounty_id !== request.bounty_id))

      // Update bounty in local state (normalize ID comparison using resolved bountyId)
      setMyBounties((prev) =>
        prev.map((b) =>
          String(b.id) === String(bountyId)
            ? { ...b, status: 'in_progress' as const, accepted_by: hunterIdForConv }
            : b
        )
      )

      // If the current user is the accepted hunter, optimistically add the bounty to In Progress list
      if (String(hunterIdForConv) === String(currentUserId)) {
        // If the request includes a full bounty object, use it; otherwise insert a minimal placeholder
        const newBounty = (request.bounty as Bounty) ?? ({ id: bountyId, title: (request.bounty as any)?.title || '', status: 'in_progress' } as unknown as Bounty)
        setInProgressBounties((prev) => {
          if (prev.some(pb => String(pb.id) === String(bountyId))) return prev
          return [newBounty, ...prev]
        })
      }

      // Reload data to ensure consistency across tabs (quick refresh for user)
      await Promise.allSettled([loadMyBounties(), loadInProgress()])

      // Notify parent that a bounty was accepted so higher-level feeds can refresh
      try {
        if (typeof onBountyAccepted === 'function') {
          onBountyAccepted(bountyId ?? request.bounty_id)
        }
      } catch (notifyErr) {
        console.error('Error calling onBountyAccepted callback:', notifyErr)
      }

      // Send notification to hunter about acceptance
      try {
        const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL
        if (!API_BASE) {
          console.error('EXPO_PUBLIC_API_BASE_URL is not set; skipping acceptance notification request.')
        } else {
          const response = await fetch(`${API_BASE}/api/notifications`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              user_id: hunterIdForConv,
              type: 'acceptance',
              title: 'Bounty Application Accepted!',
              body: `Your application for "${bountyObj?.title || (request.bounty as any)?.title || 'the bounty'}" has been accepted!`,
              data: {
                bountyId: bountyId,
                posterId: currentUserId,
                ...((bountyObj?.amount || (request.bounty as any)?.amount) && { amount: (bountyObj?.amount ?? (request.bounty as any)?.amount) }),
              }
            })
          })

          if (!response.ok) {
            let errorText: string | undefined
            try {
              errorText = await response.text()
            } catch {
              // ignore body parsing errors
            }
            console.error(
              'Acceptance notification request failed:',
              response.status,
              response.statusText,
              errorText
            )
          }
        }
      } catch (notifError) {
        console.error('Failed to send acceptance notification:', notifError)
        // Don't block the flow if notification fails
      }

      // Show escrow instructions if it's a paid bounty
      if (request.bounty && !request.bounty.is_for_honor && request.bounty.amount > 0) {
        Alert.alert(
          'Request Accepted',
          `You've accepted ${request.profile?.username || 'the hunter'} for "${request.bounty.title}".\n\n💰 Escrow: $${request.bounty.amount.toFixed(2)} has been secured and will be held until completion.\n💬 A conversation has been created to coordinate.`,
          [
            { text: 'View Conversation', onPress: () => setActiveScreen('create') },
            { text: 'OK' }
          ]
        )
      } else {
        Alert.alert(
          'Request Accepted',
          `You've accepted ${request.profile?.username || 'the hunter'} for "${request.bounty.title}".\n\n💬 A conversation has been created to coordinate.`,
          [
            { text: 'View Conversation', onPress: () => setActiveScreen('create') },
            { text: 'OK' }
          ]
        )
      }
    } catch (err: any) {
      console.error("Error accepting request:", err)
      setError(err.message || "Failed to accept request")
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false, myBounties: false, inProgress: false }))
    }
  }, [
    currentUserId,
    balance,
    bountyRequests,
    myBounties,
    setBountyRequests,
    setMyBounties,
    setInProgressBounties,
    setIsLoading,
    setError,
    setShowAddMoney,
    loadMyBounties,
    loadInProgress,
    loadRequestsForMyBounties,
    onBountyAccepted,
    setActiveScreen,
  ])

  return { handleAcceptRequest }
}
