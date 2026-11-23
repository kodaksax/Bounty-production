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
   * Q-PRD-2: hours of silence before "You haven't heard from {helper}".
   * DESIGN-GAP: not implemented. The handoff's E.2 id is also used for the
   * prohibited auto-confirming payment countdown (4b); neither is built, and
   * the two are not mapped onto each other.
   */
  silenceThresholdHours: null as number | null,
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
