/**
 * The helper's ID line, and the "What Bounty checks" sheet it links to.
 *
 * What "verified" means, as the code stands (2026-11-25):
 *  - The only live way to verify is Stripe Identity. app/verification/launch.tsx
 *    calls identity-create-session, which opens a `document` VerificationSession
 *    with require_live_capture and require_matching_selfie
 *    (supabase/functions/identity-create-session/index.ts). Stripe checks the
 *    government photo ID (passport, driving licence or ID card) and that a live
 *    selfie matches its photo, then identity-webhooks writes
 *    stripe_identity_status = 'verified'.
 *  - Cross-user reads see stripe_identity_status through public_profiles, and
 *    deriveCoarseVerificationStatus (lib/utils/normalize-profile.ts) turns it
 *    into "verified".
 *  - The old manual upload + admin review (review-id, admin-review-id) is
 *    dormant. No production profile is verified only through it: every
 *    verified profile has a Stripe Identity session and no admin reviewer.
 *  - Bounty runs no background, licence, insurance or skills check
 *    (lib/utils/trust-tier.ts).
 *
 * The app has no pronoun data, so the unverified line avoids "her"/"his".
 */
import { firstName } from '../my-jobs/format';

/** DECISION: what Bounty checks, as it is today. */
export const WHAT_BOUNTY_CHECKS =
  "Stripe checks a person's government photo ID for Bounty: that the ID is real, and that a live selfie matches the photo on it.";

/** DECISION: what Bounty doesn't check. */
export const WHAT_BOUNTY_DOES_NOT_CHECK = "Bounty doesn't run background checks, and doesn't check licenses, insurance or skills.";

/** The sheet's title, and the link that opens it. */
export const WHAT_BOUNTY_CHECKS_TITLE = 'What Bounty checks';

/** The sheet's body, in order. */
export const WHAT_BOUNTY_CHECKS_SHEET: readonly string[] = [WHAT_BOUNTY_CHECKS, WHAT_BOUNTY_DOES_NOT_CHECK];

export interface IdLine {
  verified: boolean;
  icon: 'verified-user' | 'badge';
  text: string;
}

/**
 * Always one line about the helper's ID:
 *   verified     → "Stripe checked Ana's photo ID for Bounty"
 *   not verified → "Ana hasn't verified a photo ID yet"
 * With no usable name it says "this person". "Not verified" includes a check
 * that is still in progress: until Stripe says verified, nothing was checked.
 */
export function describeIdLine(name: string | null | undefined, verified: boolean): IdLine {
  const first = firstName(name?.trim() || null);
  if (verified) {
    return { verified, icon: 'verified-user', text: `Stripe checked ${first ? `${first}'s` : "this person's"} photo ID for Bounty` };
  }
  return { verified, icon: 'badge', text: `${first ?? 'This person'} hasn't verified a photo ID yet` };
}
