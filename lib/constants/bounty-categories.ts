/**
 * Canonical bounty category list. Shared between the posting flow
 * (app/screens/CreateBounty/StepTitle.tsx, where a poster optionally picks
 * one) and the feed (components/bounty-feed.tsx, components/bounty-grid-feed.tsx,
 * where bounties are filtered/grouped by the stored value) so both stay in sync.
 */

export interface BountyCategoryDef {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export const BOUNTY_CATEGORIES: BountyCategoryDef[] = [
  { id: 'tech', label: 'Tech', icon: 'computer', color: '#3b82f6' },
  { id: 'design', label: 'Design', icon: 'palette', color: '#a855f7' },
  { id: 'writing', label: 'Writing', icon: 'edit', color: '#f59e0b' },
  { id: 'labor', label: 'Labor', icon: 'build', color: '#f97316' },
  { id: 'delivery', label: 'Delivery', icon: 'local-shipping', color: '#06b6d4' },
  { id: 'other', label: 'Other', icon: 'more-horiz', color: '#8b5cf6' },
];

const BY_ID: Record<string, BountyCategoryDef> = Object.fromEntries(
  BOUNTY_CATEGORIES.map((c) => [c.id, c])
);

/** Looks up a category def by its stored id (case-insensitive). Returns undefined if unset/unrecognized. */
export function getBountyCategoryDef(categoryId: string | null | undefined): BountyCategoryDef | undefined {
  if (!categoryId) return undefined;
  return BY_ID[categoryId.toLowerCase()];
}
