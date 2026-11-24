/**
 * The job a user picked in the My Jobs switcher, remembered per user across
 * launches (design S.2: "Manual pick persists across launches"). Whether the
 * pick still wins over a newly urgent job is decided by
 * lib/my-jobs/featured-job's pickFeaturedJob; this hook only stores it.
 *
 * Storage is a convenience: every read and write is guarded, and a failure
 * just means the tab falls back to the automatic choice.
 */
import * as React from 'react'
import { useEffect, useState } from 'react'
import type { ManualPick } from '../lib/my-jobs/featured-job'
import { storage } from '../lib/storage'

function storageKey(userId: string): string {
  return `@bounty/my_jobs_featured_pick/${userId}`
}

function parsePick(raw: string | null): ManualPick | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ManualPick>
    if (typeof value?.key !== 'string' || !Array.isArray(value.outranking)) return null
    return {
      key: value.key,
      outranking: value.outranking.filter((s): s is string => typeof s === 'string'),
      ...(Number.isFinite(value.bestRankAtPick) ? { bestRankAtPick: value.bestRankAtPick } : {}),
    }
  } catch {
    return null
  }
}

export function useFeaturedJobPick(userId: string | undefined) {
  const [pick, setPickState] = useState<ManualPick | null>(null)

  useEffect(() => {
    let active = true
    setPickState(null)
    if (!userId) return
    storage
      .getItem(storageKey(userId))
      .then((raw) => {
        if (active) setPickState(parsePick(raw))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [userId])

  const setPick = React.useCallback(
    (next: ManualPick | null) => {
      setPickState(next)
      if (!userId) return
      const write = next
        ? storage.setItem(storageKey(userId), JSON.stringify(next))
        : storage.removeItem(storageKey(userId))
      Promise.resolve(write).catch(() => {})
    },
    [userId]
  )

  return { pick, setPick }
}
