/**
 * Why a bounty UPDATE was refused, in a sentence the poster can act on.
 *
 * bountyService.update used to catch every error and return null, so every
 * caller could only say "update failed" (SBA-10, audit S9). It now throws a
 * BountyUpdateError whose message is one of the sentences below, keeping the
 * server's own code and text on the error for logs.
 *
 * The raised names are the ones the BEFORE UPDATE triggers on public.bounties
 * actually emit on staging and production (checked 2026-10-19):
 *   trg_bounties_enforce_funding_before_work   bounty_amount_locked_by_* etc.
 *   trg_bounties_enforce_posting_policy_on_update  minimum amount, for-honor
 *   trg_bounties_guard_lifecycle               status transitions, assignment
 *   trg_bounties_owner_reference_required      owner reference floor
 *   a00_validate_bounty_requirements           requirements_* (#914)
 * plus the PostgREST / Postgres codes a PATCH through RLS can return.
 */
import { CAPABILITY_UNAVAILABLE } from './capability-service';
import { getAccountStatusErrorMessage } from '../utils/account-status-errors';

export const GENERIC_UPDATE_FAILURE = "Your changes weren't saved. Please try again.";

export class BountyUpdateError extends Error {
  /** Postgres / PostgREST code, when the server sent one. */
  readonly code: string | null;
  /** The server's raw message, for logs. Never shown to the user. */
  readonly serverMessage: string;

