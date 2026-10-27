import type { BountyDraft } from 'app/hooks/useBountyDraft';
import {
  validateAmount,
  validateContactInfo,
  validateDescription,
  validateTitle,
} from 'lib/utils/bounty-validation';

/**
 * Field vocabulary for post_step_abandoned's `last_field`, `fields_touched`
 * and `incomplete_fields`, so an abandon can be broken down by the field the
 * poster was on, not only by step.
 *
 * `template` is a task-template tap (it fills title, category and amount in
 * one patch). `contact_info` is not an input: it means a title or description
 * still carries a phone number, email or link, which blocks Next on Task and
 * the publish on Compensation.
 */
export type PostField =
  | 'title'
  | 'description'
  | 'template'
  | 'category'
  | 'location'
  | 'amount'
  | 'honor'
  | 'contact_info';

const LOCATION_KEYS: (keyof BountyDraft)[] = [
  'location',
  'workType',
  'latitude',
  'longitude',
  'zipCode',
  'neighborhood',
  'unit',
];

/**
 * The field a draft patch came from, or null for one that isn't a poster
 * action. trustTier/requiresIdVerified are left out on purpose: StepPay writes
 * them from an effect whenever the title matches a trust tier, so they would
 * show up as the last field for posters who never touched them.
 */
export function fieldForPatch(patch: Partial<BountyDraft>): PostField | null {
  const has = (key: keyof BountyDraft) => Object.prototype.hasOwnProperty.call(patch, key);
  if (has('title') && has('category')) return 'template';
  if (has('title')) return 'title';
  if (has('description')) return 'description';
  if (has('category') || has('requirements')) return 'category';
  if (LOCATION_KEYS.some(has)) return 'location';
  if (has('isForHonor') && patch.isForHonor === true) return 'honor';
  if (has('amount') || has('isForHonor')) return 'amount';
  return null;
}

/**
 * Required fields on `stepName` that would still stop the poster from moving
 * on, judged against the draft at the moment they left. Mirrors the gates in
 * quick/StepTask.tsx (Next disabled), quick/StepWhere.tsx (Next disabled) and
 * quick/StepPay.tsx (publish refused). The amount check uses validateAmount's
 * $1 floor, not posting_policy_config's minimum, so an amount between the two
 * is not reported here.
 */
export function incompleteFieldsForStep(stepName: string | undefined, draft: BountyDraft): PostField[] {
  const missing: PostField[] = [];
  switch (stepName) {
    case 'Task':
      if (validateTitle(draft.title)) missing.push('title');
      if (validateDescription(draft.description)) missing.push('description');
      if (validateContactInfo(draft.title, draft.description)) missing.push('contact_info');
      break;
    case 'Location':
      if (draft.workType !== 'online' && (draft.location || '').trim().length < 3) {
        missing.push('location');
      }
      break;
    case 'Compensation':
      if (validateAmount(draft.amount, draft.isForHonor)) missing.push('amount');
      if (validateContactInfo(draft.title, draft.description)) missing.push('contact_info');
      break;
    default:
      break;
  }
  return missing;
}
