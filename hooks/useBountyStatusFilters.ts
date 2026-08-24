/**
 * Status-filter logic shared by the Work / Posts screens (inbox-screen, and the
 * preserved postings-screen).
 *
 * A bounty's `status` column is not what its card displays: the badge also
 * depends on the viewer's role, on their own application, and on whether work
 * has been submitted for review. Filtering on `bounty.status` alone is what put
 * REJECTED and SUBMITTED FOR REVIEW cards under the "In Progress" chip and plain
 * IN PROGRESS cards under "Review". Everything here resolves the *displayed*
 * status via getBountyDisplayStatus so the chips and the badges cannot disagree.
 *
 * It lives in a hook rather than in each screen because the two screens are
 * near-identical clones — duplicating the logic is how they drifted apart.
 */
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import type { CompletionSubmission } from 'lib/services/completion-service'
import { completionService } from 'lib/services/completion-service'
import type { Bounty } from 'lib/services/database.types'
import { supabase } from 'lib/supabase'
import type { BountyDisplayStatus } from 'lib/utils/bounty-display-status'
import { getBountyDisplayStatus } from 'lib/utils/bounty-display-status'
import * as React from 'react'
import { useEffect, useState } from 'react'

export type InProgressStatusFilter = 'all' | 'applied' | 'in_progress' | 'review' | 'completed'
export type MyPostingsStatusFilter = 'all' | 'review' | 'open' | 'in_progress' | 'completed'

/** Each chip (other than 'all') selects exactly one badge a card can render. */
export const IN_PROGRESS_FILTER_STATUS: Record<
  Exclude<InProgressStatusFilter, 'all'>,
  BountyDisplayStatus
> = {
  applied: 'applied',
  in_progress: 'in_progress',
  review: 'submitted_for_review',
  completed: 'completed',
}

export const MY_POSTINGS_FILTER_STATUS: Record<
  Exclude<MyPostingsStatusFilter, 'all'>,
  BountyDisplayStatus
> = {
  review: 'review_needed',
  open: 'open',
  in_progress: 'in_progress',
  completed: 'completed',
}

export const IN_PROGRESS_FILTER_LABELS: Record<InProgressStatusFilter, string> = {
  all: 'All',
  applied: 'Applied',
  in_progress: 'In Progress',
  review: 'Review',
  completed: 'Completed',
}

export const MY_POSTINGS_FILTER_LABELS: Record<MyPostingsStatusFilter, string> = {
  all: 'All',
  review: 'Review',
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
}

/** Chip display order — follows each tab's workflow, ending on "Review". */
export const IN_PROGRESS_FILTERS: readonly InProgressStatusFilter[] = [
  'all',
  'applied',
  'in_progress',
  'review',
  'completed',
] as const

export const MY_POSTINGS_FILTERS: readonly MyPostingsStatusFilter[] = [
  'all',
  'open',
  'in_progress',
  'review',
  'completed',
] as const

interface UseBountyStatusFiltersArgs {
  currentUserId?: string
  /** Bounties the user posted (My Postings / Posts tab). */
  myBounties: Bounty[]
  /** Bounties the user applied to or is working (In Progress / Work tab). */
  inProgressBounties: Bounty[]
  /** The user's own requests, used to resolve applied/rejected badges. */
  hunterRequests: BountyRequestWithDetails[]
  statusFilterInProgress: InProgressStatusFilter
  statusFilterMyPostings: MyPostingsStatusFilter
}

