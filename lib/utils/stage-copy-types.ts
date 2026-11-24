/**
 * Shapes shared by the Focus-first stage mappers (poster-stage-copy.ts and
 * hunter-stage-copy.ts). A mapper turns a job's resolved lifecycle into what
 * its workspace shows; the screen only binds each action key to a handler.
 */

/**
 * The money line's kind, as the handoff names it (`mkind`):
 * - none: nothing is held.
 * - held: Bounty holds the poster's money until they approve.
 * - released: released to the hunter's Bounty balance. Not "paid to a bank".
 * - warn: something about the money needs care (a payment still confirming).
 * - ph: an ops/policy answer the copy depends on is not decided yet.
 */
export type MoneyKind = 'none' | 'held' | 'released' | 'warn' | 'ph';

export interface StageMoney {
  kind: MoneyKind;
  text: string;
}

export type StageButtonKind = 'primary' | 'quiet' | 'secondary' | 'neutral' | 'text' | 'muted' | 'danger';

export interface StageAction<K extends string = string> {
  key: K;
  label: string;
  kind: StageButtonKind;
  /** MaterialIcons glyph name. */
  icon?: string;
}

export interface StageViewModel<K extends string = string> {
  /** The handoff's screen id ("C", "H.7"): used in tests and analytics. */
  screenId: string;
  /** Position on the five-step bar. */
  step: 1 | 2 | 3 | 4 | 5;
  /** "Step 2 of 5 · Choosing someone to help". */
  stage: string;
  now: string;
  means: string;
  money: StageMoney | null;
  after: string | null;
  /** The one next step, pinned under the thumb. Null when nothing is asked. */
  primary: StageAction<K> | null;
  /** At most two. */
  secondary: StageAction<K>[];
  /** Infrequent or destructive actions, collapsed under "Other options". */
  more: StageAction<K>[];
  /** "More" starts open (H.3: withdrawing is the one thing a hunter can do). */
  moreOpen?: boolean;
}
