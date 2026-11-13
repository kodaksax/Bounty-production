/**
 * P10: cancelled bounties that still hold captured money.
 *
 * Three layers:
 *  - planAdminSettlement(): who may run the Stripe step of an admin
 *    disposition, and with what (supabase/functions/_shared/admin-settlement.ts).
 *  - adminDataClient.updateBountyStatus(): passes the disposition and maps the
 *    new refusal.
 *  - The migration, rollback and ops script as files: the contract the SQL
 *    must keep. The SQL itself is executed by
 *    supabase/tests/20261110120000_cancelled_bounty_money_reconciliation.test.sql
 *    (run it on a Supabase branch; see the PR for the local PGlite run).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const rpc = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: jest.fn(),
    functions: { invoke: jest.fn() },
    auth: { getSession: jest.fn() },
  },
  isSupabaseConfigured: true,
}));

import {
  planAdminSettlement,
  type AdminSettlementPaymentRow,
} from '../../supabase/functions/_shared/admin-settlement';
import { AdminModerationError, adminDataClient } from '../../lib/admin/adminDataClient';

const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const POSTER = '22222222-2222-4222-8222-222222222222';
const HUNTER = '33333333-3333-4333-8333-333333333333';

function payment(over: Partial<AdminSettlementPaymentRow> = {}, disposition?: Record<string, unknown>) {
  return {
    id: 'bp1',
    bounty_id: 'b1',
    poster_id: POSTER,
    hunter_id: null,
    status: 'captured',
    amount: '35',
    stripe_payment_intent_id: 'pi_1',
    stripe_refund_id: null,
    stripe_transfer_id: null,
    metadata: disposition ? { admin_disposition: disposition } : {},
    ...over,
  } as AdminSettlementPaymentRow;
}

describe('planAdminSettlement', () => {
  const plan = (p: AdminSettlementPaymentRow | null, callerId = ADMIN, callerIsAdmin = true) =>
    planAdminSettlement({ callerId, callerIsAdmin, payment: p });

  it('refuses non-admins before reading anything', () => {
    expect(plan(payment({ status: 'refund_pending' }, { disposition: 'refund_poster' }), POSTER, false)).toMatchObject({
      ok: false,
      status: 403,
      code: 'not_admin',
    });
  });

  it('does nothing without a recorded disposition (the RPC must run first)', () => {
    expect(plan(payment())).toMatchObject({ ok: false, code: 'no_disposition' });
    expect(plan(payment({}, { disposition: 'give_it_away' }))).toMatchObject({ ok: false, code: 'no_disposition' });
    expect(plan(null)).toMatchObject({ ok: false, status: 404 });
  });

  it('refund_poster: refunds the row amount on its own PaymentIntent', () => {
    expect(plan(payment({ status: 'refund_pending' }, { disposition: 'refund_poster' }))).toEqual({
      ok: true,
      action: 'refund',
      paymentId: 'bp1',
      paymentIntentId: 'pi_1',
      amount: 35,
    });
  });

  it.each([
    [{ status: 'captured' }, 'invalid_status'],
    [{ status: 'refunded', stripe_refund_id: 're_1' }, 'already_refunded'],
    [{ status: 'refund_pending', stripe_transfer_id: 'tr_1' }, 'already_transferred'],
    [{ status: 'refund_pending', stripe_payment_intent_id: null }, 'no_payment_intent'],
  ])('refund_poster refuses %o (%s)', (over, code) => {
    expect(plan(payment(over, { disposition: 'refund_poster' }))).toMatchObject({ ok: false, code });
  });

  it('pay_out_to_hunter: pays the hunter both the row and the disposition name', () => {
    expect(
      plan(payment({ hunter_id: HUNTER }, { disposition: 'pay_out_to_hunter', hunter_id: HUNTER }))
    ).toEqual({ ok: true, action: 'transfer', paymentId: 'bp1', hunterId: HUNTER, amount: 35 });
  });

  it.each([
    ['row and disposition disagree', { hunter_id: POSTER }, { hunter_id: HUNTER }, 'hunter_mismatch'],
    ['no hunter recorded', {}, {}, 'hunter_mismatch'],
    ['payee is the poster', { hunter_id: POSTER }, { hunter_id: POSTER }, 'payee_is_poster'],
    ['transfer already exists', { hunter_id: HUNTER, stripe_transfer_id: 'tr_1' }, { hunter_id: HUNTER }, 'already_transferred'],
    ['payment no longer captured', { hunter_id: HUNTER, status: 'release_pending' }, { hunter_id: HUNTER }, 'invalid_status'],
  ])('pay_out_to_hunter refuses when %s', (_label, over, disp, code) => {
    expect(plan(payment(over, { disposition: 'pay_out_to_hunter', ...disp }))).toMatchObject({ ok: false, code });
  });

  it('an admin cannot pay themselves, except a decision recorded by a reviewed ops script', () => {
    const p = (source?: string) =>
      payment({ hunter_id: ADMIN }, { disposition: 'pay_out_to_hunter', hunter_id: ADMIN, source });
    expect(plan(p())).toMatchObject({ ok: false, status: 403, code: 'self_payout' });
    expect(plan(p('admin_console'))).toMatchObject({ ok: false, code: 'self_payout' });
    expect(plan(p('ops_script'))).toMatchObject({ ok: true, action: 'transfer', hunterId: ADMIN });
  });

  it('keep_as_platform_revenue has no Stripe step', () => {
    expect(plan(payment({ status: 'retained' }, { disposition: 'keep_as_platform_revenue' }))).toMatchObject({
      ok: false,
      code: 'nothing_to_execute',
    });
  });

  it('never reads an amount, payee or intent from anywhere but the row', () => {
    // The route passes only callerId, callerIsAdmin and the DB row; the
    // function has no other inputs to be tricked by.
    expect(planAdminSettlement.length).toBe(1);
    const out = plan(payment({ hunter_id: HUNTER, amount: 35 }, { disposition: 'pay_out_to_hunter', hunter_id: HUNTER, amount: 9999 }));
    expect(out).toMatchObject({ ok: true, amount: 35 });
  });
});

describe('adminDataClient.updateBountyStatus with a disposition', () => {
  beforeEach(() => rpc.mockReset());
  const bountyRow = { id: 'b1', status: 'cancelled', poster_id: POSTER, title: 't', amount: 35 };

  it('sends p_disposition and p_hunter_id only when given', async () => {
    rpc.mockResolvedValue({ data: bountyRow, error: null });
    await adminDataClient.updateBountyStatus('b1', 'cancelled', 'r');
    expect(rpc).toHaveBeenLastCalledWith('admin_set_bounty_status', { p_bounty_id: 'b1', p_status: 'cancelled', p_reason: 'r' });

    await adminDataClient.updateBountyStatus('b1', 'cancelled', 'r', { disposition: 'pay_out_to_hunter', hunterId: HUNTER });
    expect(rpc).toHaveBeenLastCalledWith('admin_set_bounty_status', {
      p_bounty_id: 'b1',
      p_status: 'cancelled',
      p_reason: 'r',
      p_disposition: 'pay_out_to_hunter',
      p_hunter_id: HUNTER,
    });
  });

  it('maps disposition_required apart from a plain escrow hold', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'disposition_required:stripe_payment_captured' } });
    await expect(adminDataClient.updateBountyStatus('b1', 'cancelled', 'r')).rejects.toMatchObject({
      code: 'DISPOSITION_REQUIRED',
    });
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'escrow_unsettled:wallet_escrow_held' } });
    const err = await adminDataClient.updateBountyStatus('b1', 'cancelled', 'r').catch((e) => e);
    expect(err).toBeInstanceOf(AdminModerationError);
    expect(err.code).toBe('ESCROW_UNSETTLED');
  });
});

describe('migration 20261110120000 contract', () => {
  const sql = read('supabase/migrations/20261110120000_cancelled_bounty_money_reconciliation.sql');
  const down = read('supabase/rollbacks/production/20261110120000_cancelled_bounty_money_reconciliation.down.sql');

  it('adds both finding types, keyed per payment, through record_reconciliation_finding', () => {
    for (const t of ['cancelled_bounty_captured_payment', 'refund_pending_without_stripe_refund']) {
      expect(sql).toContain(`WHEN '${t}'\n        THEN p_details->>'bounty_payment_id'`);
      expect(sql).toContain(`PERFORM public.record_reconciliation_finding(\n      '${t}'`);
      expect(sql).toContain(`e.finding_type = '${t}'`);
    }
    expect(sql).toContain("bp.updated_at < now() - interval '24 hours'");
    // Only severities the CHECK allows; 'high' does not exist.
    expect(sql).toContain("CASE WHEN r.is_test THEN 'warning' ELSE 'critical' END");
    expect(sql).not.toMatch(/'high'/);
  });

  it('keeps every finding-key branch that production already has', () => {
    const keyFn = (src: string) => {
      const s = src.indexOf('CREATE OR REPLACE FUNCTION public.fn_reconciliation_finding_key');
      return src.slice(s, src.indexOf('$function$;', s));
    };
    const before = [...keyFn(down).matchAll(/WHEN '(\w+)'/g)].map((m) => m[1]);
    const after = [...keyFn(sql).matchAll(/WHEN '(\w+)'/g)].map((m) => m[1]);
    expect(before.length).toBeGreaterThan(15);
    expect(after.filter((t) => !before.includes(t)).sort()).toEqual([
      'cancelled_bounty_captured_payment',
      'refund_pending_without_stripe_refund',
    ]);
    expect(before.every((t) => after.includes(t))).toBe(true);
  });

  it('replaces the 3-argument admin_set_bounty_status rather than overloading it', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.admin_set_bounty_status(uuid, text, text);');
    expect(sql).toMatch(/p_disposition text DEFAULT NULL::text,\s+p_hunter_id\s+uuid DEFAULT NULL::uuid/);
    expect(sql).toContain("RAISE EXCEPTION 'disposition_required:stripe_payment_captured'");
    expect(sql).toContain("'bounty_status_disposition'");
    expect(down).toContain('DROP FUNCTION IF EXISTS public.admin_set_bounty_status(uuid, text, text, text, uuid);');
  });

  it('keeps the escrow guard for every other hold', () => {
    expect(sql).toContain("RAISE EXCEPTION 'escrow_unsettled:%', v_held");
    expect(sql).toContain("IF v_held = 'stripe_payment_captured' AND v_payment.id IS NOT NULL");
  });

  it('never leaves new functions executable by anon (default EXECUTE grant)', () => {
    for (const fn of ['run_bounty_money_reconciliation()', 'fn_bounty_stranded_captured_payment(uuid)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon, authenticated;`);
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text, text, uuid) FROM anon;');
  });

  it('rollback refuses instead of deleting recorded money decisions', () => {
    expect(down).toContain("RAISE EXCEPTION 'dispositions already recorded");
    expect(down).not.toMatch(/DELETE FROM public\.(admin_action_log|platform_ledger|bounty_payments)/);
  });
});

describe('ops script for 5e96aaed', () => {
  const ops = read('scripts/ops/settle-5e96aaed-2026-11.sql');
  const undo = read('scripts/ops/settle-5e96aaed-2026-11.rollback.sql');
  const sections = (src: string) => src.split(/^-- =+\n-- (?:OPTION|UNDO) /m).slice(1);

  it('has options A, B, C, each in its own transaction ending in ROLLBACK', () => {
    const s = sections(ops);
    expect(s.map((x) => x[0])).toEqual(['A', 'B', 'C']);
    for (const x of s) {
      expect(x).toMatch(/^BEGIN;$/m);
      expect(x.trim().split('\n').pop()).toMatch(/^ROLLBACK;/);
      expect(x).not.toMatch(/^COMMIT;/m);
      expect(x).toMatch(/BEFORE/);
      expect(x).toMatch(/AFTER/);
    }
  });

  it('has a matching undo for each option, also ROLLBACK by default', () => {
    const s = sections(undo);
    expect(s.map((x) => x[0])).toEqual(['A', 'B', 'C']);
    for (const x of s) expect(x.trim().split('\n').pop()).toMatch(/^ROLLBACK;/);
  });

  it('touches only this bounty and payment, and calls no Stripe API', () => {
    const ids = new Set([...ops.matchAll(/'([0-9a-f]{8}-[0-9a-f-]{27})'/g)].map((m) => m[1]));
    expect([...ids].sort()).toEqual([
      '5e96aaed-93bd-4ade-ae39-93b073d9daff',
      '7a665b48-5702-40a8-9184-fe7bf7a67daa',
      'f4bd948b-a0a6-4991-8e5d-d4a3978760e6',
    ]);
    expect(ops).not.toMatch(/net\.http_post|api\.stripe\.com/);
  });
});
