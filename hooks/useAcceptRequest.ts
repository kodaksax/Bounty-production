import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { bountyService } from 'lib/services/bounty-service'
import type { Bounty } from 'lib/services/database.types'
import { messageService } from 'lib/services/message-service'
import { analyticsService } from 'lib/services/analytics-service'
import { amountBucket } from 'lib/services/bounty-funding-service'
import { logClientError, logClientInfo } from 'lib/services/monitoring'
import { navigationIntent } from 'lib/services/navigation-intent'
import { sendMessage as sendSupabaseMessage } from 'lib/services/supabase-messaging'
import { supabase } from 'lib/supabase'
import { router } from 'expo-router'
import { useCallback } from 'react'
import { Alert } from 'react-native'

interface UseAcceptRequestParams {
  currentUserId?: string
  bountyRequests: BountyRequestWithDetails[]
  myBounties: Bounty[]
  setBountyRequests: React.Dispatch<React.SetStateAction<BountyRequestWithDetails[]>>
  setMyBounties: React.Dispatch<React.SetStateAction<Bounty[]>>
  setInProgressBounties: React.Dispatch<React.SetStateAction<Bounty[]>>
  setIsLoading: React.Dispatch<React.SetStateAction<{ myBounties: boolean; inProgress: boolean; requests: boolean }>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  loadMyBounties: () => Promise<void>
  loadInProgress: () => Promise<void>
  loadRequestsForMyBounties: (bounties: Bounty[]) => Promise<void>
  onBountyAccepted?: (bountyId?: string | number) => void
  setActiveScreen: (screen: string) => void
  /**
   * Pay-at-accept gate, from hooks/useAcceptFunding. Resolves `true` once the
   * poster has agreed to the charge and has the balance to cover it.
   *
   * Optional so existing call sites keep compiling, but every real screen
   * passes it. When it is absent this hook simply attempts the acceptance —
   * which is safe, because an unfunded bounty is rejected by the DB trigger
   * rather than by this hook. Omitting it costs UX, never integrity.
   */
  ensureFunded?: (bountyId: string | number, context?: { hunterName?: string; variant?: string }) => Promise<boolean>
  /**
   * Pulls the authoritative wallet balance from the server. Called immediately
   * after a successful pay-at-accept acceptance, because that transaction is
   * what debits the poster and no local state knows about it yet.
   *
   * Optional for the same reason as `ensureFunded`: omitting it costs only the
   * freshness of a displayed number, never correctness.
   */
  refreshWallet?: () => Promise<void>
  /** Returns `true` when the poster fixed the problem and we should retry once. */
  handleAcceptFailure?: (
    error: unknown,
    bountyId: string | number,
    context?: { hunterName?: string; variant?: string }
  ) => Promise<boolean>
}

