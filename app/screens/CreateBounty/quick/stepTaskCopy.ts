import type { MissingField } from '../composerTelemetry';

// Mirrors lib/utils/bounty-validation.ts validateDescription, which the server
// also enforces for in-person bounties (20261019230000_posting_quality_rules).
// Do not lower it here: a shorter description is refused at publish.
export const MIN_DETAIL_LENGTH = 20;

// Mirrors validateTitle's minimum.
export const MIN_TITLE_LENGTH = 5;

// validateTitle caps titles at 120 characters.
export const MAX_TITLE_LENGTH = 120;

// Past this many title characters the hint becomes a character counter.
const TITLE_COUNTER_FROM = 90;

export interface StepTaskCopyInput {
  /** draft.title, untrimmed (the counter shows what the field holds). */
  title: string;
  /** draft.description, untrimmed. */
  detail: string;
  /** The first thing still stopping Next, or null when Next is enabled. */
  missingField: MissingField | null;
}

const plural = (n: number, word: string) => `${n} more ${word}${n === 1 ? '' : 's'}`;

/** Letters the details still need, counted the way validateDescription counts. */
export function detailRemaining(detail: string): number {
  return Math.max(0, MIN_DETAIL_LENGTH - detail.trim().length);
}

/**
 * The line beside Next: what is left to do, in the order a poster fills the
 * card. Plain words ("letters"), because the people stuck here were not
 * counting characters.
 */
export function stepTaskHint({ title, detail, missingField }: StepTaskCopyInput): string {
  if (title.length > TITLE_COUNTER_FROM) return `${title.length}/${MAX_TITLE_LENGTH}`;
  const detailLength = detail.trim().length;
  if (detailLength === 0) return 'Add what and when to continue';
  if (detailLength < MIN_DETAIL_LENGTH) return plural(detailRemaining(detail), 'letter');
  if (missingField === 'title') return 'Name the job to continue';
  if (missingField === 'contact') return 'Remove contact details to continue';
  return 'Location and reward come next';
}

/**
 * What a tap on the disabled Next says, naming the field it just moved the
 * poster to and how much is left.
 */
export function stepTaskBlockedNotice({ title, detail, missingField }: StepTaskCopyInput): string | null {
  switch (missingField) {
    case 'title': {
      const length = title.trim().length;
      if (length === 0) return 'Say what you need done first, like “walk my dog”';
      return `Name the job in a few words — ${plural(MIN_TITLE_LENGTH - length, 'letter')}`;
    }
    case 'description':
      return `Add a few words about what and when — ${plural(detailRemaining(detail), 'letter')}`;
    case 'contact':
      return 'Take out the phone number, email or link to continue';
    default:
      return null;
  }
}
