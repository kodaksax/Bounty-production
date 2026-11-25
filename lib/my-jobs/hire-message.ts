/**
 * The message the app sends by itself, in the poster's name, when someone is
 * chosen (hooks/useAcceptRequest). It isn't the two of them
 * talking, so it never counts as either one's message. Defined once, in
 * lib/messaging/hire-welcome.ts, the module the sender uses.
 */
import { isHireWelcomeMessage } from '../messaging/hire-welcome';
import { parseServerTimestamp } from '../utils/bounty-thread-events';

export { buildHireWelcomeMessage, HIRE_WELCOME_PREFIX, isHireWelcomeMessage } from '../messaging/hire-welcome';

/** A message one of them wrote after `since` (the hire; null = no lower bound). */
export function isCoordinationMessage(
  message: { text?: string | null; createdAt?: string | null },
  since: string | null | undefined
): boolean {
  if (isHireWelcomeMessage(message.text)) return false;
  if (!since || !message.createdAt) return true;
  // accepted_at is a timestamp without a zone (UTC): read as local time it
  // lands hours after the hire, and the first messages would not count.
  const at = parseServerTimestamp(message.createdAt);
  const from = parseServerTimestamp(since);
  return Number.isNaN(at) || Number.isNaN(from) || at >= from;
}
