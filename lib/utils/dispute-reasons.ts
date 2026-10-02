/**
 * Reasons a participant can give when they report a problem on a bounty a
 * hunter is committed to. Each maps to bounty_disputes.reason_code, which
 * support filters the queue on (20261002120100_review_window_and_recourse_queue.sql).
 *
 * The poster's list is the fix for trust-spine T22: before it, a poster whose
 * hunter went quiet was sent from "Cancel" to a dispute screen that required a
 * cancellation request only the hunter can file.
 */
import type { DisputeReasonCode } from '../services/dispute-service';

export interface DisputeReasonOption {
  code: DisputeReasonCode;
  label: string;
  /** What we tell the reporter happens next, under the chip. */
  help: string;
}

export function getDisputeReasonOptions(
  role: 'poster' | 'hunter',
  opts: { workSubmitted: boolean }
): DisputeReasonOption[] {
  if (role === 'poster') {
    const options: DisputeReasonOption[] = [];
    // A hunter whose work is waiting on the poster has, by definition, responded.
    if (!opts.workSubmitted) {
      options.push({
        code: 'hunter_unresponsive',
        label: "Hunter hasn't responded",
        help: "Bounty support contacts the hunter. If they can't finish, support can return your escrow.",
      });
    }
    if (opts.workSubmitted) {
      options.push({
        code: 'work_quality',
        label: "Work doesn't match the job",
        help: 'Support looks at the submission and the job description, then decides how the escrow is settled.',
      });
    }
    options.push(
      {
        code: 'missed_deadline',
        label: 'Missed the agreed time',
        help: 'Support checks what was agreed in your messages and settles the escrow.',
      },
      {
        code: 'scope_disagreement',
        label: 'We disagree about the job',
        help: 'Support reviews your messages and the job description with both of you.',
      },
      { code: 'other', label: 'Something else', help: 'Tell us what happened and support will follow up.' }
    );
    return options;
  }

  const options: DisputeReasonOption[] = [];
  if (opts.workSubmitted) {
    options.push({
      code: 'poster_unresponsive',
      label: "Poster hasn't responded",
      help: "Your work is already with the poster. If they don't respond within 72 hours of submission, support reviews it anyway.",
    });
  } else {
    options.push({
      code: 'poster_unresponsive',
      label: "Poster hasn't responded",
      help: 'Support contacts the poster. The payment stays in escrow while support reviews.',
    });
  }
  options.push(
    {
      code: 'scope_disagreement',
      label: 'The poster changed the job',
      help: 'Support reviews your messages and the original job description.',
    },
    {
      code: 'communication',
      label: 'Communication broke down',
      help: 'Support steps in between you and the poster.',
    },
    { code: 'other', label: 'Something else', help: 'Tell us what happened and support will follow up.' }
  );
  return options;
}
