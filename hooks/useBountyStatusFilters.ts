/**
 * Status-filter logic shared by the Work / Posts screens (inbox-screen, and the
 * preserved postings-screen).
 *
 * A bounty's `status` column is not what its card displays: the badge also
 * depends on the viewer's role, on their own application, and on whether work
 * has been submitted for review. Filtering on `bounty.status` alone is what put
 * REJECTED and SUBMITTED FOR REVIEW cards under the "In Progress" chip and plain
 * IN PROGRESS cards under "Review". Everything here resolves the *displayed*
 * status via resolveBountyLifecycle so the chips and the badges cannot disagree.
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
import type { BountyAttentionGroup, BountyLifecycleState } from 'lib/utils/bounty-lifecycle'
import {
  BOUNTY_ATTENTION_GROUP_LABELS,
  resolveBountyLifecycle,
} from 'lib/utils/bounty-lifecycle'
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
  /**
   * Unreviewed applications per bounty id (poster side). An open posting with
   * applications is the poster's most common "needs attention" state, and it is
   * invisible from the bounty row alone.
   */
  applicationCounts?: Map<string, number>
}

/** One "Needs your attention" / "In progress" / … block in a management list. */
export interface BountySection {
  key: BountyAttentionGroup
  label: string
  data: Bounty[]
}

/** Order the sections are shown in: most urgent first, history last. */
const SECTION_ORDER: BountyAttentionGroup[] = ['attention', 'active', 'waiting', 'past']

