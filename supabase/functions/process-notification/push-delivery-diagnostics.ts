// Diagnostics for push fan-out.
//
// NOTE: this module is mirrored by an inlined copy inside index.ts, following
// the same convention as ./recipients.ts — the Supabase bundler comment at the
// top of index.ts explains why. Keep the two copies in sync by hand.

/** Cap on how many recipient ids a single log line may carry. */
export const MAX_LOGGED_RECIPIENTS = 20;

export interface ZeroTokenWarning {
  notificationId: string;
  notificationType: string;
  /** How many recipients wanted a push and resolved to no deliverable token. */
  recipientCount: number;
  /** Bounded sample of those recipients, for looking the accounts up. */
  recipients: string[];
  /** True when `recipients` is a truncated view of `recipientCount`. */
  truncated: boolean;
}

/**
 * Build the payload for "this notification resolved to zero push tokens".
 *
 * Fan-out notifications (the radius / zip / service-area triggers) can address
 * hundreds of profiles at once, so the recipient list is capped rather than
 * dumped whole — an unbounded log line is its own outage.
 */
export function buildZeroTokenWarning(params: {
  notificationId: unknown;
  notificationType: unknown;
  pushRecipients: string[];
}): ZeroTokenWarning {
  const recipients = params.pushRecipients ?? [];
  return {
    notificationId: String(params.notificationId ?? 'unknown'),
    notificationType: String(params.notificationType || 'unknown'),
    recipientCount: recipients.length,
    recipients: recipients.slice(0, MAX_LOGGED_RECIPIENTS),
    truncated: recipients.length > MAX_LOGGED_RECIPIENTS,
  };
}
