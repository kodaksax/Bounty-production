export type PosterBountyOwner = {
  poster_id?: string | null;
  user_id?: string | null;
};

/**
 * Ownership check for the poster-only screens. Both id columns are compared:
 * `poster_id` is canonical and `user_id` is the backwards-compatible alias, and
 * rows exist where only one is populated.
 */
export function isBountyPoster(bounty: PosterBountyOwner, userId: string | null) {
  return bounty.poster_id === userId || bounty.user_id === userId;
}

// getPosterDashboardNextRoute was removed with the poster dashboard's
// locally-tracked "stage" model. Advancing a bounty is now driven by backend
// state through lib/utils/bounty-lifecycle.ts, which decides the primary action
// for a state instead of a next-stage route for a UI step.