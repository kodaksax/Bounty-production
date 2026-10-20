import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// SBA-05 (docs/audits/shoal-behavioral-audit.md), option B. Behaviour is
// proven on staging by scripts/verify-card-at-post.js (real roles, real
// triggers, rolled back). This pins the contract so a later edit can't:
//   * grow a second definition of "first-time poster";
//   * turn the switch on from a migration, or refuse an INSERT for want of a
//     card (installed builds can't save one from the composer);
//   * hand clients a function that reveals someone else's hiring history;
//   * start charging at post.
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const NAME = '20261020120000_first_time_poster_card_at_post';
const sql = read(`supabase/migrations/${NAME}.sql`);
const code = sql.replace(/^\s*--.*$/gm, '');
const downPath = `supabase/rollbacks/production/${NAME}.down.sql`;
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf('AS $', start);
  const tag = sql.slice(open + 3, sql.indexOf('$', open + 4) + 1);
  const end = sql.indexOf(tag, open + 3 + tag.length);
  return sql.slice(start, end + tag.length);
}

const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('first-time poster card-at-post migration (SBA-05)', () => {
  it('defines fn_is_first_time_poster exactly once, in this migration', () => {
    const definers = migrations.filter((f) =>
      /CREATE (OR REPLACE )?FUNCTION public\.fn_is_first_time_poster\(/.test(
        read(`supabase/migrations/${f}`)
      )
    );
    expect(definers).toEqual([`${NAME}.sql`]);
  });

  it('reads every place an acceptance is recorded, including the ledger', () => {
    const fn = fnBody('fn_is_first_time_poster');
    for (const signal of [
      'b.accepted_by IS NOT NULL',
      'b.accepted_request_id IS NOT NULL',
      'b.completed_at IS NOT NULL',
      "b.status IN ('in_progress', 'completed', 'cancellation_requested')",
      "r.status = 'accepted'",
      "'bounty.accepted'",
      "'application.accepted'",
      "'bounty.completed'",
    ]) {
      expect(fn).toContain(signal);
    }
    // The canonical poster, COALESCE(poster_id, user_id), written out.
    expect(fn).toMatch(/b\.poster_id = p_user_id\s+OR \(b\.poster_id IS NULL AND b\.user_id = p_user_id\)/);
  });

  it('the latest fn_can_defer_bounty_funding uses the shared definition', () => {
    const latest = migrations
      .filter((f) => read(`supabase/migrations/${f}`).includes('FUNCTION public.fn_can_defer_bounty_funding('))
      .pop();
    expect(latest).toBe(`${NAME}.sql`);
    const fn = fnBody('fn_can_defer_bounty_funding');
    expect(fn).toContain('RETURN public.fn_is_first_time_poster(p_poster_id);');
    expect(fn).not.toContain('v_prior_count');
    // 'all_bounties' short-circuit unchanged: today's behaviour is the same.
    expect(fn).toMatch(/IF v_cfg\.deferred_funding_scope = 'all_bounties' THEN\s+RETURN true;/);
  });

  it('the requirement uses the definition, the switch and charge-at-hire, about auth.uid() only', () => {
    const fn = fnBody('fn_get_posting_card_requirement');
    expect(fn).toContain('v_uid             uuid := auth.uid();');
    expect(fn).toContain('public.fn_is_first_time_poster(v_uid)');
    expect(fn).toContain('public.fn_can_defer_bounty_funding(v_uid, p_amount)');
    expect(fn).toContain("v_scope = 'first_time_posters' AND v_first_time AND v_charged_at_hire");
    expect(fn).not.toMatch(/p_user_id|p_poster_id/);
  });

  it('ships the switch off and never turns it on itself', () => {
    expect(code).toContain("ADD COLUMN IF NOT EXISTS card_at_post_scope text NOT NULL DEFAULT 'off'");
    expect(code).toContain("CHECK (card_at_post_scope IN ('off', 'first_time_posters'))");
    expect(code).not.toMatch(/SET\s+card_at_post_scope\s*=\s*'first_time_posters'/i);
  });

  it('refuses nothing and charges nothing: no trigger, no raise, no money functions', () => {
    expect(code).not.toMatch(/CREATE TRIGGER/i);
    expect(code).not.toMatch(/RAISE/i);
    expect(code).not.toMatch(/apply_escrow|update_balance|wallet_transactions|funding_mode\s*:=/i);
    expect(code).not.toMatch(/fn_bounties_normalize_funding_mode|fn_reserve_escrow_for_acceptance|fn_accept_bounty_request/);
  });

  it.each(['fn_is_first_time_poster', 'fn_get_posting_card_requirement', 'fn_can_defer_bounty_funding'])(
    '%s is SECURITY DEFINER with a fixed search_path',
    (name) => {
      expect(fnBody(name)).toMatch(/SECURITY DEFINER\s+SET search_path = public\s+AS \$\$/);
    }
  );

  it('privileges: the definition is backend-only, the requirement is for signed-in callers', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION public.fn_is_first_time_poster(uuid) FROM ${role};`);
      expect(code).toContain(`REVOKE ALL ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) FROM ${role};`);
    }
    expect(code).toContain('REVOKE ALL ON FUNCTION public.fn_get_posting_card_requirement(numeric) FROM PUBLIC;');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.fn_get_posting_card_requirement(numeric) FROM anon;');
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.fn_get_posting_card_requirement(numeric) TO authenticated;');
    expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_is_first_time_poster\(uuid\) TO (anon|authenticated)/);
  });

  it('the RLS manifest pins the same privileges', () => {
    const fn = (sig: string) => manifest.functions.find((f: { signature: string }) => f.signature === sig);
    expect(fn('fn_is_first_time_poster(uuid)')).toEqual({
      signature: 'fn_is_first_time_poster(uuid)',
      forbid_execute: ['anon', 'authenticated', 'PUBLIC'],
    });
    expect(fn('fn_can_defer_bounty_funding(uuid,numeric)')).toEqual({
      signature: 'fn_can_defer_bounty_funding(uuid,numeric)',
      forbid_execute: ['anon', 'authenticated', 'PUBLIC'],
    });
    expect(fn('fn_get_posting_card_requirement(numeric)')).toEqual({
      signature: 'fn_get_posting_card_requirement(numeric)',
      forbid_execute: ['anon', 'PUBLIC'],
      require_execute: ['authenticated'],
    });
  });

  it('has a rollback that removes what it added and restores the old body', () => {
    expect(existsSync(join(root, downPath))).toBe(true);
    const down = read(downPath);
    expect(down).toContain('DROP FUNCTION IF EXISTS public.fn_get_posting_card_requirement(numeric);');
    expect(down).toContain('DROP FUNCTION IF EXISTS public.fn_is_first_time_poster(uuid);');
    expect(down).toContain('DROP COLUMN IF EXISTS card_at_post_scope;');
    expect(down).toContain('RETURN v_prior_count = 0;');
    // The old body must not reference the function the rollback drops.
    expect(down.replace(/^\s*--.*$/gm, '')).not.toContain('fn_is_first_time_poster(p_poster_id)');
  });

  it('the client calls the RPC by its migrated name and fails open', () => {
    const svc = read('lib/services/bounty-funding-service.ts');
    expect(svc).toContain("supabase.rpc('fn_get_posting_card_requirement', {");
    expect(svc).toContain('p_amount: amount');
    const gate = read('hooks/usePostingCardGate.ts');
    expect(gate).toContain("if (input.requirement?.cardRequired !== true) return false;");
  });
});
