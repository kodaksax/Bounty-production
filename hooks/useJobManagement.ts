/**
 * Managing jobs from My Jobs: edit, take down, remove a cancelled job,
 * archive a finished one, hide finished work, and withdraw or remove offers.
 *
 * The handlers moved here from the old Inbox (app/tabs/inbox-screen.tsx) with
 * their safety rails intact:
 *   - edits re-check for new offers before saving, update optimistically and
 *     roll back on failure, and hand the server's reason back to the modal;
 *   - taking a job down refunds FIRST and aborts if the refund fails, and a
 *     per-bounty guard stops a double tap from refunding twice;
 *   - withdrawing reloads from the source instead of filtering optimistically.
 * Dialog copy follows the My Jobs voice. Which actions a job offers is decided
 * by lib/my-jobs/manage-actions; this hook only runs them.
 */
import * as React from 'react'
import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import { discardApplication, withdrawApplication } from 'lib/services/application-withdrawal'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { bountyService } from 'lib/services/bounty-service'
import type { Bounty } from 'lib/services/database.types'
import { markBountyRemovedLocally } from 'lib/utils/bounty-visibility'
import { useConfirmDialog, withdrawOfferCopy } from '../components/poster/confirm-dialog'
import type { ManageAction } from '../lib/my-jobs/manage-actions'
import { describeTakeDown, readOpenJobMoney } from '../lib/my-jobs/take-down'
import type { MyJob, MyOffer } from '../lib/my-jobs/types'
import { saveStructuredBountyEdit } from '../lib/services/bounty-requirements-service'
import { BountyRefundFailedError, cancelAndRefundBounty } from '../lib/services/bounty-cancel-refund'
import { describeBountyUpdateError, toBountyUpdateError } from '../lib/services/bounty-update-error'
import { showToast } from '../lib/toast'
import { getUserFriendlyError } from '../lib/utils/error-messages'
import { useWallet } from '../lib/wallet-context'
import type { MyJobsData } from './useMyJobsData'

/** Analytics surface for offer withdrawals and discards made from this tab. */
const SURFACE = 'inbox' as const

type Deps = Pick<
  MyJobsData,
  'setMyBounties' | 'reloadPosted' | 'reloadOffers' | 'hideForHunter' | 'markHiddenLocally' | 'setError'
> & { userId: string | undefined }