  constructor(message: string, code: string | null, serverMessage: string) {
    super(message);
    this.name = 'BountyUpdateError';
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

interface RawError {
  message: string;
  code: string;
  status: number | null;
}

function raw(err: unknown): RawError {
  if (!err) return { message: '', code: '', status: null };
  if (typeof err === 'string') return { message: err, code: '', status: null };
  const e = err as { message?: unknown; code?: unknown; status?: unknown; details?: unknown };
  return {
    message: typeof e.message === 'string' ? e.message : String(err),
    code: typeof e.code === 'string' ? e.code : '',
    status: typeof e.status === 'number' ? e.status : null,
  };
}

function dollars(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `$${value}`;
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

/** Sentences raised for users verbatim (already written for them). */
const USER_FACING_RAISES = [
  /^In-person bounties need a description/,
  /^New accounts can have \d+ open bounties/,
];

/** A bare server identifier such as `bounty_foo_bar` or `x_y: a -> b`. */
const SERVER_CODE = /^[a-z][a-z0-9_]*(:|$)/;

export function describeBountyUpdateError(
  err: unknown,
  opts: { requirements?: boolean } = {}
): string {
  if (err instanceof BountyUpdateError) return err.message;
  const { message, code, status } = raw(err);

  const accountStatus = getAccountStatusErrorMessage(err);
  if (accountStatus) return accountStatus.message;

  // ── Requirements (#914) — same copy as before ────────────────────────────
  if (message.includes('taxonomy_version_changed')) {
    return 'The task catalog changed. Reload and review the task requirements before saving.';
  }
  if (message.includes('requirements_frozen_after_application')) {
    return 'Requirements cannot change after an application or assignment.';
  }
  if (message.includes('too_many_requirements')) return 'That is more requirements than a bounty can have. Remove a few and try again.';
  if (message.includes('duplicate_requirement')) return 'The same requirement is listed twice. Remove the duplicate and try again.';
  if (/invalid_requirement|invalid_requirements/.test(message)) {
    return "One of the task requirements isn't valid any more. Review them and try again.";
  }
  if (message.includes('requirements_owner_only') || message.includes('requirements_metadata_server_controlled')) {
    return 'Only the poster can change these requirements.';
  }

  // ── Schema drift: this build sends a column the server doesn't have ──────
  if (
    /schema cache|column .* does not exist|could not find.*column/i.test(message) ||
    ['42703', 'PGRST204', '42P01'].includes(code)
  ) {
    return opts.requirements
      ? CAPABILITY_UNAVAILABLE
      : "This change isn't supported yet. Update the app and try again.";
  }

  // ── Funding (trg_bounties_enforce_funding_before_work) ───────────────────
  if (message.includes('bounty_amount_locked_by_applications') || message.includes('bounty_honor_flag_locked_by_applications')) {
    return "Hunters have already applied at this reward, so it can't change now. Hire one of them, or cancel this bounty and post a new one.";
  }
  if (message.includes('bounty_amount_locked_by_escrow') || message.includes('bounty_honor_flag_locked_by_escrow')) {
    return "Your payment for this bounty is already held, so the reward can't change. To change it, cancel this bounty for a refund and post a new one.";
  }
  if (message.includes('bounty_id_requirement_locked_by_escrow') || message.includes('bounty_trust_tier_locked_by_escrow')) {
    return "Your payment for this bounty is already held, so who can apply can't change. Cancel and post a new bounty to change it.";
  }
  if (message.includes('bounty_funding_mode_is_immutable') || message.includes('bounty_payment_architecture_version_is_immutable')) {
    return "How this bounty is paid can't change after it's posted.";
  }
  if (message.includes('bounty_not_funded')) {
    return "This bounty hasn't been paid for yet, so work can't start on it.";
  }

  // ── Posting policy (trg_bounties_enforce_posting_policy_on_update) ───────
  const minimum = message.match(/bounty amount (\S+) is below the (\S+) minimum/);
  if (minimum) return `The reward must be at least ${dollars(minimum[2])}.`;
  if (message.includes('for-honor bounties are not currently accepted')) {
    return "For-honor bounties aren't available right now. Set a reward to save.";
  }
  if (message.includes('contact information is not allowed')) {
    return 'Take out the phone number, email or social handle. Keep contact on Bounty until you hire someone.';
  }
  const userFacing = USER_FACING_RAISES.find(re => re.test(message));
  if (userFacing) return message;

  // ── Lifecycle (trg_bounties_guard_lifecycle) ──────────────────────────────
  if (message.includes('bounty_status_transition_not_allowed')) {
    return "This bounty has moved on (someone may have been hired), so that change isn't allowed. Refresh to see where it stands.";
  }
  if (message.includes('bounty_delete_not_allowed_after_acceptance')) {
    return "A hunter is already working on this bounty, so it can't be removed. Message them, or report a problem from the bounty.";
  }
  if (message.includes('bounty_resume_blocked_escrow_refunded')) {
    return 'The payment for this bounty was already returned to you, so the work can’t resume. Contact Bounty support.';
  }
  if (
    message.includes('bounty_assignment_is_server_managed') ||
    message.includes('bounty_completed_at_is_server_managed')
  ) {
    return "That part of the bounty is updated by Bounty itself and can't be changed here. Refresh and try again.";
  }

  // ── Ownership / visibility ───────────────────────────────────────────────
  if (message.includes('owner reference floor')) {
    return "This bounty isn't linked to your account, so it can't be saved. Contact Bounty support.";
  }
  if (code === 'PGRST116' || /JSON object requested, multiple \(or no\) rows/i.test(message)) {
    return "This bounty couldn't be found, or it isn't yours to change. It may have been removed. Go back and refresh.";
  }
  if (code === '42501' || /row-level security/i.test(message) || status === 403) {
    return 'You can only change bounties you posted.';
  }

  // ── Generic Postgres classes ──────────────────────────────────────────────
  if (code === '23514') return "One of the values isn't allowed. Check the reward and details, then try again.";
  if (code === '23502') return 'Something required is missing. Fill in every field and try again.';
  if (code === '22001') return 'One of the fields is too long. Shorten it and try again.';
  if (code === '22P02' || code === '22003') return "One of the values isn't in the right format. Check the reward and try again.";

  // ── Transport ─────────────────────────────────────────────────────────────
  if (/Network request failed|Failed to fetch|network|timeout|ECONN|ETIMEDOUT/i.test(message)) {
    return "Couldn't reach Bounty, so your changes weren't saved. Check your connection and try again.";
  }

  // API mode wraps the server body: "Failed to update bounty: {json}".
  const wrapped = message.match(/^Failed to update bounty: (.*)$/s);
  if (wrapped) {
    try {
      const body = JSON.parse(wrapped[1]);
      const inner = body?.error?.message ?? body?.message ?? body?.error;
      if (typeof inner === 'string' && inner) {
        return describeBountyUpdateError({ message: inner, code: body?.code ?? '' }, opts);
      }
    } catch {
      /* not JSON — fall through */
    }
    return GENERIC_UPDATE_FAILURE;
  }

  // A plain sentence from our own code can be shown; a server identifier,
  // SQL text or a code cannot.
  if (!message || SERVER_CODE.test(message) || /PGRST|sql|column|relation|violates|constraint|function|\bfn_/i.test(message)) {
    return GENERIC_UPDATE_FAILURE;
  }
  return message;
}

export function toBountyUpdateError(
  err: unknown,
  opts: { requirements?: boolean } = {}
): BountyUpdateError {
  if (err instanceof BountyUpdateError) return err;
  const { message, code } = raw(err);
  return new BountyUpdateError(describeBountyUpdateError(err, opts), code || null, message);
}
