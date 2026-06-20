// Helper for interpreting the Expo Push API response and identifying push
// tokens that are no longer valid, so they can be pruned/disabled.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports.

// Expo ticket errors that indicate the token will never deliver again and
// should be disabled. `DeviceNotRegistered` is the canonical "uninstalled /
// permission revoked" signal.
const PERMANENT_TOKEN_ERRORS = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
]);

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
