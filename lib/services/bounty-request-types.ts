/**
 * Shapes of a bounty request with its bounty and applicant attached. Kept in
 * a dependency-free file so pure rule code (lib/my-jobs, lib/web) can name the
 * type without importing the request service and, through it, Supabase and
 * React Native. bounty-request-service.ts re-exports these.
 */
import type { Bounty, BountyRequest, Profile } from './database.types';

export interface ApplicantQualificationSummary {
  eligible: boolean;
  score: number;
  matchedTerms: { label: string; importance: 'required' | 'preferred'; provenance: 'self_reported' }[];
  missingRequiredTerms: string[];
}

export type BountyRequestWithDetails = BountyRequest & {
  bounty: Bounty;
  profile: Profile;
  qualification?: ApplicantQualificationSummary;
};
