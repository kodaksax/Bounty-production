/**
 * What a user can do to manage a job from My Jobs: edit it, take it down,
 * remove a cancelled one, archive a finished one, or hide finished work.
 *
 * The availability rules are the ones the old Inbox applied in its long-press
 * menu and row trash (app/tabs/inbox-screen.tsx, before My Jobs), kept here
 * as a pure function so they are tested once and every surface — the featured
 * card's "Other options" and the switcher's ⋯ menu — offers the same choices.
 *
 * Offer actions (withdraw / remove a closed offer) live with the offers list;
 * see {@link getOfferAction}.
 */
import { isBountyDeadlinePassed } from '../utils/schedule-utils';
import type { IconName, MyJob, MyOffer } from './types';

export type ManageActionKey = 'edit' | 'take_down' | 'discard_cancelled' | 'archive' | 'hide';

export interface ManageAction {
  key: ManageActionKey;
  label: string;
  icon: IconName;
  tone: 'neutral' | 'danger';
  /**
   * Set when the action is listed but can't run right now. The UI shows it
   * dimmed and explains why on tap, rather than hiding a control the user
   * expects to find.
   */
  disabledReason?: string;
}

export const EDIT_LOCKED_REASON =
  'Someone has already offered to do this job, so its details are locked. You can still take it down.';

/** Ordered: neutral actions first, destructive ones last. */
export function getJobManageActions(job: MyJob): ManageAction[] {
  const b = job.bounty;
  const actions: ManageAction[] = [];

  if (job.side === 'posted') {
    const openUnclaimed = b.status === 'open' && !b.accepted_by;
    if (openUnclaimed && !isBountyDeadlinePassed(b)) {
      actions.push({
        key: 'edit',
        label: 'Edit job details',
        icon: job.pendingOfferCount > 0 ? 'lock-outline' : 'edit',
        tone: 'neutral',
        disabledReason: job.pendingOfferCount > 0 ? EDIT_LOCKED_REASON : undefined,
      });
    }
    if (b.status === 'completed') {
      actions.push({ key: 'archive', label: 'Archive this job', icon: 'archive', tone: 'neutral' });
    }
    if (openUnclaimed) {
      actions.push({ key: 'take_down', label: 'Take this job down', icon: 'delete-outline', tone: 'danger' });
    }
    if (b.status === 'cancelled') {
      actions.push({ key: 'discard_cancelled', label: 'Remove from my list', icon: 'delete-outline', tone: 'danger' });
    }
    return actions;
  }

  if (job.finished) {
    actions.push({ key: 'hide', label: 'Remove from my list', icon: 'visibility-off', tone: 'danger' });
  }
  return actions;
}

export type OfferActionKey = 'withdraw' | 'open' | 'remove';

export interface OfferAction {
  key: OfferActionKey;
  label: string;
  tone: 'primary' | 'neutral' | 'danger';
}

/** The one action each offer row carries (design S.2). */
export function getOfferAction(offer: MyOffer): OfferAction {
  switch (offer.status) {
    case 'waiting':
      return { key: 'withdraw', label: 'Withdraw my offer', tone: 'danger' };
    case 'chosen':
      return { key: 'open', label: 'Open the job', tone: 'primary' };
    default:
      return { key: 'remove', label: 'Remove from list', tone: 'neutral' };
  }
}
