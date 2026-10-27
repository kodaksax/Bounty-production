/**
 * The 24h "your draft is waiting" reminder for an unfinished post.
 *
 * A local notification, not a server push: the composer's draft only exists
 * in this device's storage (app/hooks/useBountyDraft.ts), so the server can't
 * tell who has one, and the reminder has to fire on the device that holds it
 * anyway.
 *
 * Lifecycle, driven by useBountyDraft:
 *   - every save of an in-progress draft re-arms it for 24h after that save
 *     (debounced, so a typing burst costs one native call, not one per key);
 *   - publishing, clearing the draft or signing out cancels it;
 *   - once a reminder's time has passed it is never re-armed for the same
 *     draft — one reminder per draft. Clearing the draft resets that.
 *
 * It never prompts for permission. Without it, or with Marketplace push
 * turned off in notification settings, nothing is scheduled.
 *
 * Observed through notification_generated (channels: ['local_push']), once
 * per draft, and notification_opened with notification_type 'draft_reminder'.
 */

import { Platform } from 'react-native';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { resumeStepForDraft } from 'app/screens/CreateBounty/postStepFields';
import { bountyAppTabPath } from '../navigation/bounty-app-tab';
import { capture as posthogCapture } from '../posthog';
import { storage } from '../storage';

// Lazily required, as in notification-service.ts, so importing the draft hook
// never loads a native module at module init.
let Notifications: any = null;
function notificationsModule(): any {
  if (!Notifications) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      Notifications = require('expo-notifications');
    } catch {
      Notifications = null;
    }
  }
  return Notifications;
}

export const DRAFT_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;
export const DRAFT_REMINDER_DEBOUNCE_MS = 3000;
const PREFERENCE_CACHE_MS = 10 * 60 * 1000;
const STATE_KEY_PREFIX = 'bounty-draft-reminder-v1';
// Matches the composer's three steps (CreateBounty/index.tsx TOTAL_STEPS).
const TOTAL_STEPS = 3;

/** One identifier per user, so scheduling again replaces rather than stacks. */
export function draftReminderIdentifier(userId: string): string {
  return `${STATE_KEY_PREFIX}:${userId}`;
}

function stateKey(userId: string): string {
  return `${STATE_KEY_PREFIX}:state:${userId}`;
}

interface ReminderState {
  /** When the scheduled reminder fires (ms). Past means it has gone out. */
  fireAt: number;
}

/** The notification's text and payload for a draft. */
export function draftReminderContent(draft: BountyDraft) {
  const stepsLeft = TOTAL_STEPS - resumeStepForDraft(draft) + 1;
  const title = draft.title.trim();
  return {
    title: 'Your bounty draft is waiting',
    body: `"${title}" is ${stepsLeft} ${stepsLeft === 1 ? 'step' : 'steps'} from going live.`,
    data: { type: 'draft_reminder', deepLinkPath: bountyAppTabPath('postings'), stepsLeft },
  };
}

async function readState(userId: string): Promise<ReminderState | null> {
  try {
    const raw = await storage.getItem(stateKey(userId));
    return raw ? (JSON.parse(raw) as ReminderState) : null;
  } catch {
    return null;
  }
}

async function hasPermission(N: any): Promise<boolean> {
  try {
    const perms = await N.getPermissionsAsync();
    if (perms?.granted || perms?.status === 'granted') return true;
    // iOS provisional authorization still delivers (quietly).
    return perms?.ios?.status === N.IosAuthorizationStatus?.PROVISIONAL;
  } catch {
    return false;
  }
}

// Bumped by every cancel. A schedule that started before a cancel (a
// debounced save still awaiting permission when the poster publishes) checks
// it before writing anything, so it can't re-arm a draft that's gone.
const generations = new Map<string, number>();
const generationOf = (userId: string) => generations.get(userId) ?? 0;

const preferenceCache = new Map<string, { allowed: boolean; at: number }>();

