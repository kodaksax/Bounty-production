/**
 * The message Bounty sends automatically when a poster chooses a hunter
 * (hooks/useAcceptRequest.ts). It opens the conversation, but it isn't the two
 * people talking yet — My Jobs uses {@link isHireWelcomeMessage} so a chosen
 * hunter still sees "Agree a time" until someone actually writes.
 */
const PREFIX = "Welcome! You've been selected for: ";

export function buildHireWelcomeMessage(bountyTitle: string | null | undefined): string {
  return `${PREFIX}"${bountyTitle || ''}". Let's coordinate the details.`;
}

export function isHireWelcomeMessage(text: string | null | undefined): boolean {
  return !!text && text.trim().startsWith(PREFIX);
}