export function useBountyStatusFilters({
  currentUserId,
  myBounties,
  inProgressBounties,
  hunterRequests,
  statusFilterInProgress,
  statusFilterMyPostings,
}: UseBountyStatusFiltersArgs) {
  // Latest completion submission per in-progress bounty across both lists. The
  // badge for in-progress work depends on it ("SUBMITTED FOR REVIEW" for the
  // hunter, "REVIEW NEEDED" for the poster), so the chips need it too.
  const [submissionsByBounty, setSubmissionsByBounty] = useState<Map<string, CompletionSubmission>>(
    () => new Map()
  )

  // Sorted+joined so the effect re-runs only when the actual set changes.
  const submissionBountyIdsKey = React.useMemo(() => {
    const ids = new Set<string>()
    for (const b of myBounties) if (b.status === 'in_progress') ids.add(String(b.id))
    for (const b of inProgressBounties) if (b.status === 'in_progress') ids.add(String(b.id))
    return Array.from(ids).sort().join(',')
  }, [myBounties, inProgressBounties])

  useEffect(() => {
    const ids = submissionBountyIdsKey ? submissionBountyIdsKey.split(',') : []
    if (ids.length === 0) {
      setSubmissionsByBounty((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }

    let cancelled = false
    const load = async () => {
      const latest = await completionService.getLatestSubmissionsForBounties(ids)
      if (!cancelled) setSubmissionsByBounty(latest)
    }
    load()

    // A submission can land (or be reviewed) while the screen is open. Each card
    // subscribes for its own badge; without this list-level subscription the chip
    // that selected the card would keep filtering on stale submission state.
    let channel: any = null
    try {
      channel = supabase
        .channel(`bounty-status-filters:${currentUserId ?? 'anon'}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'completion_submissions',
            filter: `bounty_id=in.(${ids.join(',')})`,
          },
          () => {
            load()
          }
        )
        .subscribe()
    } catch {
      // Realtime unavailable — state still refreshes on pull-to-refresh.
      channel = null
    }

    return () => {
      cancelled = true
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch {
          // best-effort cleanup
        }
      }
    }
  }, [submissionBountyIdsKey, currentUserId])

  // Map of bountyId -> this user's own request status for that bounty.
  const requestStatusMap = React.useMemo(() => {
    const m = new Map<string, string>()
    hunterRequests.forEach((r) => {
      const bId = r?.bounty?.id ?? r?.bounty_id
      if (bId !== undefined && bId !== null) m.set(String(bId), r.status)
    })
    return m
  }, [hunterRequests])

  /**
   * The status a bounty's card actually displays, resolved exactly the way
   * BountyCard resolves it.
   */
  const getDisplayStatus = React.useCallback(
    (b: Bounty, variant: 'owner' | 'hunter'): BountyDisplayStatus => {
      const submission = submissionsByBounty.get(String(b.id))
      const hasPendingSubmission = b.status === 'in_progress' && submission?.status === 'pending'
      return getBountyDisplayStatus({
        bounty: b,
        // Poster side: a hunter's work is waiting on this user's review.
        reviewNeeded: variant === 'owner' && hasPendingSubmission,
        // Hunter side: only *this* hunter's own submission counts — a bounty
        // someone else is delivering must not read as submitted for review.
        submittedForReview:
          variant === 'hunter' &&
          hasPendingSubmission &&
          !!currentUserId &&
          String(submission?.hunter_id) === String(currentUserId),
        // The poster has no application of their own on their bounty.
        requestStatus: variant === 'hunter' ? requestStatusMap.get(String(b.id)) ?? null : null,
      })
    },
    [submissionsByBounty, requestStatusMap, currentUserId]
  )

  // Predicates for the "Review" chips — centralized so the chip count, the
  // accessibility label, and the list filter all stay in lockstep.
  const needsHunterReview = React.useCallback(
    (b: Bounty) => getDisplayStatus(b, 'hunter') === 'submitted_for_review',
    [getDisplayStatus]
  )
  const needsPosterReview = React.useCallback(
    (b: Bounty) => getDisplayStatus(b, 'owner') === 'review_needed',
    [getDisplayStatus]
  )

  const displayedInProgress = React.useMemo(() => {
    if (statusFilterInProgress === 'all') return inProgressBounties
    const target = IN_PROGRESS_FILTER_STATUS[statusFilterInProgress]
    return inProgressBounties.filter((b) => getDisplayStatus(b, 'hunter') === target)
  }, [inProgressBounties, statusFilterInProgress, getDisplayStatus])

  const displayedMyPostings = React.useMemo(() => {
    if (statusFilterMyPostings === 'all') return myBounties
    const target = MY_POSTINGS_FILTER_STATUS[statusFilterMyPostings]
    return myBounties.filter((b) => getDisplayStatus(b, 'owner') === target)
  }, [myBounties, statusFilterMyPostings, getDisplayStatus])

  // Drives the "Review" chip badge on the Work tab (and that tab's badge).
  const inProgressReviewCount = React.useMemo(
    () => inProgressBounties.filter(needsHunterReview).length,
    [inProgressBounties, needsHunterReview]
  )

  // Postings where a hunter submitted work awaiting this poster's review.
  // Pending applications are counted separately by the Requests tab badge.
  const myPostingsReviewCount = React.useMemo(
    () => myBounties.filter(needsPosterReview).length,
    [myBounties, needsPosterReview]
  )

  return {
    getDisplayStatus,
    displayedInProgress,
    displayedMyPostings,
    inProgressReviewCount,
    myPostingsReviewCount,
  }
}
