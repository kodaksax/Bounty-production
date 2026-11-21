/**
 * Everything the My Jobs tab shows, loaded and kept fresh.
 *
 * The loaders, the realtime subscription and the hidden-bounty bookkeeping
 * moved here unchanged from the old Inbox (app/tabs/inbox-screen.tsx) so the
 * same records arrive the same way; the tab now derives jobs and offers from
 * them with lib/my-jobs/build-my-jobs instead of rendering a list per side.
 */
import { useFocusEffect } from 'expo-router'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { bountyService } from 'lib/services/bounty-service'
import type { Bounty } from 'lib/services/database.types'
import { filterManagementBounties } from 'lib/utils/bounty-visibility'
import { hideBountyForHunter, loadHunterHiddenBountyIds } from 'lib/utils/hunter-hidden-bounties'
import { buildMyJobs } from '../lib/my-jobs/build-my-jobs'
import type { MyJobsModel } from '../lib/my-jobs/types'
import { supabase } from '../lib/supabase'
import { uniqueRealtimeTopic } from '../lib/utils/realtime-topic'
import { useBountyStatusFilters } from './useBountyStatusFilters'
import { useConversations } from './useConversations'

export interface MyJobsData extends MyJobsModel {
  /** Pending applications on the viewer's open bounties, by bounty id. */
  applicantsByBounty: Map<string, BountyRequestWithDetails[]>
  /** The viewer's posted bounties, as loaded (for edits and optimistic updates). */
  myBounties: Bounty[]
  setMyBounties: React.Dispatch<React.SetStateAction<Bounty[]>>
  /** True until both sides have loaded once. */
  loading: boolean
  refreshing: boolean
  error: string | null
  setError: (message: string | null) => void
  /** Pull-to-refresh and "Try again": reloads both sides and the conversations. */
  refresh: () => Promise<void>
  reloadPosted: () => Promise<void>
  reloadOffers: () => Promise<void>
  /**
   * Removes a bounty from this hunter's own list for good (persisted per user,
   * issue #779). Throws if the write fails, so callers can leave it in place.
   */
  hideForHunter: (bountyId: string | number) => Promise<void>
  /** Marks a bounty hidden locally after a service already persisted the hide. */
  markHiddenLocally: (bountyId: string | number) => void
  totalUnreadMessages: number
}