export function useAcceptRequest({
  currentUserId,
  bountyRequests,
  myBounties,
  setBountyRequests,
  setMyBounties,
  setInProgressBounties,
  setIsLoading,
  setError,
  loadMyBounties,
  loadInProgress,
  loadRequestsForMyBounties,
  onBountyAccepted,
  setActiveScreen,
  ensureFunded,
  refreshWallet,
  handleAcceptFailure,
}: UseAcceptRequestParams) {
  const handleAcceptRequest = useCallback(async (requestId: string | number) => {
    // Track the conversation id created during this accept flow so
    // the alert action can re-assert the intent when the user taps "View Conversation".
    let pendingConvId: string | null = null
    let messagingSetupError: string | null = null
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

      // --- Pay-at-accept gate ------------------------------------------------
      // Runs BEFORE any optimistic UI. Everything below this point tells the
      // poster (and, via the lists, potentially the hunter) that the bounty is
      // in progress — so it must not run while a payment sheet is still open,
      // and must not run at all if the poster backs out.
      //
      // For a legacy 'at_post' bounty this resolves true immediately without
      // rendering anything: the money was taken when the bounty was posted, so
      // there is nothing to confirm. Existing posters see no change.
      const wasDeferredFunding = (request.bounty as any)?.funding_mode === 'at_accept'
      const fundingContext = {
        hunterName: request.profile?.username || undefined,
        variant: wasDeferredFunding ? 'deferred' : 'control',
      }
      if (ensureFunded && resolvedBountyId != null) {
        const funded = await ensureFunded(resolvedBountyId, fundingContext)
        if (!funded) {
          // Poster declined or backed out. Nothing was charged and nobody was
          // assigned; leave every list exactly as it was.
          setIsLoading((prev) => ({ ...prev, requests: false, myBounties: false, inProgress: false }))
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
        const baseBounty = (request.bounty as Bounty) ?? ({ id: resolvedBountyId, title: (request.bounty as any)?.title || '' } as unknown as Bounty)
        // Always override status to 'in_progress' — the embedded bounty object may still have 'open'
        const newBounty = { ...baseBounty, status: 'in_progress' as const, accepted_by: hunterIdForConv }
        setInProgressBounties((prev) => {
          if (resolvedBountyId != null && prev.some(pb => String(pb.id) === String(resolvedBountyId))) return prev
          return [newBounty, ...prev]
        })
      }

      // The server performs acceptance and escrow reservation in a SINGLE
      // transaction (fn_accept_bounty_request -> fn_reserve_escrow_for_acceptance),
      // so there is no partial outcome to unwind here: either the hunter is
      // accepted AND the money is escrowed, or neither happened.
      let result: any = null
      try {
        result = await bountyRequestService.acceptRequest(requestId)
      } catch (acceptErr: any) {
        // A funding failure is recoverable in place — reopen the gate at the
        // shortfall summary, and retry exactly once if the poster resolves it.
        // Bounded to one retry on purpose: an unbounded loop against a server
        // that keeps rejecting would hammer the money path.
        let recovered = false
        if (handleAcceptFailure && resolvedBountyId != null) {
          try {
            recovered = await handleAcceptFailure(acceptErr, resolvedBountyId, fundingContext)
          } catch (gateErr) {
            logClientError('Accept funding recovery gate failed', { err: gateErr, requestId })
          }
        }

        if (recovered) {
          try {
            result = await bountyRequestService.acceptRequest(requestId)
          } catch (retryErr) {
            console.error('Accept request retry failed for', requestId, retryErr)
            result = null
          }
        }

        if (!result) {
          // handleAcceptFailure has already shown the reason (and emitted
          // accept_funding_failed); only fall back to the generic alerts when
          // no gate was wired in, so the poster never sees two dialogs.
          const status = (acceptErr && (acceptErr as any).status) || null
          console.error('Accept request failed for', requestId, acceptErr)
          if (!handleAcceptFailure) {
            if (status === 409) {
              Alert.alert('Conflict', 'This bounty was updated elsewhere. Refresh and try again.')
            } else if (status === 403) {
              Alert.alert('Not authorized', 'You are not allowed to accept this request.')
            } else if (status === 400) {
              Alert.alert('Invalid request', 'The accept request was invalid. Please refresh and try again.')
            } else {
              Alert.alert('Accept Failed', 'Failed to accept the request on the server. The UI may be out of sync; please refresh.')
            }
          }

          // Reload lists to attempt to restore correct state
          await Promise.allSettled([loadMyBounties(), loadInProgress(), loadRequestsForMyBounties(myBounties)])
          return
        }
      }

      // Guard: acceptRequest can return null when the server determines the bounty
      // was already accepted or is no longer in an acceptable state (e.g. the
      // optimistic lock check failed).  Without this guard the code would continue
      // as if the acceptance succeeded, create a spurious conversation, show a
      // false-positive "Request Accepted" alert, and then reload from the DB –
      // which still shows the bounty as 'open'.
      if (!result) {
        Alert.alert('Conflict', 'This bounty was already accepted or is no longer available. Refreshing…')
        await Promise.allSettled([loadMyBounties(), loadInProgress(), loadRequestsForMyBounties(myBounties)])
        return
      }

      // Fetch authoritative bounty object (server performed the transition atomically)
      const bountyId = (request.bounty as any)?.id ?? (request as any)?.bounty_id
      let bountyObj: Bounty | null = (request.bounty as unknown as Bounty) ?? null
      if (!bountyObj && bountyId != null) {
        try {
          const fetched = await bountyService.getById(bountyId)
          if (fetched) bountyObj = fetched
        } catch (fetchErr) {
          console.error('Accept: failed to fetch bounty details', fetchErr)
        }
      }

      // Funnel: track that the bounty was successfully claimed/accepted.
      // Emitted as soon as the server confirms the transition; conversation
      // creation below is best-effort and shouldn't gate the funnel event.
      try {
        await analyticsService.trackEvent('bounty_claimed', {
          bountyId: bountyId != null ? String(bountyId) : undefined,
          requestId: String(requestId),
          hunterId: hunterIdForConv ? String(hunterIdForConv) : undefined,
          isForHonor: !!(request.bounty as any)?.is_for_honor,
          amount: (request.bounty as any)?.amount ?? undefined,
        })
        // Also emit the existing `bounty_accepted` event name so downstream
        // dashboards that already query that name keep working.
        await analyticsService.trackEvent('bounty_accepted', {
          bountyId: bountyId != null ? String(bountyId) : undefined,
          requestId: String(requestId),
        })

        // Deferred bounties only: the server just took the money as part of
        // this same transaction, so success here IS the funding moment.
        // `escrow_funded` is the existing cross-architecture funding event and
        // is reused deliberately — `timing` is what separates the experiment's
        // funding moment from a post-time one.
        if (wasDeferredFunding) {
          const deferredProps = {
            bountyId: bountyId != null ? String(bountyId) : undefined,
            amountBucket: amountBucket(Number((request.bounty as any)?.amount ?? 0)),
            fundingMode: 'at_accept',
            variant: 'deferred',
            firstBounty: true,
            source: 'accept_flow',
          }
          await analyticsService.trackEvent('accept_funding_succeeded', deferredProps)
          await analyticsService.trackEvent('escrow_funded', {
            ...deferredProps,
            architecture: 'v1',
            timing: 'at_accept',
          })
        }

        // Funded AND in progress — the point past which a hunter may legitimately
        // begin work. Emitted for both arms so "posted -> work actually started"
        // is comparable between them.
        await analyticsService.trackEvent('bounty_work_started', {
          bountyId: bountyId != null ? String(bountyId) : undefined,
          fundingMode: wasDeferredFunding ? 'at_accept' : 'at_post',
          variant: wasDeferredFunding ? 'deferred' : 'control',
          isForHonor: !!(request.bounty as any)?.is_for_honor,
          amountBucket: amountBucket(Number((request.bounty as any)?.amount ?? 0)),
        })
      } catch {
        /* analytics is best-effort */
      }

      // Escrow is NOT funded here by the client. For an 'at_post' bounty the
      // money was taken by the fn_reserve_bounty_escrow trigger when the bounty
      // was inserted; for an 'at_accept' bounty it was taken server-side inside
      // the acceptance transaction above. Either way, charging from this hook
      // would double-charge the poster.

      // ...but for an 'at_accept' bounty the poster's balance just changed and
      // nothing on this device knows it yet. Pull the authoritative figure now
      // so the wallet reflects the charge the instant the hunter is selected,
      // rather than whenever the next mount/auth event happens to refresh it.
      //
      // Deliberately a REFRESH and not a local subtraction: profiles.balance is
      // the only source of truth for the ledger figure, and
      // use-wallet-balance-display exists precisely because writing the balance
      // optimistically from ~10 call sites is what let the displayed number
      // drift from the withdrawable one. One extra read is worth not becoming
      // the eleventh writer.
      //
      // The Realtime subscription in wallet-context covers this too, but only
      // where `profiles` is in the supabase_realtime publication and the socket
      // is actually connected. This makes it deterministic instead.
      if (wasDeferredFunding && refreshWallet) {
        try {
          await refreshWallet()
        } catch (refreshErr) {
          // Non-fatal: the acceptance and the charge both already committed.
          // A stale figure self-corrects on the next refresh, and showing a
          // slightly old balance must never fail an acceptance that succeeded.
          logClientError('Wallet refresh after accept failed', {
            err: refreshErr,
            bountyId: bountyId != null ? String(bountyId) : undefined,
          })
        }
      }

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
            pendingConvId = String(convId)
            try { await navigationIntent.setPendingConversationId(pendingConvId) } catch { }
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

          pendingConvId = localConv.id
          try { await navigationIntent.setPendingConversationId(pendingConvId) } catch { /* best-effort */ }
        } catch (fallbackErr) {
          console.error('Fallback to local conversation also failed:', fallbackErr)
          logClientError('Fallback to local conversation failed', { err: fallbackErr })
          messagingSetupError =
            'The hunter was accepted, but we could not set up your conversation. Please retry messaging before coordinating work.'
        }
      }

      // Update local state - remove all requests for this bounty since it's now in progress
      setBountyRequests((prev) => prev.filter(req => String(req.bounty_id) !== String(request.bounty_id)))

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
        // Use the full bounty object if available, but always override status to 'in_progress'
        const baseBounty = (request.bounty as Bounty) ?? ({ id: bountyId, title: (request.bounty as any)?.title || '' } as unknown as Bounty)
        const newBounty = { ...baseBounty, status: 'in_progress' as const, accepted_by: hunterIdForConv }
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

      // Notifications are created server-side as part of the accept transaction
      // via the consolidated-bounty-requests route. Removing client-side POST
      // to avoid duplicate or failed requests.

      // Show escrow instructions if it's a paid bounty
      // Show a confirmation alert with next-step guidance for the poster
      const nextSteps = `\n\nNext steps:\n• Confirm details with your hunter in the conversation.\n• When the work is done, mark the bounty complete and release escrow (for paid bounties).`

      const viewAction = {
        text: 'View Conversation',
        onPress: async () => {
          if (pendingConvId) {
            // Navigate directly to the conversation screen and clear the
            // pending intent so it doesn't re-trigger on the inbox later.
            router.push(`/tabs/messenger/${encodeURIComponent(pendingConvId)}` as any)
            try { await navigationIntent.setPendingConversationId(null) } catch { /* best-effort */ }
          } else {
            // Fallback: open the My Bounties / Inbox tab so the user can find
            // the conversation manually.
            try { setActiveScreen('messages') } catch {}
          }
        }
      }

      const retryMessagingAction = {
        text: 'Retry Messaging Setup',
        onPress: async () => {
          try {
            const conversation = await messageService.getOrCreateConversation(
              [String(hunterIdForConv)],
              request.profile?.username || 'Hunter',
              String(bountyId)
            )
            if (!conversation?.id) throw new Error('No conversation was returned')
            pendingConvId = String(conversation.id)
            await navigationIntent.setPendingConversationId(pendingConvId)
            router.push(`/tabs/messenger/${encodeURIComponent(pendingConvId)}` as any)
          } catch (retryError) {
            console.error('Retrying messaging setup failed:', retryError)
            Alert.alert(
              'Messaging Setup Still Needs Attention',
              'The bounty remains accepted. Please try again from My Bounties when your connection is stable.'
            )
          }
        },
      }

      if (messagingSetupError) {
        Alert.alert(
          'Bounty Accepted - Messaging Setup Needed',
          messagingSetupError,
          [retryMessagingAction, { text: 'Go to My Bounties', onPress: () => setActiveScreen('messages') }]
        )
        return
      }

      if (request.bounty && !request.bounty.is_for_honor && request.bounty.amount > 0) {
        Alert.alert(
          'Request Accepted',
          `You've accepted ${request.profile?.username || 'the hunter'} for "${request.bounty.title}".\n\n💰 Escrow: $${request.bounty.amount.toFixed(2)} has been secured and will be held until completion.\n💬 A conversation has been created to coordinate.${nextSteps}`,
          [viewAction, { text: 'OK' }]
        )
      } else {
        Alert.alert(
          'Request Accepted',
          `You've accepted ${request.profile?.username || 'the hunter'} for "${request.bounty.title}".\n\n💬 A conversation has been created to coordinate.${nextSteps}`,
          [viewAction, { text: 'OK' }]
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
    bountyRequests,
    myBounties,
    setBountyRequests,
    setMyBounties,
    setInProgressBounties,
    setIsLoading,
    setError,
    loadMyBounties,
    loadInProgress,
    loadRequestsForMyBounties,
    onBountyAccepted,
    setActiveScreen,
    ensureFunded,
    refreshWallet,
    handleAcceptFailure,
  ])

  return { handleAcceptRequest }
}
