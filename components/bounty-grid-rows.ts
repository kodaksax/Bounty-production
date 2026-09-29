import { getBountyCategoryDef } from '../lib/constants/bounty-categories'
import type { Bounty } from '../lib/services/database.types'
import type { BountyCompleteness } from '../lib/utils/bounty-completeness'

// Ordering for the grid feed. Kept out of bounty-grid-feed.tsx so the rules
// below can be exercised without pulling in the card components (and, through
// them, every native module they render).

// Category is the metadata the poster explicitly chose when creating the
// bounty (see StepTitle.tsx) — never inferred from title/description text.
export function getBountyCategory(bounty: Bounty): string {
  const def = getBountyCategoryDef(bounty.category)
  return def ? def.label : 'Other'
}

export type FeaturedCarouselRow = { type: 'featuredCarousel'; items: Array<{ item: Bounty; categoryKey: string }> }
export type PairRow             = { type: 'pair'; left: Bounty; right: Bounty | null; categoryKey: string; rightCategoryKey: string | null }
export type GridRow             = FeaturedCarouselRow | PairRow

const FEATURED_COUNT = 3

export function buildGridRows(
  bounties: Bounty[],
  completenessById: Map<string, BountyCompleteness>
): GridRow[] {
  // Sort globally: highest price first, honor (no price) last
  const byPrice = [...bounties].sort((a, b) => {
    const aHonor = Boolean(a.is_for_honor)
    const bHonor = Boolean(b.is_for_honor)
    if (aHonor && !bHonor) return 1
    if (!aHonor && bHonor) return -1
    return Number(b.amount || 0) - Number(a.amount || 0)
  })

  // The carousel is the top of the price order, full stop: the highest-paying
  // open bounties are the ones worth putting in the largest cards, so the
  // completeness demotion below deliberately does not apply here. (It used to,
  // which let a complete $10 listing take a featured slot from an incomplete
  // $500 one — the carousel then showed prices lower than the grid under it.)
  // Incomplete featured cards still carry their "Limited details" badge.
  const featured = byPrice.slice(0, FEATURED_COUNT)
  const featuredIds = new Set(featured.map(b => String(b.id)))

  // Below the carousel, sink incomplete listings (missing scope / location /
  // timing) below complete ones — a barebones "$10, Location TBD" card is not
  // something a hunter can act on. Stable partition, so price order is
  // preserved within each group.
  const isIncomplete = (b: Bounty) =>
    completenessById.get(String(b.id))?.isComplete === false
  const remaining = byPrice.filter(b => !featuredIds.has(String(b.id)))
  const rest = [
    ...remaining.filter(b => !isIncomplete(b)),
    ...remaining.filter(b => isIncomplete(b)),
  ]

  const rows: GridRow[] = []

  if (featured.length > 0) {
    rows.push({
      type: 'featuredCarousel',
      items: featured.map(b => ({ item: b, categoryKey: getBountyCategory(b) })),
    })
  }

  for (let i = 0; i < rest.length; i += 2) {
    const right = rest[i + 1] ?? null
    rows.push({
      type: 'pair',
      left: rest[i],
      right,
      categoryKey: getBountyCategory(rest[i]),
      rightCategoryKey: right ? getBountyCategory(right) : null,
    })
  }

  return rows
}

