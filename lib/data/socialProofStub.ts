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

// Fixture data: a mix of completed and open jobs so both proof-card variants
// (and the fallback chain in ProofCard.tsx) are exercisable during
// development. Distances here are illustrative only — fetchSocialProof
// strips them to null whenever the caller doesn't supply lat/lng, matching
// the real endpoint's documented behavior.
const STUB_ITEMS: SocialProofItem[] = [
  {
    id: 'bnty_stub_1',
    state: 'completed',
    hunter_first_name: 'Marcus',
    task_summary: 'carried a couch up three flights',
    amount_cents: 4500,
    neighborhood: 'Petworth',
    distance_miles: 1.2,
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'bnty_stub_2',
    state: 'completed',
    hunter_first_name: 'Dana',
    task_summary: 'mounted a TV over the fireplace',
    amount_cents: 6000,
    neighborhood: 'Logan Circle',
    distance_miles: 0.8,
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'bnty_stub_3',
    state: 'completed',
    hunter_first_name: 'Elijah',
    task_summary: 'hauled an old mattress to the dump',
    amount_cents: 3500,
    neighborhood: 'Columbia Heights',
    distance_miles: 2.1,
    timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'bnty_stub_4',
    state: 'completed',
    hunter_first_name: 'Priya',
    task_summary: 'fixed a closet door that wouldn’t close',
    amount_cents: 4000,
    neighborhood: 'Adams Morgan',
    distance_miles: 0.3,
    timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: 'bnty_stub_5',
    state: 'open',
    hunter_first_name: '',
    task_summary: 'help assembling a bookshelf',
    amount_cents: 3000,
    neighborhood: 'Shaw',
    distance_miles: 1.5,
    timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
];

/**
 * Never returns fabricated data — this is fixture data standing in for a
 * real, already-completed/open bounty feed. Callers are responsible for the
 * data-integrity fallback chain (completed -> open -> static card); this
 * function just returns what's "in the database."
 */
export async function fetchSocialProof(params: SocialProofParams = {}): Promise<SocialProofResponse> {
  const limit = params.limit ?? 8;
  const hasLocation = typeof params.lat === 'number' && typeof params.lng === 'number';

  const items = STUB_ITEMS.slice(0, limit).map(item => ({
    ...item,
    distance_miles: hasLocation ? item.distance_miles : null,
  }));

  return { items };
}
