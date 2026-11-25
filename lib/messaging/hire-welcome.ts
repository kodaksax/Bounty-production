/**
 * The message Bounty sends automatically when a poster chooses a hunter
 * (hooks/useAcceptRequest.ts). It opens the conversation, but it isn't the two
 * people talking yet: My Jobs and the job pages use {@link isHireWelcomeMessage}
 * so a chosen helper still sees "Agree a day and time" until someone writes.
 *
 * THE one definition of the welcome. The sender builds it from
 * HIRE_WELCOME_PREFIX, the readers recognise it by the same constant
 * (lib/my-jobs/hire-message.ts, lib/utils/hired-phase.ts PERSON_MESSAGE_RULE),
 * and the conversation-summary SQL matches the same prefix
 * (__tests__/unit/conversation-summaries-person-message.test.ts fails if any
 * of them drift apart).
 *
 * FOLLOW-UP (not this change): the welcome is sent as message_type 'text' in
 * the poster's name; it should be sent as 'system', like the server's event
 * cards, so no prefix matching is needed.
 */
export const HIRE_WELCOME_PREFIX = "Welcome! You've been selected for: ";

export function buildHireWelcomeMessage(bountyTitle: string | null | undefined): string {
  return `${HIRE_WELCOME_PREFIX}"${bountyTitle || ''}". Let's coordinate the details.`;
}

/** True for the automatic welcome (leading whitespace ignored, as the SQL's `^\s*`). */
export function isHireWelcomeMessage(text: string | null | undefined): boolean {
  return !!text && text.trimStart().startsWith(HIRE_WELCOME_PREFIX);
}
