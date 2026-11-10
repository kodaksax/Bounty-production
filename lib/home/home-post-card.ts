/**
 * Who gets the "Post a job" card at the top of the home feed
 * (components/home-post-card.tsx).
 *
 * Returning posters were landing on the hunter feed with no visible way to
 * post: one poster opened the app four times on 2026-11-09 and only reached
 * the composer through the Post tab. The card puts posting first for anyone
 * who said they are a poster or who has already posted. Hunters who have
 * never posted see the feed exactly as before.
 */

export type PrimaryRole = 'poster' | 'hunter' | 'both' | null | undefined;

export interface HomePostCardAudience {
  /** profiles.primary_role */
  primaryRole: PrimaryRole;
  /** The viewer has at least one bounty of their own (any status but 'deleted'). */
  hasPosted: boolean;
}

export function shouldShowHomePostCard({ primaryRole, hasPosted }: HomePostCardAudience): boolean {
  return primaryRole === 'poster' || hasPosted;
}

/** The `action` property of home_post_card_tapped. */
export type HomePostCardAction = 'post_new' | 'post_again' | 'see_all_posts';

/** The composer's `entry_point` when it is opened from this card. */
export const HOME_POST_CARD_ENTRY_POINT = 'home_post_card';
