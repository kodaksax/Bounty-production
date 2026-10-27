/**
 * The app-open "your draft is waiting" prompt.
 *
 * Who sees it: a poster whose last exit from the composer was a tab switch
 * with a draft still unfinished (lib/storage/abandoned-draft.ts, set by
 * CreateBountyFlow). It sits alongside the Post tab's dot, the in-composer
 * "Continue your post" banner and the 24h local reminder.
 *
 * "App open" is a cold start, or a return to the foreground after at least
 * SESSION_GAP_MS in the background (the 30-minute session gap used across the
 * app's analytics). A poster who lands on the Post tab never sees it — the
 * composer already offers the resume there.
 *
 * Observed through post_resume_prompt with surface 'app_open' (action shown /
 * continued / dismissed), then bounty_published.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { readBountyDraftInProgress } from 'app/hooks/useBountyDraft';
import { analyticsService } from '../../lib/services/analytics-service';
import { clearDraftAbandoned, getDraftAbandonedAt } from '../../lib/storage/abandoned-draft';

/** Background time after which coming back counts as a new app open. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** The tab-shell key for the Post tab (the bounty composer). */
const POST_SCREEN = 'postings';

const PROMPT_SURFACE = 'app_open';

// App opens are counted once per JS process, not per hook instance: the tab
// shell can be mounted twice (see MomentsProvider's liveMomentsInstance), and
// both copies must agree on which open they are looking at — and only one of
// them may present the prompt for it.
let openSeq = 0;
let backgroundedAt: number | null = null;
let appStateSubscribed = false;
let claimedOpen: string | null = null;
const openListeners = new Set<() => void>();

function subscribeToAppOpens(listener: () => void): () => void {
  if (!appStateSubscribed) {
    appStateSubscribed = true;
    try {
      AppState.addEventListener('change', next => {
        if (next === 'background') {
          backgroundedAt = Date.now();
        } else if (next === 'active') {
          const away = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
          backgroundedAt = null;
          if (away >= SESSION_GAP_MS) {
            openSeq += 1;
            openListeners.forEach(notify => notify());
          }
        }
      });
    } catch {
      // AppState may be unavailable in some test environments; cold starts
      // still count.
    }
  }
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export interface ResumeComposerPromptState {
  /** The waiting draft's title while the prompt is up, else null. */
  draftTitle: string | null;
  /** Primary CTA — clears the flag; the caller opens the composer. */
  onContinue: () => void;
  /** "Not now" — clears the flag so the prompt doesn't come back. */
  onDismiss: () => void;
}

/**
 * Drives the app-open prompt for `userId`. `activeScreen` is the tab shell's
 * current tab; the prompt is skipped when the poster already landed on Post.
 */
export function useResumeComposerPrompt(
  userId: string | undefined,
  activeScreen: string
): ResumeComposerPromptState {
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [open, setOpen] = useState(openSeq);
  const activeScreenRef = useRef(activeScreen);
  activeScreenRef.current = activeScreen;

  useEffect(() => subscribeToAppOpens(() => setOpen(openSeq)), []);

  useEffect(() => {
    setDraftTitle(null);
    if (!userId) return;
    const openKey = `${userId}:${open}`;
    if (claimedOpen === openKey) return;
    claimedOpen = openKey;

    let cancelled = false;
    (async () => {
      if (activeScreenRef.current === POST_SCREEN) return;
      if ((await getDraftAbandonedAt(userId)) === null) return;
      const draft = await readBountyDraftInProgress(userId);
      if (!draft) {
        // The draft went away without passing through clearDraft (a storage
        // wipe can do that). Nothing left to offer.
        void clearDraftAbandoned(userId);
        return;
      }
      if (cancelled || activeScreenRef.current === POST_SCREEN) return;
      setDraftTitle(draft.title.trim());
      analyticsService.trackEvent('post_resume_prompt', {
        surface: PROMPT_SURFACE,
        action: 'shown',
        to_step: 1,
        to_step_name: 'Task',
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, open]);

  const answer = useCallback(
    (action: 'continued' | 'dismissed') => {
      if (draftTitle === null || !userId) return;
      setDraftTitle(null);
      void clearDraftAbandoned(userId);
      analyticsService.trackEvent('post_resume_prompt', {
        surface: PROMPT_SURFACE,
        action,
        to_step: 1,
        to_step_name: 'Task',
      });
    },
    [draftTitle, userId]
  );

  const onContinue = useCallback(() => answer('continued'), [answer]);
  const onDismiss = useCallback(() => answer('dismissed'), [answer]);

  return { draftTitle, onContinue, onDismiss };
}

/** Test seam — resets the module-level open tracking between tests. */
export function __resetResumeComposerPromptForTests(): void {
  openSeq = 0;
  backgroundedAt = null;
  appStateSubscribed = false;
  claimedOpen = null;
}