export function useJobManagement(deps: Deps) {
  const { userId, setMyBounties, reloadPosted, reloadOffers, hideForHunter, markHiddenLocally, setError } = deps
  const { refundEscrow } = useWallet()
  const { ask, dialog: confirmDialog } = useConfirmDialog()
  const [editingBounty, setEditingBounty] = useState<Bounty | null>(null)
  // Bounty ids with a take-down (refund + delete) in flight.
  const takingDownRef = useRef<Set<string>>(new Set())

  // ── Edit ────────────────────────────────────────────────────────────────
  const closeEdit = React.useCallback(() => setEditingBounty(null), [])

  const handleSaveEdit = React.useCallback(
    async (updates: Partial<Bounty>) => {
      const editing = editingBounty
      if (!editing) throw new Error('No posting selected')

      if (updates.requirements_payload !== undefined) {
        const updated = await saveStructuredBountyEdit(editing.id, updates)
        setMyBounties((prev) => prev.map((b) => (b.id === editing.id ? updated : b)))
        setEditingBounty(null)
        return
      }

      // Someone may have offered while the poster was editing: terms lock then.
      try {
        const pending = await bountyRequestService.getAll({ bountyId: editing.id, status: 'pending' })
        if (pending && pending.length > 0) {
          Alert.alert(
            'Details are locked',
            'Someone offered to do this job while you were editing, so its details can no longer change.'
          )
          return
        }
      } catch (checkErr) {
        // Can't verify: block the update to be safe.
        console.error('Failed to re-check offers before saving an edit:', checkErr)
        Alert.alert(
          "Couldn't save your changes",
          "We couldn't check whether anyone offered while you were editing. Check your connection and try again."
        )
        return
      }

      setMyBounties((prev) => prev.map((b) => (b.id === editing.id ? { ...editing, ...updates } : b)))
      try {
        const updated = await bountyService.update(editing.id, updates)
        if (!updated) throw new Error('Failed to update bounty')
        setMyBounties((prev) => prev.map((b) => (b.id === editing.id ? updated : b)))
        setEditingBounty(null)
      } catch (err) {
        setMyBounties((prev) => prev.map((b) => (b.id === editing.id ? editing : b)))
        try {
          const pendingAfter = await bountyRequestService.getAll({ bountyId: editing.id, status: 'pending' })
          if (pendingAfter && pendingAfter.length > 0) {
            Alert.alert(
              'Details are locked',
              'Someone offered to do this job while you were saving. Your changes were not saved.'
            )
            return
          }
        } catch (checkErr) {
          console.error('Failed to re-check offers after a failed edit:', checkErr)
        }
        console.error('Error saving job edit:', err)
        // Shown inline in the edit modal, with the poster's edits intact.
        throw toBountyUpdateError(err)
      }
    },
    [editingBounty, setMyBounties]
  )

  // ── Posted-job actions ──────────────────────────────────────────────────
  const takeDown = React.useCallback(
    async (bounty: Bounty) => {
      const key = String(bounty.id)
      if (takingDownRef.current.has(key)) return
      takingDownRef.current.add(key)
      // Read what's held first, so the dialog tells the truth for this job and
      // the take-down acts on that same plan (J.4).
      let money: Awaited<ReturnType<typeof readOpenJobMoney>>
      try {
        money = await readOpenJobMoney(bounty)
      } catch {
        Alert.alert(
          "Can't take this job down right now",
          "We couldn't check what's been paid for this job, so nothing was changed. Check your connection and try again."
        )
        return
      } finally {
        takingDownRef.current.delete(key)
      }
      ask({
        ...describeTakeDown(bounty, money.plan, money.charge),
        onConfirm: async () => {
          if (takingDownRef.current.has(key)) return
          takingDownRef.current.add(key)
          try {
            // Refund FIRST (when anything is held), then delete — the one
            // path shared with the job screen's "Cancel and refund".
            try {
              await cancelAndRefundBounty(bounty, { refundEscrow }, money.plan)
            } catch (cancelError) {
              if (cancelError instanceof BountyRefundFailedError) {
                Alert.alert(
                  'Refund failed',
                  "We couldn't refund the money held for this job, so it wasn't taken down. Please contact support."
                )
                return
              }
              throw cancelError
            }
            markBountyRemovedLocally(bounty.id)
            setMyBounties((prev) => prev.filter((b) => b.id !== bounty.id))
            await reloadPosted()
          } catch (err) {
            const friendly = getUserFriendlyError(err)
            setError(friendly.message)
            Alert.alert(friendly.title, friendly.message)
          } finally {
            takingDownRef.current.delete(key)
          }
        },
      })
    },
    [refundEscrow, setMyBounties, reloadPosted, setError, ask]
  )

  const discardCancelled = React.useCallback(
    (bounty: Bounty) => {
      Alert.alert(
        'Remove this cancelled job?',
        "It leaves My Jobs. You'll still find it in your history.",
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                const updated = await bountyService.update(bounty.id, { status: 'deleted' })
                if (!updated) throw new Error('Failed to discard bounty')
                markBountyRemovedLocally(bounty.id)
                setMyBounties((prev) => prev.filter((b) => b.id !== bounty.id))
                await reloadPosted()
              } catch (err) {
                Alert.alert('Something went wrong', describeBountyUpdateError(err))
              }
            },
          },
        ],
        { cancelable: true }
      )
    },
    [setMyBounties, reloadPosted]
  )

  const archive = React.useCallback(
    (bounty: Bounty) => {
      Alert.alert('Archive this job?', "It leaves My Jobs. You'll still find it in your history.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            try {
              const updated = await bountyService.update(String(bounty.id), { status: 'archived' })
              if (!updated) throw new Error('Failed to archive bounty')
              await reloadPosted()
            } catch (err) {
              console.error('Error archiving job:', err)
              Alert.alert('Something went wrong', describeBountyUpdateError(err))
            }
          },
        },
      ])
    },
    [reloadPosted]
  )

  const hideFinished = React.useCallback(
    async (bounty: Bounty) => {
      try {
        await hideForHunter(bounty.id)
      } catch {
        Alert.alert("Couldn't remove this job", 'Please try again.')
      }
    },
    [hideForHunter]
  )

  /** Runs a manage action chosen from "Other options" or the switcher's ⋯ menu. */
  const runJobAction = React.useCallback(
    (action: ManageAction, job: MyJob) => {
      if (action.disabledReason) {
        Alert.alert('Details are locked', action.disabledReason)
        return
      }
      switch (action.key) {
        case 'edit':
          setEditingBounty(job.bounty)
          return
        case 'take_down':
          void takeDown(job.bounty)
          return
        case 'discard_cancelled':
          discardCancelled(job.bounty)
          return
        case 'archive':
          archive(job.bounty)
          return
        case 'hide':
          void hideFinished(job.bounty)
          return
      }
    },
    [takeDown, discardCancelled, archive, hideFinished]
  )

  // ── Offers ──────────────────────────────────────────────────────────────
  const withdrawOffer = React.useCallback(
    (offer: MyOffer) => {
      ask({
        ...withdrawOfferCopy(offer.posterName?.split(/\s+/)[0] ?? null),
        onConfirm: async () => {
          try {
            // Deletes the pending request and emits application_withdrawn
            // only on a confirmed success (lib/services/application-withdrawal).
            await withdrawApplication({ bountyId: offer.bountyId, currentUserId: userId, surface: SURFACE })
            try {
              // Reload so the row only disappears once it's really gone.
              await reloadOffers()
            } catch (refreshError) {
              console.warn('Failed to refresh offers after withdrawal:', refreshError)
            }
            showToast({ message: 'Your offer has been withdrawn.' })
          } catch (err) {
            console.error('Error withdrawing offer:', err)
            const friendly = getUserFriendlyError(err)
            Alert.alert(friendly.title, friendly.message)
          }
        },
      })
    },
    [userId, reloadOffers, ask]
  )

  /**
   * Clears a closed offer from the list. A rejected application goes through
   * discardApplication (which records the hide and the analytics event); an
   * offer that closed because someone else was chosen is still `pending` on
   * the server, which discardApplication refuses, so it is hidden directly.
   */
  const removeOffer = React.useCallback(
    (offer: MyOffer) => {
      Alert.alert('Remove from your list?', "You won't see this job in Your offers any more.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              if (offer.request.status === 'rejected') {
                await discardApplication({ bountyId: offer.bountyId, currentUserId: userId, surface: SURFACE })
                markHiddenLocally(offer.bountyId)
              } else {
                await hideForHunter(offer.bountyId)
              }
            } catch (err) {
              console.error('Error removing offer:', err)
              const friendly = getUserFriendlyError(err)
              Alert.alert(friendly.title, friendly.message)
            }
          },
        },
      ])
    },
    [userId, markHiddenLocally, hideForHunter]
  )

  return {
    runJobAction,
    withdrawOffer,
    removeOffer,
    confirmDialog,
    edit: { bounty: editingBounty, close: closeEdit, save: handleSaveEdit },
  }
}
