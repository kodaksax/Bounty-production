/**
 * Where a sign-in may send the user afterwards, from the `redirect_to` param a
 * signed-out email link put there. Only the email destinations are honoured,
 * each rebuilt from a strict allow-list so this can't become an open redirect:
 *   - the poster dashboard handoff (/manage/?bounty=…, manage-route.ts)
 *   - Post again (/bounty/<id>/post-again, post-again-link.ts)
 */

import { safeManageRedirect } from './manage-route';
import { safePostAgainRedirect } from './post-again-link';

export function safePostLoginRedirect(value: unknown): string | null {
  return safeManageRedirect(value) ?? safePostAgainRedirect(value);
}
