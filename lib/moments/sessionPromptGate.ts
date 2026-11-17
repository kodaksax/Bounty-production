/**
 * One prompt per app session, and none before Home shows the user's jobs.
 *
 * Every sheet that asks something of the user on its own (MomentSheet, the
 * app-open "your draft is waiting" sheet) claims this gate before it opens:
 *
 *   waiting  Home hasn't loaded her jobs and their offers yet (BountyFeed
 *            reports that), or this session isn't known yet. Nothing opens.
 *   open     Nothing has been shown this session and no job needs her. The
 *            first claim wins and closes the gate.
 *   closed   A prompt was shown this session, or one of her jobs needs her
 *            (lib/poster-jobs/needs-you.ts). Nothing more until next session.
 *
 * "Session" is MomentsProvider's sessionCount (a 30-minute gap, the same
 * boundary as profiles.last_session_at). The closed state is persisted per
 * user and session, so killing and reopening the app inside the same
 * session doesn't buy another prompt.
 *
 * A module store rather than React context because the draft sheet's hook
 * runs in the tab shell above MomentsProvider. Pure state + AsyncStorage, no
 * Supabase.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type PromptGateState = 'waiting' | 'open' | 'closed';
export type PromptClaimant = 'moment' | 'resume_draft';
export type PromptCloseReason = PromptClaimant | 'jobs_need_you';

const CLOSED_SESSION_KEY_PREFIX = '@bounty_prompt_gate_closed_session:';

interface UserGate {
  homeJobsReady: boolean;
  session: number | null;
  closedForSession: number | null;
  closedBy: PromptCloseReason | null;
}

const gates = new Map<string, UserGate>();
const listeners = new Set<() => void>();
/** Session reads in flight, so concurrent begins for one user share one read. */
const pendingBegins = new Map<string, Promise<void>>();

function gateFor(userId: string): UserGate {
  let gate = gates.get(userId);
  if (!gate) {
    gate = { homeJobsReady: false, session: null, closedForSession: null, closedBy: null };
    gates.set(userId, gate);
  }
  return gate;
}

function notify() {
  // Copy first: a listener may unsubscribe (or claim) while we iterate.
  [...listeners].forEach(listener => listener());
}

function close(userId: string, gate: UserGate, reason: PromptCloseReason) {
  if (gate.session == null || gate.closedForSession === gate.session) return;
  gate.closedForSession = gate.session;
  gate.closedBy = reason;
  AsyncStorage.setItem(CLOSED_SESSION_KEY_PREFIX + userId, String(gate.session)).catch(() => {});
}

export function promptGateState(userId: string | null | undefined): PromptGateState {
  if (!userId) return 'waiting';
  const gate = gates.get(userId);
  if (!gate || gate.session == null || !gate.homeJobsReady) return 'waiting';
  return gate.closedForSession === gate.session ? 'closed' : 'open';
}

/** Why the gate closed this session, for analytics. */
export function promptGateClosedBy(userId: string): PromptCloseReason | null {
  const gate = gates.get(userId);
  return gate && gate.closedForSession === gate.session ? gate.closedBy : null;
}

/**
 * MomentsProvider calls this once the session count is known. A new session
 * re-opens the gate unless this session was already closed on this device.
 */
export function beginPromptSession(userId: string, session: number): Promise<void> {
  const gate = gateFor(userId);
  if (session <= 0 || gate.session === session) return Promise.resolve();
  const inFlight = pendingBegins.get(`${userId}:${session}`);
  if (inFlight) return inFlight;
  const begin = (async () => {
    let persisted: number | null = null;
    try {
      const raw = await AsyncStorage.getItem(CLOSED_SESSION_KEY_PREFIX + userId);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      persisted = Number.isFinite(parsed) ? parsed : null;
    } catch {
      persisted = null;
    }
    const current = gateFor(userId);
    // A later session may have begun while we read; never move backwards.
    if (current.session != null && current.session >= session) return;
    // A later session in the same run (back after a 30-minute gap) waits for
    // Home to load her jobs again rather than trusting the last report.
    if (current.session != null) current.homeJobsReady = false;
    current.session = session;
    if (persisted === session) {
      current.closedForSession = session;
      current.closedBy = current.closedBy ?? 'moment';
    } else {
      current.closedForSession = null;
      current.closedBy = null;
    }
    applyPendingHold(userId);
    notify();
  })().finally(() => pendingBegins.delete(`${userId}:${session}`));
  pendingBegins.set(`${userId}:${session}`, begin);
  return begin;
}

