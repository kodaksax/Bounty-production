/**
 * Asks someone who signed up to hire whether they want to earn as well, the
 * first time they apply for a bounty. It's only a question: the application
 * continues whichever button they press, and profiles.primary_role is left
 * alone.
 *
 * Once per user on each device, since there's no column to record it in.
 * Skipped on web, where Alert has no buttons and would never answer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import { analyticsService } from '../services/analytics-service';
import { authProfileService } from '../services/auth-profile-service';
import { posterHomeStrings } from '../strings/posterHome';

const seenKey = (userId: string) => `@bounty_poster_apply_prompt_seen:${userId}`;

// Covers a second tap during the storage read, and a device whose storage write fails.
const askedThisRun = new Set<string>();

export type PosterApplyChoice = 'apply_once' | 'earn_too';

interface AskPosterBeforeApplyingOptions {
  /** The `poster-home` flag. */
  enabled: boolean;
  userId: string;
  bountyId: string;
  /** Which apply path this came from. */
  surface: 'modal' | 'public_route';
}

/** Resolves when the applicant may continue, immediately if there's nothing to ask. */
export async function askPosterBeforeApplying({
  enabled,
  userId,
  bountyId,
  surface,
}: AskPosterBeforeApplyingOptions): Promise<void> {
  if (!enabled || Platform.OS === 'web') return;
  // Read from here because updateProfile drops primary_role from the in-memory
  // profile, which would miss someone applying straight after onboarding.
  if (authProfileService.getPrimaryRoleForAnalytics() !== 'poster') return;
  if (askedThisRun.has(userId)) return;
  askedThisRun.add(userId);

  try {
    if (await AsyncStorage.getItem(seenKey(userId))) return;
  } catch {
    // Can't tell whether they've been asked, so don't risk asking twice.
    return;
  }
  AsyncStorage.setItem(seenKey(userId), new Date().toISOString()).catch(() => {
    /* best-effort: askedThisRun still covers this run */
  });

  analyticsService.trackEvent('poster_apply_prompt_shown', { bounty_id: bountyId, surface });

  const strings = posterHomeStrings.applyPrompt;
  await new Promise<void>(resolve => {
    const answer = (choice: PosterApplyChoice) => () => {
      analyticsService.trackEvent('poster_apply_prompt_answered', {
        bounty_id: bountyId,
        surface,
        choice,
      });
      resolve();
    };
    Alert.alert(
      strings.title,
      strings.body,
      [
        { text: strings.applyOnce, onPress: answer('apply_once') },
        { text: strings.earnToo, onPress: answer('earn_too') },
      ],
      { cancelable: false }
    );
  });
}

/** Test seam. */
export function __resetPosterApplyPromptForTests(): void {
  askedThisRun.clear();
}
