/**
 * Copy for the direct-message composer (app/tabs/chat-detail-screen.tsx and
 * app/tabs/full-chat-detail-screen.tsx).
 *
 * Kept in one place so both DM screens show the exact same wording — the
 * off-platform disclaimer in particular is a legal notice and must not drift
 * between screens.
 */

export const messagingStrings = {
  // Shown directly above the message input on every DM screen. Puts users on
  // notice that anything taken off the platform is outside BOUNTY's protection.
  offPlatformDisclaimer:
    'Warning: Working outside the BOUNTY app means you lose escrow protection for your payment. BOUNTY is not liable for messages or transactions made outside the platform.',
} as const
