/**
 * Remembers that a poster left the composer by switching tabs with a draft
 * still unfinished — the trigger for the app-open resume prompt
 * (app/hooks/useResumeComposerPrompt.ts).
 *
 * Set when CreateBountyFlow reports post_step_abandoned with exit_method
 * 'tab' and an in-progress draft. Cleared when the draft is published or
 * cleared (useBountyDraft), on sign-out, and when the poster answers the
 * prompt. Per user and on this device only, like the draft itself.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ABANDONED_DRAFT_KEY_PREFIX = '@bounty_abandoned_draft:';

function keyFor(userId: string): string {
  return `${ABANDONED_DRAFT_KEY_PREFIX}${userId}`;
}

/** Best-effort; a failed write only means no prompt on the next open. */
export async function markDraftAbandoned(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ at: Date.now() }));
  } catch {
    // ignore
  }
}

export async function clearDraftAbandoned(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // ignore
  }
}

/** When the draft was flagged (ms), or null when it isn't. Never throws. */
export async function getDraftAbandonedAt(userId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const at = Number(JSON.parse(raw)?.at);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}
