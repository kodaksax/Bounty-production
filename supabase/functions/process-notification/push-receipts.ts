// Helper for interpreting the Expo Push API response and identifying push
// tokens that are no longer valid, so they can be pruned/disabled.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports.

// Expo ticket errors that mean THIS token will never deliver again, so it is
// deleted. Only `DeviceNotRegistered` ("uninstalled / permission revoked")
// qualifies.
//
// `InvalidCredentials` and `MismatchSenderId` are deliberately NOT here: they
// describe the project's push credentials (missing/wrong FCM key, wrong
// sender), so they fail every token on that platform at once. On 2026-09-25
// Expo had no FCM credentials at all and every Android push failed with one of
// them — pruning on those codes would have deleted every Android poster's
// token, and posters who don't reopen the app would never re-register.
const PERMANENT_TOKEN_ERRORS = new Set(['DeviceNotRegistered']);

/**
 * Given the ordered list of tokens that were sent in a single Expo push chunk
 * and the parsed JSON body returned by the Expo Push API, return the subset of
 * tokens whose tickets reported a permanent delivery error.
 *
 * Expo returns `{ data: Ticket[] }` where each ticket corresponds positionally
 * to the message that was sent. A ticket with `status: 'error'` and
 * `details.error: 'DeviceNotRegistered'` means the token is dead.
 */
export function extractInvalidTokens(chunkTokens: string[], expoResponseBody: unknown): string[] {
  const tickets = (expoResponseBody as { data?: unknown })?.data;
  if (!Array.isArray(tickets)) return [];

  const invalid: string[] = [];
  tickets.forEach((ticket: unknown, index: number) => {
    const t = ticket as { status?: string; details?: { error?: string } } | null;
    if (t && t.status === 'error') {
      const errorCode = t.details?.error;
      if (errorCode && PERMANENT_TOKEN_ERRORS.has(errorCode)) {
        const token = chunkTokens[index];
        if (token) invalid.push(token);
      }
    }
  });
  return invalid;
}

export default extractInvalidTokens;