export function useBountyStatusFilters({
  currentUserId,
  myBounties,
  inProgressBounties,
  hunterRequests,
  statusFilterInProgress,
  statusFilterMyPostings,
  applicationCounts,
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

  // resolveBountyLifecycle is called for every bounty from several places in
  // one render (the display-status filter, section grouping, the review
  // counts, the attention counts), so without caching the same bounty gets
  // resolved — with its formatting and branching — several times over. The
  // cache is rebuilt only when an input that could change the result changes,
  // and is keyed by (variant, id) since the same bounty resolves differently
  // per role.
  const lifecycleCache = React.useMemo(
    () => new Map<string, BountyLifecycleState>(),
    [submissionsByBounty, requestStatusMap, currentUserId, applicationCounts]
  )

  /**
   * The full lifecycle state for a row — the same resolver the detail screens
   * use, so a card that a list files under "Needs your attention" opens onto a
   * screen that says exactly the same thing.
   */
  const getLifecycle = React.useCallback(
    (b: Bounty, variant: 'owner' | 'hunter'): BountyLifecycleState => {
      const cacheKey = `${variant}:${String(b.id)}`
      const cached = lifecycleCache.get(cacheKey)
      if (cached) return cached

      const submission = submissionsByBounty.get(String(b.id))
      const state = resolveBountyLifecycle({
        bounty: b,
        role: variant === 'owner' ? 'poster' : 'hunter',
        requestStatus: variant === 'hunter' ? requestStatusMap.get(String(b.id)) ?? null : null,
        submissionStatus: submission?.status ?? null,
        submissionIsMine:
          !!currentUserId && !!submission && String(submission.hunter_id) === String(currentUserId),
        applicationCount:
          variant === 'owner' ? applicationCounts?.get(String(b.id)) ?? 0 : 0,
      })
      lifecycleCache.set(cacheKey, state)
      return state
    },
    [lifecycleCache, submissionsByBounty, requestStatusMap, currentUserId, applicationCounts]
  )

  /**
   * The badge a bounty's card shows. Derived from the lifecycle rather than
   * from getBountyDisplayStatus directly, because the lifecycle applies
   * overlays the raw resolver can't see — most importantly that a hunter whose
   * application is still `pending` on an already-claimed bounty was passed
   * over. Resolving them separately is how a chip labelled "In Progress" ended
   * up listing cards that read something else.
   */
  const getDisplayStatus = React.useCallback(
    (b: Bounty, variant: 'owner' | 'hunter'): BountyDisplayStatus =>
      getLifecycle(b, variant).status,
    [getLifecycle]
  )


  /**
   * Splits a list into ordered attention sections. Empty sections are dropped,
   * and a list that resolves to a single section is returned unsectioned — a
   * lone "In progress" header above one card is noise, not structure.
   */
  const buildSections = React.useCallback(
    (list: Bounty[], variant: 'owner' | 'hunter'): BountySection[] => {
      if (list.length === 0) return []
      const buckets = new Map<BountyAttentionGroup, Bounty[]>()
      for (const b of list) {
        const group = getLifecycle(b, variant).group
        const bucket = buckets.get(group)
        if (bucket) bucket.push(b)
        else buckets.set(group, [b])
      }
      const sections = SECTION_ORDER.filter((g) => (buckets.get(g)?.length ?? 0) > 0).map((g) => ({
        key: g,
        label: BOUNTY_ATTENTION_GROUP_LABELS[g],
        data: buckets.get(g)!,
      }))
      return sections.length > 1 ? sections : []
    },
    [getLifecycle]
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

  // Grouping only applies to the unfiltered list: once a chip has narrowed the
  // list to one displayed status, section headers restate the chip.
  const inProgressSections = React.useMemo(
    () => (statusFilterInProgress === 'all' ? buildSections(displayedInProgress, 'hunter') : []),
    [statusFilterInProgress, displayedInProgress, buildSections]
  )

  const myPostingsSections = React.useMemo(
    () => (statusFilterMyPostings === 'all' ? buildSections(displayedMyPostings, 'owner') : []),
    [statusFilterMyPostings, displayedMyPostings, buildSections]
  )

  /**
   * Everything actually blocked on this user — broader than the "Review" chip,
   * which only counts submitted work. This is what the tab badge should show:
   * a poster with three applications waiting has something to do even though
   * nothing has been submitted for review.
   */
  const inProgressAttentionCount = React.useMemo(
    () => inProgressBounties.filter((b) => getLifecycle(b, 'hunter').needsAttention).length,
    [inProgressBounties, getLifecycle]
  )

  const myPostingsAttentionCount = React.useMemo(
    () => myBounties.filter((b) => getLifecycle(b, 'owner').needsAttention).length,
    [myBounties, getLifecycle]
  )

  return {
    getDisplayStatus,
    getLifecycle,
    displayedInProgress,
    displayedMyPostings,
    inProgressSections,
    myPostingsSections,
    inProgressReviewCount,
    myPostingsReviewCount,
    inProgressAttentionCount,
    myPostingsAttentionCount,
  }
}

/**
 * A row in a grouped management list: either a section header or a bounty.
 *
 * The lists are FlatLists (not SectionLists) because their rows are expandable
 * and variable-height, and swapping the list type would have meant re-deriving
 * the scroll/measure behaviour those rows depend on. Flattening keeps one list
 * implementation and one renderer.
 */
export type BountyListRow =
  | { kind: 'section'; id: string; label: string; count: number; group: BountyAttentionGroup }
  | { kind: 'bounty'; id: string; bounty: Bounty }

/**
 * Flattens sections into list rows. With no sections (a filter chip is active,
 * or everything falls in one group) the bounties are returned ungrouped, so the
 * caller always renders the same list either way.
 */
export function toBountyListRows(sections: BountySection[], fallback: Bounty[]): BountyListRow[] {
  if (sections.length === 0) {
    return fallback.map((b) => ({ kind: 'bounty' as const, id: String(b.id), bounty: b }))
  }
  const rows: BountyListRow[] = []
  for (const section of sections) {
    rows.push({
      kind: 'section',
      id: `section:${section.key}`,
      label: section.label,
      count: section.data.length,
      group: section.key,
    })
    for (const b of section.data) {
      rows.push({ kind: 'bounty', id: String(b.id), bounty: b })
    }
  }
  return rows
}
