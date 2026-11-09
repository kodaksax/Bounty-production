/**
 * "Post it as a bounty" from Search (app/tabs/search.tsx).
 *
 * Posters type the job they need done into the Home search box instead of
 * the composer ("Remove home trash to apt."). The search is a title/
 * description substring match, so a sentence almost never finds anything,
 * and the screen used to end there. When a query reads like a job request,
 * Search offers to turn it into a bounty, pre-filled.
 *
 * Everything here is pure so the rules can be tested without the screen.
 */

import { validateTitle } from './bounty-validation';

/** The composer's `entry_point` for posts started from this card. */
export const SEARCH_FALLBACK_ENTRY_POINT = 'search_fallback';

/** A query needs at least this many words to read as a job request. */
export const SEARCH_POST_MIN_WORDS = 3;

/** Same ceiling validateTitle enforces, so a capped query always passes it. */
export const SEARCH_POST_TITLE_MAX = 120;

// Any character that is not ASCII punctuation, so letters and digits in every
// script count. (Written out rather than as \p{L}, which not every JS engine
// the app ships on is guaranteed to support.)
const WORD_CHAR = /[^!-/:-@[-`{-~]/;

/** Words with at least one letter or digit, so "- - -" is not three words. */
export function countQueryWords(query: string | null | undefined): number {
  return (query ?? '')
    .trim()
    .split(/\s+/)
    .filter((token) => WORD_CHAR.test(token)).length;
}

/**
 * The draft title a query becomes: trimmed, inner whitespace collapsed (a
 * pasted query can carry newlines or tabs), capped at 120 characters.
 */
export function titleFromSearchQuery(query: string | null | undefined): string {
  return (query ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_POST_TITLE_MAX)
    .trimEnd();
}

/**
 * Whether Search should offer to post this query: three or more words, and
 * a title the composer would accept as-is. Returns the title to post, or
 * null when the card should stay hidden.
 */
export function postableTitleFromQuery(query: string | null | undefined): string | null {
  if (countQueryWords(query) < SEARCH_POST_MIN_WORDS) return null;
  const title = titleFromSearchQuery(query);
  return validateTitle(title) === null ? title : null;
}

/**
 * Props for `search_post_cta_shown` / `search_post_cta_tapped`. Built from
 * the query's length only, so no caller can pass the text through by
 * accident: what the poster typed may hold an address or a phone number.
 */
export function searchPostCtaProps(query: string, hadZeroResults: boolean) {
  return {
    query_length: query.trim().length,
    had_zero_results: hadZeroResults,
    entry_point: SEARCH_FALLBACK_ENTRY_POINT,
  };
}

// ── Typing-paced debounce ──────────────────────────────────────────────────
//
// Search used a fixed 300 ms trailing debounce, which only collapses
// keystrokes that land less than 300 ms apart. The poster this card was
// built for typed about one key every 580 ms (360-1,150 ms gaps), so every
// keystroke still sent its own query: 34 in 27 seconds for one sentence. The
// wait now stretches to the typist's own pace: 300 ms for anyone typing
// quickly, up to 1.2 s for someone typing a key a second.

export const SEARCH_DEBOUNCE_BASE_MS = 300;
export const SEARCH_DEBOUNCE_MAX_MS = 1200;
/** Gaps longer than this are pauses, not typing pace. */
export const TYPING_GAP_IGNORE_MS = 2000;
/** How many recent keystroke gaps the pace is judged on. */
export const TYPING_PACE_WINDOW = 5;
/** Wait this multiple of the typist's median gap before searching. */
export const TYPING_PACE_FACTOR = 1.5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How long to wait after the latest keystroke before searching, given the
 * gaps (ms) between the poster's recent keystrokes, oldest first.
 */
export function searchDebounceMs(recentGapsMs: readonly number[]): number {
  const gaps = recentGapsMs
    .filter((gap) => gap > 0 && gap <= TYPING_GAP_IGNORE_MS)
    .slice(-TYPING_PACE_WINDOW);
  // One gap is not a pace yet.
  if (gaps.length < 2) return SEARCH_DEBOUNCE_BASE_MS;
  const paced = Math.round(median(gaps) * TYPING_PACE_FACTOR);
  return Math.min(SEARCH_DEBOUNCE_MAX_MS, Math.max(SEARCH_DEBOUNCE_BASE_MS, paced));
}
