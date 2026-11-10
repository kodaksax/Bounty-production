/**
 * Hands a "Post again" from whichever surface started it (Home card, My
 * Bounties, the bounty dashboard, the email link) to the tab shell
 * (app/tabs/bounty-app.tsx), which owns the composer.
 *
 * By the time a request is emitted the draft is already in storage
 * (startPostAgain). The shell's job is to remount the composer so it reads that
 * draft, open it on `startStep`, and switch to the Post tab.
 *
 * A shell that is mounted hears the request at once. One that isn't yet (a cold
 * start from the email link) takes it when it mounts. A request is for one
 * user and expires, so a shell mounted much later (after a sign-out, say)
 * never replays it.
 */

export interface PostAgainRequest {
  sourceBountyId: string;
  userId: string;
  /** Composer step to open on: 3 (Compensation) for a complete draft. */
  startStep: 1 | 2 | 3;
  nonce: number;
  createdAt: number;
}

/** How long an unclaimed request stays valid. Covers a cold start, not a later session. */
export const POST_AGAIN_REQUEST_TTL_MS = 2 * 60 * 1000;

type Listener = (request: PostAgainRequest) => void;

let pending: PostAgainRequest | null = null;
let nextNonce = 1;
const listeners = new Set<Listener>();

export function emitPostAgainRequest(
  request: Omit<PostAgainRequest, 'nonce' | 'createdAt'>,
  now: number = Date.now()
): PostAgainRequest {
  const full: PostAgainRequest = { ...request, nonce: nextNonce++, createdAt: now };
  pending = full;
  listeners.forEach((listener) => listener(full));
  return full;
}

/**
 * The waiting request for `userId`, cleared as it is returned. Null when there
 * is none, it is for someone else, or it has expired.
 */
export function takePostAgainRequest(userId: string, now: number = Date.now()): PostAgainRequest | null {
  const request = pending;
  if (!request) return null;
  if (now - request.createdAt > POST_AGAIN_REQUEST_TTL_MS) {
    pending = null;
    return null;
  }
  if (request.userId !== userId) return null;
  pending = null;
  return request;
}

export function subscribePostAgainRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. */
export function __resetPostAgainHandoffForTests(): void {
  pending = null;
  nextNonce = 1;
  listeners.clear();
}
