/**
 * The "What's going on?" help sheet (poster J, hunter X.3): only the options
 * that make sense for this job's stage and side. Each one goes somewhere that
 * already exists — the job thread, the hunter's cancellation request, the
 * dispute screen with a reason preselected, or the support form — and none
 * of the copy promises a reply time (Q-OPS-1, Q-OPS-2).
 *
 * Reason codes are the dispute screen's own (lib/utils/dispute-reasons.ts).
 */
import type { DisputeReasonCode } from '../services/dispute-service';

export type HelpOptionKey = 'message' | 'no_show' | 'not_finished' | 'not_replying' | 'cant_do' | 'other';

export interface HelpOptionSpec {
  key: HelpOptionKey;
  icon: string;
  text: string;
  tone: 'g' | 'w' | 'i';
  /** Where it goes. */
  target: 'thread' | 'dispute' | 'cancel_request' | 'support';
  /** Preselected on the dispute screen. */
  reason?: DisputeReasonCode;
}

export interface HelpContext {
  side: 'posted' | 'doing';
  /** The viewer's counterpart on this job, when there is one. */
  otherName: string | null;
  /** Someone is chosen and the work is under way (in progress). */
  working: boolean;
  workSubmitted: boolean;
  /** A dispute is already open: its own screen handles everything. */
  disputeOpen: boolean;
}

export function getHelpOptions(ctx: HelpContext): HelpOptionSpec[] {
  const name = ctx.otherName?.trim() || (ctx.side === 'posted' ? 'Your helper' : 'The poster');
  const somethingElse: HelpOptionSpec = { key: 'other', icon: 'help-outline', text: 'Something else is wrong', tone: 'i', target: 'support' };

  if (!ctx.working || ctx.disputeOpen) {
    const options: HelpOptionSpec[] = [];
    if (ctx.working && ctx.otherName) options.push({ key: 'message', icon: 'chat-bubble-outline', text: `Message ${name}`, tone: 'g', target: 'thread' });
    options.push(somethingElse);
    return options;
  }

  if (ctx.side === 'posted') {
    const options: HelpOptionSpec[] = [{ key: 'message', icon: 'chat-bubble-outline', text: `Message ${name}`, tone: 'g', target: 'thread' }];
    if (!ctx.workSubmitted) {
      options.push({ key: 'no_show', icon: 'person-off', text: `${name} hasn't replied or didn't come`, tone: 'w', target: 'dispute', reason: 'hunter_unresponsive' });
    }
    options.push({
      key: 'not_finished',
      icon: 'assignment-late',
      text: "The job isn't finished",
      tone: 'w',
      target: 'dispute',
      reason: ctx.workSubmitted ? 'work_quality' : 'missed_deadline',
    });
    options.push({ ...somethingElse, target: 'dispute', reason: 'other' });
    return options;
  }

  return [
    { key: 'message', icon: 'chat-bubble-outline', text: `Message ${name}`, tone: 'g', target: 'thread' },
    { key: 'not_replying', icon: 'person-off', text: `${name} isn't replying`, tone: 'w', target: 'dispute', reason: 'poster_unresponsive' },
    ...(!ctx.workSubmitted
      ? [{ key: 'cant_do' as const, icon: 'event-busy', text: "I can't do this job any more", tone: 'w' as const, target: 'cancel_request' as const }]
      : []),
    { ...somethingElse, target: 'dispute', reason: 'other' },
  ];
}

/** The muted line under the sheet title: "Ada is working on it · $60 held by Bounty". */
export function helpSubtitle(args: {
  side: 'posted' | 'doing';
  otherName: string | null;
  working: boolean;
  heldAmount: string | null;
}): string | null {
  if (!args.working) return null;
  const held = args.heldAmount ? ` · ${args.heldAmount} held by Bounty` : '';
  if (args.side === 'doing') return `You're doing this${held}`;
  return `${args.otherName?.trim() || 'Your helper'} is working on it${held}`;
}
