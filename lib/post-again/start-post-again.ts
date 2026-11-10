import { readBountyDraftInProgress, replaceBountyDraftForUser } from 'app/hooks/useBountyDraft';
import { resumeStepForDraft } from 'app/screens/CreateBounty/postStepFields';
import { buildDraftFromBounty, PostAgainError } from 'app/services/postAgain';
import { Alert } from 'react-native';
import { analyticsService } from '../services/analytics-service';
import { emitPostAgainRequest } from './handoff';
import type { PostAgainSource } from './sources';

export { isPostAgainSource, POST_AGAIN_SOURCES, type PostAgainSource } from './sources';

/**
 * 'opened': the draft is saved and the shell was asked to open the composer.
 * 'kept_draft': the poster chose to keep an unfinished post; nothing changed.
 * 'failed': the bounty couldn't be copied (not theirs, gone, offline); the
 * poster has been told why.
 */
export type StartPostAgainResult = 'opened' | 'kept_draft' | 'failed';

export interface StartPostAgainOptions {
  bountyId: string;
  userId: string | null | undefined;
  source: PostAgainSource;
  /** Asks whether to replace an unfinished draft. Resolves true to replace. */
  confirmReplace?: (existingTitle: string, newTitle: string) => Promise<boolean>;
  /** Tells the poster why it failed. */
  showError?: (title: string, message: string) => void;
}

export function confirmReplaceDraft(existingTitle: string, newTitle: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Replace your unfinished post?',
      `You have an unfinished post, "${existingTitle.trim()}". Posting "${newTitle.trim()}" again will replace it.`,
      [
        { text: 'Keep my draft', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Replace it', style: 'destructive', onPress: () => resolve(true) },
      ],
      // Android: tapping outside the dialog keeps the draft.
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

function defaultShowError(title: string, message: string) {
  Alert.alert(title, message);
}

// A second tap while the first is still loading is ignored, so a double tap
// can't ask the replace question twice.
const inFlight = new Set<string>();

/**
 * One tap on "Post again": copy `bountyId` into the composer's draft and open
 * the composer on its last step, with every field filled in, ready to review
 * the price and post. Asks first if an unfinished draft would be replaced.
 */
export async function startPostAgain({
  bountyId,
  userId,
  source,
  confirmReplace = confirmReplaceDraft,
  showError = defaultShowError,
}: StartPostAgainOptions): Promise<StartPostAgainResult> {
  if (inFlight.has(bountyId)) return 'failed';
  analyticsService.trackEvent('post_again_tapped', { source, bounty_id: bountyId });
  if (!userId) {
    showError("Can't post this again", 'Sign in to post this again.');
    return 'failed';
  }

  inFlight.add(bountyId);
  try {
    let draft;
    try {
      draft = await buildDraftFromBounty(bountyId, userId);
    } catch (error) {
      const message =
        error instanceof PostAgainError
          ? error.message
          : "We couldn't load that bounty. Check your connection and try again.";
      showError("Can't post this again", message);
      return 'failed';
    }

    const existing = await readBountyDraftInProgress(userId);
    if (existing) {
      const replace = await confirmReplace(existing.title, draft.title);
      if (!replace) return 'kept_draft';
    }

    await replaceBountyDraftForUser(userId, draft);
    emitPostAgainRequest({
      sourceBountyId: bountyId,
      userId,
      // The last step for a complete draft. An older bounty saved before
      // exact addresses were kept has no pin, so it opens on Location instead
      // of publishing a job nobody nearby can be matched to.
      startStep: resumeStepForDraft(draft),
    });
    return 'opened';
  } finally {
    inFlight.delete(bountyId);
  }
}