export function useMyJobsData(userId: string | undefined): MyJobsData {
  const [myBounties, setMyBounties] = useState<Bounty[]>([])
  const [hunterRequests, setHunterRequests] = useState<BountyRequestWithDetails[]>([])
  const [pendingApplications, setPendingApplications] = useState<BountyRequestWithDetails[]>([])
  const [loadingPosted, setLoadingPosted] = useState(true)
  const [loadingOffers, setLoadingOffers] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bounty ids this hunter removed from their own list. Persisted per user so a
  // removal survives tab switches and restarts (issue #779).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())

  const {
    totalUnreadCount,
    conversations,
    refresh: refreshConversations,
  } = useConversations()

  // ---- Loaders ----
  const loadPendingApplications = React.useCallback(async (bounties: Bounty[]) => {
    // Only open bounties take offers; once someone is chosen the rest close.
    const openIds = bounties.filter((b) => b.status === 'open').map((b) => String(b.id))
    if (openIds.length === 0) {
      setPendingApplications([])
      return
    }
    try {
      const requests = await bountyRequestService.getAllWithDetailsBatch(openIds, {
        status: 'pending',
        page: 1,
        pageSize: 200,
      })
      setPendingApplications(requests)
    } catch (e) {
      console.error('Error loading offers on your jobs:', e)
      setError("We couldn't load the offers on your jobs.")
    }
  }, [])

  const reloadPosted = React.useCallback(async () => {
    if (!userId) {
      setMyBounties([])
      setPendingApplications([])
      setLoadingPosted(false)
      return
    }
    try {
      setError(null)
      const mine = await bountyService.getByUserId(userId)
      // The shared lifecycle filter, re-applied on every load: it also drops
      // bounties this client just removed, so a query that raced the mutation
      // can't put them back (see lib/utils/bounty-visibility).
      const active = filterManagementBounties(mine)
      setMyBounties(active)
      await loadPendingApplications(active)
    } catch (e) {
      console.error('Error loading your posted jobs:', e)
      setError("We couldn't load your jobs.")
    } finally {
      setLoadingPosted(false)
    }
  }, [userId, loadPendingApplications])

  const reloadOffers = React.useCallback(async () => {
    if (!userId) {
      setHunterRequests([])
      setLoadingOffers(false)
      return
    }
    try {
      setError(null)
      // Every status (pending, accepted, rejected) so closed offers can be listed.
      const requests = await bountyRequestService.getAllWithDetails({ userId })
      const visible = new Set(
        filterManagementBounties(requests.map((r) => r?.bounty).filter((b): b is Bounty => !!b)).map((b) =>
          String(b.id)
        )
      )
      setHunterRequests(requests.filter((r) => r?.bounty && visible.has(String(r.bounty.id))))
    } catch (e) {
      console.error('Error loading the work you offered to do:', e)
      setError("We couldn't load your jobs.")
    } finally {
      setLoadingOffers(false)
    }
  }, [userId])

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([reloadPosted(), reloadOffers(), refreshConversations().catch(() => null)])
    } finally {
      setRefreshing(false)
    }
  }, [reloadPosted, reloadOffers, refreshConversations])

  useEffect(() => {
    if (!userId) {
      setMyBounties([])
      setHunterRequests([])
      setPendingApplications([])
      setLoadingPosted(false)
      setLoadingOffers(false)
      return
    }
    setLoadingPosted(true)
    setLoadingOffers(true)
    reloadPosted()
    reloadOffers()
  }, [userId, reloadPosted, reloadOffers])

  // Coming back from a job (where the user may have hired, sent work, paid…)
  // must not leave the tab showing the old state. The first focus is the
  // initial load above.
  const firstFocusRef = useRef(true)
  useFocusEffect(
    React.useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false
        return
      }
      reloadPosted()
      reloadOffers()
      refreshConversations().catch(() => {})
    }, [reloadPosted, reloadOffers, refreshConversations])
  )

  useEffect(() => {
    let active = true
    if (!userId) {
      setHiddenIds(new Set())
      return
    }
    loadHunterHiddenBountyIds(userId).then((ids) => {
      if (active) setHiddenIds(ids)
    })
    return () => {
      active = false
    }
  }, [userId])

  // Realtime offers: one list-level subscription covering bounty_requests for
  // every open job the viewer posted. Rebuilt only when that set of ids changes.
  const myBountiesRef = useRef(myBounties)
  useEffect(() => {
    myBountiesRef.current = myBounties
  }, [myBounties])
  const openIdsKey = useMemo(
    () => myBounties.filter((b) => b.status === 'open').map((b) => String(b.id)).sort().join(','),
    [myBounties]
  )
  useEffect(() => {
    const ids = openIdsKey ? openIdsKey.split(',') : []
    if (!userId || ids.length === 0) return
    const channel = supabase
      .channel(uniqueRealtimeTopic(`my-jobs-offers:${userId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bounty_requests', filter: `bounty_id=in.(${ids.join(',')})` },
        () => {
          loadPendingApplications(myBountiesRef.current)
        }
      )
      .subscribe()
    return () => {
      try {
        supabase.removeChannel(channel)
      } catch {
        // best-effort cleanup
      }
    }
  }, [openIdsKey, userId, loadPendingApplications])

  // ---- Derived ----
  const applicantsByBounty = useMemo(() => {
    const m = new Map<string, BountyRequestWithDetails[]>()
    for (const r of pendingApplications) {
      if (r.status !== 'pending') continue
      const key = String(r.bounty_id)
      const list = m.get(key)
      if (list) list.push(r)
      else m.set(key, [r])
    }
    return m
  }, [pendingApplications])

  const applicationCounts = useMemo(() => {
    const counts = new Map<string, number>()
    applicantsByBounty.forEach((list, key) => counts.set(key, list.length))
    return counts
  }, [applicantsByBounty])

  const hunterBounties = useMemo(() => {
    const map = new Map<string, Bounty>()
    for (const r of hunterRequests) {
      const b = r?.bounty
      if (b && !hiddenIds.has(String(b.id)) && !map.has(String(b.id))) map.set(String(b.id), b)
    }
    return Array.from(map.values())
  }, [hunterRequests, hiddenIds])

  // The shared lifecycle resolver (and the latest submission it depends on),
  // so the tab tells the same story as each job's own screen.
  const { getLifecycle, getLatestSubmission } = useBountyStatusFilters({
    currentUserId: userId,
    myBounties,
    inProgressBounties: hunterBounties,
    hunterRequests,
    statusFilterInProgress: 'all',
    statusFilterMyPostings: 'all',
    applicationCounts,
  })

  const model = useMemo<MyJobsModel>(() => {
    if (!userId) return { jobs: [], offers: [] }
    return buildMyJobs({
      viewerId: userId,
      postedBounties: myBounties,
      hunterRequests,
      pendingApplicationsByBounty: applicantsByBounty,
      conversations,
      hiddenBountyIds: hiddenIds,
      getLifecycle,
      getSubmission: getLatestSubmission,
    })
  }, [userId, myBounties, hunterRequests, applicantsByBounty, conversations, hiddenIds, getLifecycle, getLatestSubmission])

  const markHiddenLocally = React.useCallback((bountyId: string | number) => {
    const key = String(bountyId)
    setHiddenIds((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])

  const hideForHunter = React.useCallback(
    async (bountyId: string | number) => {
      await hideBountyForHunter(userId, bountyId)
      markHiddenLocally(bountyId)
    },
    [userId, markHiddenLocally]
  )

  return {
    ...model,
    applicantsByBounty,
    myBounties,
    setMyBounties,
    loading: loadingPosted || loadingOffers,
    refreshing,
    error,
    setError,
    refresh,
    reloadPosted,
    reloadOffers,
    hideForHunter,
    markHiddenLocally,
    totalUnreadMessages: totalUnreadCount,
  }
}
