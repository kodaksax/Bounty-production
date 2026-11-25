/**
 * The job strip under a job thread's header (handoff "One conversation, two
 * sides"): which side of the job you're on, and the money truth in a few
 * words. Pure, so the app (components/bounty-inbox/job-thread-bits.tsx) and
 * the website (supabase/functions/web-account, via the generated app-rules
 * bundle) say exactly the same thing.
 */
import { calculateHunterEarnings } from '../constants/fees';
import type { BountyThreadRole } from '../utils/bounty-thread-events';
import { formatJobAmount } from './format';
import type { IconName } from './types';

/** Mirrors components/poster/side-label.tsx WorkspaceSide (kept here so this file stays UI-free). */
export type JobStripSide = 'posted' | 'offered' | 'doing' | 'did';

export interface JobStripInput {
  role: BountyThreadRole;
  viewerId: string | null;
  counterpartId?: string | null;
  bounty: {
    status?: string | null;
    amount?: number | null;
    is_for_honor?: boolean | null;
    accepted_by?: string | null;
    completed_at?: string | null;
  };
  counterpartName: string;
  paymentState?: 'released' | 'pending' | 'unknown' | null;
}

/** "You're doing this · $80 held by Bounty". Says "held" only once someone is chosen. */
export function describeJobStrip({ role, viewerId, counterpartId, bounty, counterpartName, paymentState }: JobStripInput): { side: JobStripSide; icon: IconName; text: string } {
  const honor = !!bounty.is_for_honor;
  const amount = honor ? null : formatJobAmount(bounty.amount);
  const status = String(bounty.status ?? '');
  const working = status === 'in_progress' || status === 'cancellation_requested';
  const hired = !!bounty.accepted_by;
  const completed = status === 'completed' || (status === 'archived' && !!bounty.completed_at);
  if (role === 'poster') {
    if (hired && working) return { side: 'posted', icon: 'assignment-ind', text: amount ? `You posted this · ${amount} held by Bounty` : 'You posted this' };
    if (hired && completed) {
      const helper = counterpartId && String(counterpartId) === String(bounty.accepted_by) && counterpartName.trim()
        ? counterpartName.trim()
        : 'your helper';
      return {
        side: 'posted',
        icon: 'assignment-ind',
        text: honor
          ? 'You posted this'
          : paymentState === 'released'
            ? `You posted this · Released to ${helper}`
            : `You posted this · Release status unconfirmed for ${helper}`,
      };
    }
    return { side: 'posted', icon: 'assignment-ind', text: amount ? `You posted this · ${amount}` : 'You posted this' };
  }
  const chosen = hired && !!viewerId && String(bounty.accepted_by) === String(viewerId);
  if (chosen && working) return { side: 'doing', icon: 'construction', text: amount ? `You're doing this · ${amount} held by Bounty` : "You're doing this" };
  if (chosen && completed) {
    const net = formatJobAmount(calculateHunterEarnings(bounty.amount).net);
    return {
      side: 'did',
      icon: 'task-alt',
      text: honor
        ? 'You did this'
        : paymentState === 'released'
          ? `You did this · ${net} released to your wallet`
          : `You did this · ${net} release status unconfirmed`,
    };
  }
  return { side: 'offered', icon: 'send', text: amount ? `You offered · ${amount}` : 'You offered' };
}
