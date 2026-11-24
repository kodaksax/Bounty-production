/**
 * The message the app sends by itself, in the poster's name, when someone is
 * chosen (hooks/useAcceptRequest). It isn't the two of them talking: the
 * "agree a time" step (poster F, hunter H.4 / H.5) lasts until one of them
 * writes a message of their own after the hire.
 */
const PREFIX = 'Welcome! You\'ve been selected for: "';

export function buildHireWelcomeMessage(title: string | null | undefined): string {
  return `${PREFIX}${title || ''}". Let's coordinate the details.`;
}

export function isHireWelcomeMessage(text: string | null | undefined): boolean {
  return !!text && text.trimStart().startsWith(PREFIX);
}

/** A message one of them wrote after `since` (the hire; null = no lower bound). */
export function isCoordinationMessage(
  message: { text?: string | null; createdAt?: string | null },
  since: string | null | undefined
): boolean {
  if (isHireWelcomeMessage(message.text)) return false;
  if (!since || !message.createdAt) return true;
  const at = new Date(message.createdAt).getTime();
  const from = new Date(since).getTime();
  return Number.isNaN(at) || Number.isNaN(from) || at >= from;
}
