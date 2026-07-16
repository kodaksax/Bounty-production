import type { Bounty } from '../../lib/services/database.types';

export interface PreviewCard {
  title: string;
  priceLabel: string;
  metaLabel: string;
  amount: number;
}

/**
 * Maps real open bounties into the compact card shape the hunter onboarding
 * screens render. Returns an empty array (never fabricated data) when there
 * are no real bounties to show — callers are responsible for distinguishing
 * "still loading" (recentBounties === null) from "confirmed empty" ([]) and
 * rendering an honest loading/empty state for each. Silently substituting
 * mock bounties here previously made a genuinely empty market look active.
 */
export function getPreviewCards(recentBounties: Bounty[] | null): PreviewCard[] {
  if (!recentBounties || recentBounties.length === 0) return [];
  return recentBounties.slice(0, 2).map((bounty) => ({
    title: bounty.title,
    priceLabel: bounty.is_for_honor ? '🏅 For Honor' : `💰 $${bounty.amount}`,
    metaLabel: `📍 ${
      typeof bounty.distance === 'number' ? `~${Math.round(bounty.distance)} mi` : bounty.location
    } · ⏰ ${bounty.timeline || 'Flexible'}`,
    amount: bounty.amount,
  }));
}
