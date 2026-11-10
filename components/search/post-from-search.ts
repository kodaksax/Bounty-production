/**
 * What "Post this" on Search's post-it-as-a-bounty card does: put the query
 * in the composer's draft as its title and open the composer on step 1.
 *
 * An unfinished post is never overwritten without asking. The poster is
 * asked "Replace your unfinished post?" and answers Replace or Keep mine.
 * Keep mine opens the composer on the post they already started. Dismissing
 * the question does nothing.
 *
 * The screen-facing pieces (the dialog, opening the composer) are passed in
 * so the sequence can be tested without the Search screen.
 */

import { readBountyDraftInProgress, seedBountyDraftTitle } from 'app/hooks/useBountyDraft';
import { Alert } from 'react-native';
import { requestComposer } from '../../lib/navigation/composer-request';
import { SEARCH_FALLBACK_ENTRY_POINT } from '../../lib/utils/search-post-fallback';

export type DraftReplaceChoice = 'replace' | 'keep' | 'dismiss';

export type PostFromSearchOutcome =
  /** No unfinished post: the query became a new draft. */
  | 'started'
  /** The poster chose Replace. */
  | 'replaced'
  /** The poster chose Keep mine: the composer opened on their own draft. */
  | 'kept'
  /** The poster dismissed the question: nothing changed. */
  | 'dismissed';

export const REPLACE_DRAFT_TITLE = 'Replace your unfinished post?';
export const REPLACE_DRAFT_CONFIRM = 'Replace';
export const REPLACE_DRAFT_KEEP = 'Keep mine';

/** The native "Replace your unfinished post?" dialog. */
export function askReplaceDraft(existingTitle: string, newTitle: string): Promise<DraftReplaceChoice> {
  return new Promise((resolve) => {
    Alert.alert(
      REPLACE_DRAFT_TITLE,
      `You already started “${existingTitle.trim()}”. Replace it with “${newTitle}”?`,
      [
        // Not style 'cancel': the web Alert shim answers a backdrop/Escape
        // dismissal with the cancel button's onPress, and dismissing must not
        // open the composer.
        { text: REPLACE_DRAFT_KEEP, onPress: () => resolve('keep') },
        { text: REPLACE_DRAFT_CONFIRM, style: 'destructive', onPress: () => resolve('replace') },
      ],
      // Android back / tapping outside answers neither.
      { cancelable: true, onDismiss: () => resolve('dismiss') }
    );
  });
}

interface PostFromSearchDeps {
  askReplace?: (existingTitle: string, newTitle: string) => Promise<DraftReplaceChoice>;
  /** Called once the draft is in place; sends the poster to the composer. */
  openComposer?: () => void;
}

export async function postFromSearch(
  userId: string | undefined,
  title: string,
  {
    askReplace = askReplaceDraft,
    openComposer = () => requestComposer(SEARCH_FALLBACK_ENTRY_POINT),
  }: PostFromSearchDeps = {}
): Promise<PostFromSearchOutcome> {
  const existing = await readBountyDraftInProgress(userId);

  // Already this title: nothing to replace, just carry on with it.
  if (existing && existing.title.trim() === title) {
    openComposer();
    return 'kept';
  }

  if (existing) {
    const choice = await askReplace(existing.title, title);
    if (choice === 'dismiss') return 'dismissed';
    if (choice === 'keep') {
      openComposer();
      return 'kept';
    }
    await seedBountyDraftTitle(userId, title, { replaceExisting: true });
    openComposer();
    return 'replaced';
  }

  const seeded = await seedBountyDraftTitle(userId, title);
  // A draft appeared between the read and the write (another device tab, a
  // racing save). Ask rather than overwrite it.
  if (!seeded) return postFromSearch(userId, title, { askReplace, openComposer });
  openComposer();
  return 'started';
}
