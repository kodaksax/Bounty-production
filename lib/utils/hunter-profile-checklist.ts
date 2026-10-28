/**
 * Hunter "stand out to posters" checklist.
 *
 * Distinct from calculateProfileCompleteness() (profile-completeness.ts),
 * which is a flat personalization meter. This is an ordered list of the
 * steps that most change how a hunter reads to a poster, most valuable
 * first:
 *
 *   1. ID verification   — the strongest trust signal, and the one many
 *                          hunters have already started (stripe_identity_status
 *                          'requires_input' with no rejection reason means a
 *                          session was opened and never finished, not that it
 *                          was rejected).
 *   2. Bio + skills      — what a poster reads before hiring.
 *   3. Profile photo
 *   4. Phone             — only when a phone-verification screen exists; there
 *                          is none today (sendPhoneOTP has no caller), so it's
 *                          opt-in via `includePhone` rather than a step nobody
 *                          can complete.
 *   5. Payouts           — last because posters never see it; it only decides
 *                          whether the hunter can get paid.
 *
 * Completion rate is deliberately absent: at current volume it measures
 * nothing a hunter can act on (see trust-summary.ts for the sample-size rule
 * reputation stats follow).
 */

export type HunterChecklistItemId = 'id_verification' | 'bio_and_skills' | 'photo' | 'phone' | 'payouts';

/**
 * - todo        : not started
 * - in_progress : started but unfinished (ID session opened, never submitted;
 *                 or only one of bio/skills filled)
 * - needs_fix   : submitted and sent back (ID rejected)
 * - in_review   : waiting on someone else (Stripe processing) — nothing to do
 * - done
 */
export type HunterChecklistItemState = 'todo' | 'in_progress' | 'needs_fix' | 'in_review' | 'done';

export interface HunterChecklistItem {
  id: HunterChecklistItemId;
  state: HunterChecklistItemState;
  title: string;
  detail: string;
}

export interface HunterChecklistInput {
  stripe_identity_status?: 'unstarted' | 'requires_input' | 'processing' | 'verified' | 'canceled' | null;
  id_verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected' | null;
  id_verification_rejection_reason?: string | null;
  bio?: string | null;
  skills?: readonly string[] | null;
  avatar_url?: string | null;
  phone_verified?: boolean | null;
  payouts_enabled?: boolean | null;
}

export interface HunterChecklistOptions {
  /** Include the phone step. Leave off until a phone-verification screen ships. */
  includePhone?: boolean;
}

export interface HunterChecklistResult {
  items: HunterChecklistItem[];
  /** Items the hunter can act on now (excludes done and in_review). */
  remaining: number;
  /** First actionable item, in priority order. */
  nextItem: HunterChecklistItem | null;
  /** Every item done. An ID still in review keeps this false. */
  isComplete: boolean;
}

const hasText = (value?: string | null) => typeof value === 'string' && value.trim().length > 0;

function idVerificationItem(input: HunterChecklistInput): HunterChecklistItem {
  const base = { id: 'id_verification' as const, title: 'Verify your ID' };

  // Same precedence as getVerificationBadges(): Stripe Identity first, legacy
  // id_verification_status as the fallback for pre-migration verifications.
  if (input.stripe_identity_status === 'verified' || input.id_verification_status === 'verified') {
    return { ...base, state: 'done', detail: 'Posters see the ID Verified badge on your profile.' };
  }
  if (input.stripe_identity_status === 'processing' || input.id_verification_status === 'pending') {
    return { ...base, state: 'in_review', title: 'ID under review', detail: "We'll let you know when it's approved." };
  }
  if (input.id_verification_status === 'rejected' || hasText(input.id_verification_rejection_reason)) {
    return {
      ...base,
      state: 'needs_fix',
      title: 'Resubmit your ID',
      detail: "Your last attempt didn't go through. Try again to earn the ID Verified badge.",
    };
  }
  if (input.stripe_identity_status === 'requires_input') {
    return {
      ...base,
      state: 'in_progress',
      title: 'Finish verifying your ID',
      detail: 'You already started. Finish to earn the ID Verified badge posters look for.',
    };
  }
  return { ...base, state: 'todo', detail: 'Posters trust verified hunters first. Earn the ID Verified badge.' };
}

function bioAndSkillsItem(input: HunterChecklistInput): HunterChecklistItem {
  const hasBio = hasText(input.bio);
  const hasSkills = Array.isArray(input.skills) && input.skills.some((s) => hasText(s));
  const base = { id: 'bio_and_skills' as const, title: 'Add a bio and skills' };

  if (hasBio && hasSkills) {
    return { ...base, state: 'done', detail: 'Posters can see what you do.' };
  }
  if (hasBio) {
    return { ...base, state: 'in_progress', title: 'List your skills', detail: 'Show posters which jobs you can take on.' };
  }
  if (hasSkills) {
    return { ...base, state: 'in_progress', title: 'Add a short bio', detail: 'A few lines about you and the work you do.' };
  }
  return { ...base, state: 'todo', detail: 'Tell posters who you are and what jobs you can take on.' };
}

export function getHunterProfileChecklist(
  input: HunterChecklistInput,
  options: HunterChecklistOptions = {}
): HunterChecklistResult {
  const items: HunterChecklistItem[] = [idVerificationItem(input), bioAndSkillsItem(input)];

  items.push(
    hasText(input.avatar_url)
      ? { id: 'photo', state: 'done', title: 'Add a profile photo', detail: 'Posters can put a face to your name.' }
      : { id: 'photo', state: 'todo', title: 'Add a profile photo', detail: 'Profiles with a photo feel more trustworthy.' }
  );

  if (options.includePhone) {
    items.push(
      input.phone_verified === true
        ? { id: 'phone', state: 'done', title: 'Verify your phone', detail: 'Your phone number is verified.' }
        : { id: 'phone', state: 'todo', title: 'Verify your phone', detail: 'Another signal that you are who you say you are.' }
    );
  }

  items.push(
    input.payouts_enabled === true
      ? { id: 'payouts', state: 'done', title: 'Set up payouts', detail: "You're ready to get paid." }
      : { id: 'payouts', state: 'todo', title: 'Set up payouts', detail: 'Only you see this. It lets you get paid when a job is done.' }
  );

  const actionable = items.filter((item) => item.state !== 'done' && item.state !== 'in_review');

  return {
    items,
    remaining: actionable.length,
    nextItem: actionable[0] ?? null,
    isComplete: items.every((item) => item.state === 'done'),
  };
}
