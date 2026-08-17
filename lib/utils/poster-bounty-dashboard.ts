export type PosterBountyOwner = {
  poster_id?: string | null;
  user_id?: string | null;
};

export type PosterBountyStage = 'apply_work' | 'working_progress' | 'review_verify' | 'payout';

export function isBountyPoster(bounty: PosterBountyOwner, userId: string | null) {
  return bounty.poster_id === userId || bounty.user_id === userId;
}

export function getPosterDashboardNextRoute(stage: PosterBountyStage, bountyId: string) {
  return stage === 'review_verify' ? `/postings/${bountyId}/review-and-verify` : null;
}