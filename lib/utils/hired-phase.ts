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
import { isHireWelcomeMessage } from '../my-jobs/hire-message';
import { parseServerTimestamp } from './bounty-thread-events';

export type HiredPhase = 'hired' | 'working' | 'silent';

export interface ThreadMessage {
  senderId: string;
  createdAt: string;
  text?: string | null;
  /** messages.message_type; 'system' for server event cards. */
  messageType?: string | null;
}

/** Something a person sent: not a server event card, not the app's hire welcome. */
export function isPersonMessage(m: Pick<ThreadMessage, 'text' | 'messageType'>): boolean {
  if (m.messageType === 'system') return false;
  return !isHireWelcomeMessage(m.text);
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
 */
export function resolveHiredPhase(input: HiredPhaseInput): HiredPhaseResult {
  const hired = ms(input.hiredAt);
  const last = ms(input.helperLastMessageAt);
  const from = Math.max(Number.isNaN(hired) ? -Infinity : hired, Number.isNaN(last) ? -Infinity : last);
  const silentSince = Number.isFinite(from) ? new Date(from).toISOString() : null;
  if (input.thresholdHours !== null && silentSince !== null) {
    const hours = (input.now.getTime() - from) / 3_600_000;
    if (hours >= input.thresholdHours) return { phase: 'silent', silentSince };
  }
  // Spoken since the hire? (Questions before the hire don't count.)
  const spokeSinceHire = !Number.isNaN(last) && (Number.isNaN(hired) || last >= hired);
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