/** Marketplace push, as the poster set it in notification settings. Absent = allow. */
async function marketplacePushAllowed(userId: string, now: number): Promise<boolean> {
  const cached = preferenceCache.get(userId);
  if (cached && now - cached.at < PREFERENCE_CACHE_MS) return cached.allowed;
  try {
    // Required here rather than imported so the draft hook doesn't pull the
    // whole notification service (and supabase) in at module load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { notificationService } = require('./notification-service');
    const prefs: Record<string, boolean> = await notificationService.getChannelPreferences();
    const allowed = prefs['marketplace:push'] !== false;
    preferenceCache.set(userId, { allowed, at: now });
    return allowed;
  } catch {
    return true;
  }
}

/**
 * Arms (or re-arms) the reminder for `draft`, 24h from `now`. Callers pass
 * only an in-progress draft. Resolves without scheduling when it can't or
 * shouldn't: web, no permission, Marketplace push off, or this draft's
 * reminder has already gone out.
 */
export async function scheduleDraftReminder(
  userId: string,
  draft: BountyDraft,
  now: number = Date.now()
): Promise<void> {
  if (Platform.OS === 'web') return;
  const N = notificationsModule();
  if (!N || typeof N.scheduleNotificationAsync !== 'function') return;
  const generation = generationOf(userId);

  const state = await readState(userId);
  if (state && state.fireAt <= now) return;

  if (!(await hasPermission(N))) return;
  if (!(await marketplacePushAllowed(userId, now))) return;
  if (generationOf(userId) !== generation) return;

  const fireAt = now + DRAFT_REMINDER_DELAY_MS;
  const content = draftReminderContent(draft);
  try {
    await N.scheduleNotificationAsync({
      identifier: draftReminderIdentifier(userId),
      content: { title: content.title, body: content.body, data: content.data, sound: true },
      trigger: {
        type: N.SchedulableTriggerInputTypes?.DATE ?? 'date',
        date: new Date(fireAt),
        channelId: 'bounties',
      },
    });
  } catch (error) {
    if (__DEV__) console.warn('[DraftReminder] schedule failed:', error);
    return;
  }
  if (generationOf(userId) !== generation) {
    // Cancelled while scheduling: take back what was just scheduled.
    try {
      await N.cancelScheduledNotificationAsync(draftReminderIdentifier(userId));
    } catch {
      // Best effort; the poster's own cancel already ran.
    }
    return;
  }

  const next: ReminderState = { fireAt };
  await storage.setItem(stateKey(userId), JSON.stringify(next));

  // Once per draft: re-arming after more edits is the same reminder.
  if (!state) {
    posthogCapture('notification_generated', {
      notification_type: 'draft_reminder',
      category: 'marketplace',
      bounty_id: null,
      channels: ['local_push'],
      urgent: false,
      steps_left: content.data.stepsLeft,
    });
  }
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** scheduleDraftReminder after the poster pauses — one call per typing burst. */
export function scheduleDraftReminderSoon(userId: string, draft: BountyDraft): void {
  const existing = pendingTimers.get(userId);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    userId,
    setTimeout(() => {
      pendingTimers.delete(userId);
      void scheduleDraftReminder(userId, draft);
    }, DRAFT_REMINDER_DEBOUNCE_MS)
  );
}

/** Cancels the pending reminder and forgets that one went out. */
export async function cancelDraftReminder(userId: string): Promise<void> {
  generations.set(userId, generationOf(userId) + 1);
  const pending = pendingTimers.get(userId);
  if (pending) {
    clearTimeout(pending);
    pendingTimers.delete(userId);
  }
  await storage.removeItem(stateKey(userId));
  if (Platform.OS === 'web') return;
  const N = notificationsModule();
  if (!N || typeof N.cancelScheduledNotificationAsync !== 'function') return;
  try {
    await N.cancelScheduledNotificationAsync(draftReminderIdentifier(userId));
  } catch {
    // Nothing scheduled, or the module is unavailable — either way, nothing to cancel.
  }
}
