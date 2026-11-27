/**
 * Ops and policy answers the Focus-first copy depends on (handoff tag "O").
 * None of them is decided yet, so none is shown to users.
 *
 * Where the poster handoff draws placeholder copy for an undecided answer
 * (J.2's refund destination and timing, the support reply time), the exact
 * designed wording lives here. It renders only when `showPlaceholders` is
 * switched on for a design review; in the app the unresolved sentence is left
 * out rather than shown with "{braces}" or filled with a made-up commitment.
 * Filling in a value here (after ops/policy sign-off) makes the sentence real.
 */
export const FOCUS_POLICY = {
  /** Design-review switch for the handoff's {placeholder} copy. Off in the app. */
  showPlaceholders: false,
  /** Q-PAY-1: where money goes if a dispute returns it to the poster. */
  disputeRefundDestination: null as string | null,
  /** Q-PAY-3: how long that takes. */
  disputeTimeframe: null as string | null,
  /** Q-OPS-2: how quickly support replies. */
  supportReplyTime: null as string | null,
  /**
   * Q-PRD-2: hours of silence before "You haven't heard from {helper}" (E.2).
   * Decided 2026-11-25: 48. Silence counts from the later of the hire and the
   * helper's last message they sent themselves (lib/utils/hired-phase.ts);
   * system cards and the poster's own messages never reset it. null turns
   * E.2 off. The handoff reuses the E.2 id for the quick confirm (4b), which
   * is a different screen: see quickConfirmSeconds.
   * TODO(E): featuring the job on My Jobs when it goes quiet needs the sender
   * of the last message on the conversation list.
   */
  silenceThresholdHours: 48 as number | null,
  /**
   * Q-ENG-1: whether the people not chosen are told when someone is chosen.
   * Until that notification exists (prompt 7), the hired stage says only that
   * their offers are closed; true adds "and they've been told".
   */
  othersToldOnHire: false,
  /**
   * 4b: seconds before the quick confirm hires, and charges the balance or
   * saved card, by itself. Built at the product owner's direction (2026-11-23);
   * the handoff marks auto-confirming a payment as needing policy sign-off.
   * null turns 4b off and every hire uses screen E.
   */
  quickConfirmSeconds: 7 as number | null,
};

/** The handoff's wording for J.2, with its placeholders. */
export const J2_MONEY_PLACEHOLDER = 'If money comes back to you: {refund destination}, within {timeframe}.';
export const REPLY_TIME_PLACEHOLDER = "We'll reply by email within {reply time}.";

/**
 * Stage B's nudge ("A clear photo and a few details can help people decide")
 * appears this long after posting with no offers. The handoff's proposal,
 * pending product validation.
 */
export const NUDGE_AFTER_HOURS = 48;
