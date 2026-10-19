/**
 * SBA-10 (5): every refusal of a bounty UPDATE becomes a sentence the poster
 * can act on. The raised names are the ones the BEFORE UPDATE triggers on
 * public.bounties emit on staging and production.
 */
jest.mock('../../../lib/utils/account-status-errors', () => ({
  getAccountStatusErrorMessage: (err: any) =>
    String(err?.message ?? '').includes('account_suspended')
      ? { title: 'Account suspended', message: 'Your account is suspended.' }
      : null,
}));

import {
  BountyUpdateError,
  GENERIC_UPDATE_FAILURE,
  describeBountyUpdateError,
  toBountyUpdateError,
} from '../../../lib/services/bounty-update-error';
import { CAPABILITY_UNAVAILABLE } from '../../../lib/services/capability-service';

const d = (message: string, code = '') => describeBountyUpdateError({ message, code });

describe('describeBountyUpdateError', () => {
  it.each([
    // trg_bounties_enforce_funding_before_work
    ['bounty_amount_locked_by_applications', 'Hunters have already applied at this reward'],
    ['bounty_honor_flag_locked_by_applications', 'Hunters have already applied at this reward'],
    ['bounty_amount_locked_by_escrow', 'cancel this bounty for a refund and post a new one'],
    ['bounty_honor_flag_locked_by_escrow', 'already held'],
    ['bounty_id_requirement_locked_by_escrow', "who can apply can't change"],
    ['bounty_trust_tier_locked_by_escrow', "who can apply can't change"],
    ['bounty_funding_mode_is_immutable', "How this bounty is paid can't change"],
    ['bounty_payment_architecture_version_is_immutable', "How this bounty is paid can't change"],
    ['bounty_not_funded', "hasn't been paid for yet"],
    // trg_bounties_enforce_posting_policy_on_update
    ['bounty amount 3 is below the 5 minimum', 'The reward must be at least $5.'],
    ['bounty amount 1 is below the 2.5 minimum', 'The reward must be at least $2.50.'],
    ['for-honor bounties are not currently accepted', "For-honor bounties aren't available right now"],
    ['contact information is not allowed in bounty title or description', 'Take out the phone number'],
    // trg_bounties_guard_lifecycle
    ['bounty_status_transition_not_allowed: open -> completed', 'This bounty has moved on'],
    ['bounty_delete_not_allowed_after_acceptance', 'A hunter is already working on this bounty'],
    ['bounty_resume_blocked_escrow_refunded', 'already returned to you'],
    ['bounty_assignment_is_server_managed', 'updated by Bounty itself'],
    ['bounty_completed_at_is_server_managed', 'updated by Bounty itself'],
    // trg_bounties_owner_reference_required
    ['new row for relation "bounties" violates owner reference floor', "isn't linked to your account"],
    // a00_validate_bounty_requirements (#914 copy kept)
    ['requirements_frozen_after_application', 'Requirements cannot change after an application or assignment.'],
    ['taxonomy_version_changed', 'The task catalog changed.'],
    ['too_many_requirements', 'more requirements than a bounty can have'],
    ['duplicate_requirement', 'listed twice'],
    ['invalid_requirement_term', "isn't valid any more"],
    ['requirements_owner_only', 'Only the poster'],
  ])('%s', (message, expected) => {
    expect(d(message)).toContain(expected);
  });

  it('passes through rules the server already words for users', () => {
    const msg = 'In-person bounties need a description of at least 20 characters.';
    expect(d(msg, '23514')).toBe(msg);
    const cap = 'New accounts can have 2 open bounties on their first day. You can post more tomorrow.';
    expect(d(cap, '23514')).toBe(cap);
  });

  it.each([
    ['PGRST116', 'JSON object requested, multiple (or no) rows returned', "isn't yours to change"],
    ['42501', 'new row violates row-level security policy for table "bounties"', 'only change bounties you posted'],
    ['23514', 'new row for relation "bounties" violates check constraint "x"', "isn't allowed"],
    ['23502', 'null value in column "title" violates not-null constraint', 'Something required is missing'],
    ['22001', 'value too long for type character varying(120)', 'too long'],
    ['22P02', 'invalid input syntax for type numeric: "abc"', "isn't in the right format"],
  ])('maps Postgres/PostgREST code %s', (code, message, expected) => {
    expect(d(message, code)).toContain(expected);
  });

  it('schema drift: capability copy for requirements, an update prompt otherwise', () => {
    const err = { code: 'PGRST204', message: "Could not find the 'x' column of 'bounties' in the schema cache" };
    expect(describeBountyUpdateError(err, { requirements: true })).toBe(CAPABILITY_UNAVAILABLE);
    expect(describeBountyUpdateError(err)).toContain('Update the app');
  });

  it('network failures say nothing was saved', () => {
    expect(d('TypeError: Network request failed')).toContain("Couldn't reach Bounty");
  });

  it('account status wins', () => {
    expect(d('account_suspended')).toBe('Your account is suspended.');
  });

  it('unwraps the API-mode body', () => {
    expect(d('Failed to update bounty: {"error":{"message":"bounty_not_funded"}}')).toContain("hasn't been paid");
    expect(d('Failed to update bounty: <html>502</html>')).toBe(GENERIC_UPDATE_FAILURE);
  });

  it('never shows an unknown server identifier or SQL', () => {
    expect(d('some_new_raise_name')).toBe(GENERIC_UPDATE_FAILURE);
    expect(d('function public.fn_x(uuid) does not exist', '42883')).toBe(GENERIC_UPDATE_FAILURE);
    expect(d('')).toBe(GENERIC_UPDATE_FAILURE);
  });

  it('keeps a plain sentence from our own code', () => {
    expect(d('Cannot change posting terms after an application.')).toBe(
      'Cannot change posting terms after an application.'
    );
  });
});

describe('toBountyUpdateError', () => {
  it('keeps the code and raw text for logs, and is idempotent', () => {
    const e = toBountyUpdateError({ code: 'P0001', message: 'bounty_not_funded' });
    expect(e).toBeInstanceOf(BountyUpdateError);
    expect(e.code).toBe('P0001');
    expect(e.serverMessage).toBe('bounty_not_funded');
    expect(toBountyUpdateError(e)).toBe(e);
  });
});