/** BountyFeed: her jobs are being (re)loaded for a fresh sign-in or mount. */
export function markHomeJobsLoading(userId: string): void {
  const gate = gateFor(userId);
  if (!gate.homeJobsReady) return;
  gate.homeJobsReady = false;
  notify();
}

/**
 * BountyFeed: her jobs and their offers have loaded. Report only a complete
 * read; on a failed read keep waiting, since "unknown" must not mean "nothing
 * needs you". `needsYou` closes the gate for the rest of this session.
 */
export function reportHomeJobs(userId: string, result: { needsYou: boolean }): void {
  const gate = gateFor(userId);
  const wasReady = gate.homeJobsReady;
  const wasClosed = gate.closedForSession != null && gate.closedForSession === gate.session;
  gate.homeJobsReady = true;
  if (result.needsYou) {
    if (gate.session == null) {
      // Session not known yet: remember the hold and apply it when it begins.
      pendingHolds.add(userId);
    } else {
      close(userId, gate, 'jobs_need_you');
    }
  }
  const isClosed = gate.closedForSession != null && gate.closedForSession === gate.session;
  if (!wasReady || wasClosed !== isClosed) notify();
}

/** Holds reported before the session was known. */
const pendingHolds = new Set<string>();

/**
 * Claim the session's one prompt. True means show it now; false means don't.
 * Synchronous, so two claimants racing in one tick can't both win.
 */
export function tryClaimPrompt(userId: string | null | undefined, claimant: PromptClaimant): boolean {
  if (!userId) return false;
  applyPendingHold(userId);
  if (promptGateState(userId) !== 'open') return false;
  close(userId, gateFor(userId), claimant);
  notify();
  return true;
}

function applyPendingHold(userId: string) {
  if (!pendingHolds.has(userId)) return;
  const gate = gateFor(userId);
  if (gate.session == null) return;
  pendingHolds.delete(userId);
  close(userId, gate, 'jobs_need_you');
}

export function subscribePromptGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Waits until the gate has decided, then claims it in the same tick if it's
 * open and `stillWanted()` says the claimant still wants to show. Resolves
 * true when the claim won. Claiming inside the gate's own notification is
 * what lets the draft sheet (which is waiting here) go before a moment, which
 * only re-evaluates on React's next render.
 */
export function claimPromptWhenDecided(
  userId: string,
  claimant: PromptClaimant,
  stillWanted: () => boolean
): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const attempt = (): boolean => {
      if (done) return true;
      applyPendingHold(userId);
      const state = promptGateState(userId);
      if (state === 'waiting') return false;
      done = true;
      unsubscribe?.();
      resolve(state === 'open' && stillWanted() && tryClaimPrompt(userId, claimant));
      return true;
    };
    if (attempt()) return;
    unsubscribe = subscribePromptGate(() => {
      attempt();
    });
  });
}

/** React view of the gate for one user. */
export function usePromptGateState(userId: string | null | undefined): PromptGateState {
  const [state, setState] = useState<PromptGateState>(() => promptGateState(userId));
  useEffect(() => {
    const update = () => {
      if (userId) applyPendingHold(userId);
      setState(promptGateState(userId));
    };
    update();
    return subscribePromptGate(update);
  }, [userId]);
  return state;
}

/** Test-only. */
export function resetPromptGateForTests(): void {
  gates.clear();
  listeners.clear();
  pendingBegins.clear();
  pendingHolds.clear();
}
