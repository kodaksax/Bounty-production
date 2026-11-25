/**
 * Where a hired job is before any work is sent (E2E-04, E2E-05; Whole-Job Test
 * 2026-11-24). Between "hired" and "submitted" there are three moments, and
 * they ask different things of the poster:
 *
 *   hired    nobody has said a word since the hire: agree a day and time.
 *   working  the helper has written within the silence threshold.
 *   silent   now − (the later of the hire and the helper's last message)
 *            ≥ FOCUS_POLICY.silenceThresholdHours: "You haven't heard from Ana".
 *
 * Only what the helper sends themselves counts. The event cards the server
 * writes in their name (message_type 'system': "Applied to this bounty.",
 * "Submitted the work for review.") and the app's hire welcome are not the
 * helper talking, and the poster's own messages never reset the clock.
 *
 * Both sides compute it the same way: the poster about the helper, the helper
 * about themselves. Pure, so it is tested with a fixed clock
 * (__tests__/unit/utils/hired-phase.test.ts).
 */
import { firstName } from '../my-jobs/format';
import { HIRE_WELCOME_PREFIX, isHireWelcomeMessage } from '../messaging/hire-welcome';
import { parseServerTimestamp } from './bounty-thread-events';

/**
 * THE definition of "a person's own message", used by the job pages here and
 * matched exactly by get_conversation_summaries (supabase/migrations/
 * 20261125180000_conversation_summaries_last_person_message.sql), which My
 * Jobs reads. A contract test keeps the two identical.
 *
 * messages.message_type (enum, NOT NULL, default 'text') on staging 2026-11-25:
 *   text   156  what people type, and the app's hire welcome (88 of them)
 *   system 455  server event cards: "Applied to this bounty." (284),
 *               "Accepted the application.", "Submitted the work for review.",
 *               "Released the payment."
 *   image    0, file 0  photos and files people send
 * A person's own message: a type in PERSON_MESSAGE_TYPES, and not the hire
 * welcome (an automated `text` message, told apart only by its prefix).
 */
export const PERSON_MESSAGE_TYPES = ['text', 'image', 'file'] as const;
export const PERSON_MESSAGE_RULE = {
  types: PERSON_MESSAGE_TYPES,
  /** Messages whose text starts (after leading whitespace) with this are automated. */
  automatedTextPrefix: HIRE_WELCOME_PREFIX,
} as const;

export type HiredPhase = 'hired' | 'working' | 'silent';

export interface ThreadMessage {
  senderId: string;
  createdAt: string;
  text?: string | null;
  /** messages.message_type; 'system' for server event cards. */
  messageType?: string | null;
}

/**
 * Something a person sent themselves (PERSON_MESSAGE_RULE): a text, photo or
 * file, never a server event card or the app's hire welcome. A local row with
 * no type is a text (the column's default).
 */
export function isPersonMessage(m: Pick<ThreadMessage, 'text' | 'messageType'>): boolean {
  const type = m.messageType ?? 'text';
  if (!(PERSON_MESSAGE_TYPES as readonly string[]).includes(type)) return false;
  return !isHireWelcomeMessage(m.text);
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The day in "since …": "today", "yesterday", a weekday within the last 6
 * days ("Thursday"), otherwise the date ("18 Nov"), in the phone's own time.
 * A weekday further back would be ambiguous.
 */
export function sinceDay(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = ms(iso);
  if (Number.isNaN(at)) return null;
  const d = new Date(at);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 6) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return parseServerTimestamp(String(iso));
}

/** When `senderId` last sent a message themselves (any time), or null. */
export function lastPersonMessageAt(messages: readonly ThreadMessage[], senderId: string | null | undefined): string | null {
  if (!senderId) return null;
  let best: { at: number; iso: string } | null = null;
  for (const m of messages) {
    if (String(m.senderId) !== String(senderId) || !isPersonMessage(m)) continue;
    const at = ms(m.createdAt);
    if (Number.isNaN(at)) continue;
    if (!best || at > best.at) best = { at, iso: new Date(at).toISOString() };
  }
  return best?.iso ?? null;
}

export interface HiredPhaseInput {
  /** When the helper was chosen (bounty_requests.accepted_at). */
  hiredAt: string | null | undefined;
  /** The helper's last message they sent themselves (lastPersonMessageAt). */
  helperLastMessageAt: string | null | undefined;
  /** FOCUS_POLICY.silenceThresholdHours; null switches silence off. */
  thresholdHours: number | null;
  now: Date;
}

export interface HiredPhaseResult {
  phase: HiredPhase;
  /** When the silence started: the later of the hire and the helper's last message. */
  silentSince: string | null;
}

/**
 * The phase of a hired job with no work sent. Silence wins over "hired": a
 * job hired four days ago with no word is silent, not newly hired.
 *
 * Null when the hire time is unknown (a failed read, an old row without
 * accepted_at): without it a question asked days before the hire would read
 * as silence, and a recent one as work, so no phase is claimed at all.
 */
export function resolveHiredPhase(input: HiredPhaseInput): HiredPhaseResult | null {
  const hired = ms(input.hiredAt);
  if (Number.isNaN(hired)) return null;
  const last = ms(input.helperLastMessageAt);
  const from = Number.isNaN(last) ? hired : Math.max(hired, last);
  const silentSince = new Date(from).toISOString();
  if (input.thresholdHours !== null) {
    const hours = (input.now.getTime() - from) / 3_600_000;
    if (hours >= input.thresholdHours) return { phase: 'silent', silentSince };
  }
  // Spoken since the hire? (Questions before the hire don't count.)
  const spokeSinceHire = !Number.isNaN(last) && last >= hired;
  return { phase: spokeSinceHire ? 'working' : 'hired', silentSince };
}

/** "Ted's and Sam's offers are closed", "Ted's offer is closed", "The other 4 offers are closed". */
export function othersClosedLine(names: readonly string[], told: boolean): string | null {
  const firsts = names.map((n) => firstName(n)).filter((n): n is string => !!n);
  if (firsts.length === 0) return null;
  const tail = told ? " and they've been told" : '';
  if (firsts.length === 1) return `${firsts[0]}'s offer is closed${tail}`;
  if (firsts.length > 3) return `The other ${firsts.length} offers are closed${tail}`;
  const owned = firsts.map((n) => `${n}'s`);
  return `${owned.slice(0, -1).join(', ')} and ${owned[owned.length - 1]} offers are closed${tail}`;
}
