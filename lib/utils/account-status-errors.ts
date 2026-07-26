/**
 * Maps account-status enforcement failures (see
 * 20260726000000_enforce_account_status.sql) to user-facing copy.
 *
 * Two distinct error shapes can reach the client for the same underlying
 * cause:
 *  - SECURITY DEFINER RPCs (fn_accept_bounty_request, rpc_create_conversation,
 *    rpc_get_or_create_dm_conversation) call assert_account_active(), which
 *    RAISEs a distinguishable message ('account_banned' / 'account_suspended')
 *    -- these are matched directly.
 *  - Direct client inserts/updates (bounties, bounty_requests, messages,
 *    conversation_participants, profiles) are rejected by a plain RLS
 *    WITH CHECK failure, which Postgres reports as a generic
 *    "new row violates row-level security policy" message with no way to
 *    tell "banned" from "suspended" (or from an unrelated RLS failure) from
 *    the error text alone. For that case we fall back to the caller's own
 *    last-known account_status (authProfileService.getCurrentProfile()) to
 *    pick the right copy, and fall back further to a generic message if
 *    that's also inconclusive (i.e. don't misattribute an unrelated RLS
 *    failure to account status).
 */
import { authProfileService } from '../services/auth-profile-service';

export interface AccountStatusErrorMessage {
  title: string;
  message: string;
}

const BANNED_MESSAGE: AccountStatusErrorMessage = {
  title: 'Account Banned',
  message:
    'Your account has been permanently banned for violating our community guidelines. This action cannot be undone. Contact support if you believe this is an error.',
};

const SUSPENDED_MESSAGE: AccountStatusErrorMessage = {
  title: 'Account Suspended',
  message:
    'Your account is temporarily suspended pending review. You can appeal this decision by contacting support.',
};

function getErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return String(error);
}

function isRlsViolation(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof error === 'object' && error ? (error as any).code : undefined;
  return code === '42501' || message.includes('row-level security policy');
}

/**
 * Returns distinct copy for a banned/suspended account-status failure, or
 * null if the error isn't one of those (so callers can fall back to their
 * normal generic error handling).
 */
export function getAccountStatusErrorMessage(error: unknown): AccountStatusErrorMessage | null {
  const message = getErrorMessage(error);

  if (message.includes('account_banned')) return BANNED_MESSAGE;
  if (message.includes('account_suspended') || message.includes('account_inactive')) {
    return SUSPENDED_MESSAGE;
  }

  // Generic RLS rejection (direct-insert paths) -- can't tell the reason
  // from the error text, so only attribute it to account status if the
  // caller's own last-known profile confirms they're actually
  // suspended/banned. Otherwise this is very likely an unrelated RLS
  // failure (e.g. a genuine ownership/ID mismatch) and should NOT be
  // mislabeled as an account-status issue.
  if (isRlsViolation(error)) {
    const status = authProfileService.getCurrentProfile()?.account_status;
    if (status === 'banned') return BANNED_MESSAGE;
    if (status === 'suspended') return SUSPENDED_MESSAGE;
  }

  return null;
}
