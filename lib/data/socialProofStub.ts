/**
 * Client for the first-screen social proof card
 * (components/onboarding/ProofCard.tsx). Matches the contract of
 * `GET /api/v1/public/social-proof?lat={lat}&lng={lng}&limit={limit}`.
 *
 * TODO: replace stub with live endpoint — swap the body of
 * `fetchSocialProof` below for a real request (or `supabase.functions.invoke`)
 * once a backend implementation of this contract exists. Callers only depend
 * on the exported types and `fetchSocialProof`'s signature, so the swap is a
 * one-line change in this file.
 */

export type ProofState = 'completed' | 'open';

export interface SocialProofItem {
  id: string;
  state: ProofState;
  hunter_first_name: string;
  task_summary: string;
  amount_cents: number;
  neighborhood: string;
  /** null when the request was made without lat/lng (no location permission). */
  distance_miles: number | null;
  timestamp: string;
}

export interface SocialProofResponse {
  items: SocialProofItem[];
}

export interface SocialProofParams {
  lat?: number;
  lng?: number;
  limit?: number;
}

/**
 * Returns no items until a real endpoint exists, so ProofCard.tsx always
 * renders its static, non-factual fallback card.
 *
 * This used to return hard-coded fixtures ("Marcus carried a couch up three
 * flights · $45 · 2 hours ago") with timestamps relative to now, which
 * ProofCard rendered as real completed bounties nearby. The screen is
 * currently unreachable (PosterFirstWelcome has no importer), but fabricated
 * completions must not be one import away from production. Fixtures for
 * development belong in tests, not in the data client.
 */
export async function fetchSocialProof(_params: SocialProofParams = {}): Promise<SocialProofResponse> {
  return { items: [] };
}
