import {
  getAccountStatusCopyByMessage,
  getAccountStatusErrorMessage,
} from './account-status-errors';
import { TITLE_VALIDATION_MESSAGES } from './bounty-validation';
import { getUserFriendlyError, type ErrorType, type UserFriendlyError } from './error-messages';

// Only these categories map to fixed copy that reveals nothing about the
// backend, so they're the only ones posting a bounty passes through.
const PASSTHROUGH_TYPES: ErrorType[] = ['network', 'authentication', 'rate_limit'];

const TITLE_MESSAGES: string[] = Object.values(TITLE_VALIDATION_MESSAGES);

/**
 * What a poster sees when publishing a bounty fails.
 *
 * Deliberately an allowlist rather than getUserFriendlyError's best-effort
 * sanitizing: the create path can carry raw database text (function names and
 * signatures, constraint names), API hosts and env var names, and none of that
 * belongs in front of a user. Anything not recognized here gets one general
 * message; the real error still goes to the logs.
 */
export function getBountyPublishError(error: unknown): UserFriendlyError {
  const message =
    typeof (error as any)?.message === 'string' ? ((error as any).message as string) : '';

  // Our own copy, safe and actionable as-is.
  const accountStatus =
    getAccountStatusErrorMessage(error) ?? getAccountStatusCopyByMessage(message);
  if (accountStatus) {
    return { type: 'authorization', ...accountStatus, retryable: false };
  }
  if (TITLE_MESSAGES.includes(message)) {
    return { type: 'validation', title: 'Check Your Title', message, retryable: true };
  }

  const friendly = getUserFriendlyError(error);
  if (PASSTHROUGH_TYPES.includes(friendly.type)) return friendly;

  return {
    type: 'unknown',
    title: "Couldn't Post Bounty",
    message: 'Something went wrong while posting your bounty. Please try again in a moment.',
    action: 'Try Again',
    retryable: true,
  };
}
