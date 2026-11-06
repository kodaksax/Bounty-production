import { readFileSync } from 'fs';
import { join } from 'path';

// #957: the console badge read escrow from wallet_transactions only, while
// admin_set_bounty_status() also refuses for bounty_payments and
// bounty_v3_funding holds. This pins the view to the guard's own function.
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const sql = read('supabase/migrations/20261028120000_admin_financial_state_counts_stripe_holds.sql');
const down = read('supabase/rollbacks/production/20261028120000_admin_financial_state_counts_stripe_holds.down.sql');
const original = read('supabase/migrations/20260828130000_bounty_events_command_center.sql');

// Aliased columns only (b.amount has no alias); enough to catch a reorder.
function viewColumns(src: string): string[] {
  const start = src.indexOf('VIEW public.admin_bounty_financial_state AS');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\nFROM public.bounties b', start));
  return [...body.matchAll(/\bAS (\w+)\s*,?\s*$/gm)].map((m) => m[1]);
}

describe('admin_bounty_financial_state counts Stripe holds (#957)', () => {
  it('reads the hold from the same function the admin status guard uses', () => {
    expect(sql).toContain('SELECT public.fn_bounty_unsettled_escrow_reason(b.id) AS reason');
    expect(sql).toMatch(/h\.reason\s+AS escrow_hold_reason/);
  });

  it('a held reason wins over every other financial status', () => {
    const caseBody = sql.slice(sql.indexOf('CASE'), sql.indexOf('END AS financial_status'));
    const firstWhens = [...caseBody.matchAll(/WHEN (.*?) THEN '(\w+)'/g)].slice(0, 3);
    expect(firstWhens[0][1]).toContain('h.reason IS NOT NULL');
    expect(firstWhens[0][2]).toBe('release_pending');
    expect(firstWhens[1][1]).toBe('h.reason IS NOT NULL');
    expect(firstWhens[1][2]).toBe('escrow_held');
    expect(firstWhens[2][2]).toBe('not_applicable');
  });

  it('keeps the existing columns in order and only appends the new one', () => {
    const before = viewColumns(original);
    const after = viewColumns(sql);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(['escrow_hold_reason']);
  });

  it('stays closed to clients, and the rollback restores the wallet-only view', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(`REVOKE ALL ON public.admin_bounty_financial_state FROM ${role};`);
      expect(down).toContain(`REVOKE ALL ON public.admin_bounty_financial_state FROM ${role};`);
    }
    expect(down).toContain('DROP VIEW public.admin_bounty_financial_state;');
    expect(down).not.toContain('fn_bounty_unsettled_escrow_reason');
    expect(viewColumns(down)).toEqual(viewColumns(original));
  });
});
