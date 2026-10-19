import { readFileSync } from 'fs';
import { join } from 'path';

// SBA-10 (docs/audits/shoal-behavioral-audit.md): a poster's delete reaches
// bounty_events as 'bounty.cancelled'. Behaviour was proven on PGlite (16
// checks: hard + soft delete, already-ended rows, hired rows, system/admin
// actors, a failing ledger write, grants, rollback) and end to end on staging
// (Cancel and refund as a Shoal pool poster -> payment.refunded, then
// bounty.cancelled via=delete by_poster=true). This pins the contract.
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const sql = read('supabase/migrations/20261019235500_bounty_events_record_poster_cancellations.sql');
const down = read('supabase/rollbacks/production/20261019235500_bounty_events_record_poster_cancellations.down.sql');
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('$function$;', start);
  return src.slice(start, end);
}

describe('bounty_events poster cancellations migration (SBA-10)', () => {
  const del = fnBody(sql, 'trg_bounty_events_from_bounty_delete');
  const upd = fnBody(sql, 'trg_bounty_events_from_bounties');

  it('records a hard delete as the existing bounty.cancelled concept, once per bounty', () => {
    expect(sql).toMatch(/CREATE TRIGGER bounty_events_from_bounty_deletes\s+AFTER DELETE ON public\.bounties\s+FOR EACH ROW/);
    expect(del).toContain("'bounty.deleted:' || OLD.id");
    expect(del).toContain("'bounty.cancelled'");
    expect(del).toMatch(/OLD\.status::text IN \('cancelled', 'deleted', 'archived', 'completed'\)/);
  });

  it('records who did it, so poster cancellations can be told from admin removals', () => {
    expect(del).toContain("'by_poster', v_actor IS NOT NULL AND v_actor = v_poster");
    expect(upd).toContain("'via', 'soft_delete'");
  });

  it('never blocks the delete: errors are swallowed, and nothing can throw in DECLARE', () => {
    for (const body of [del, upd]) expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*RAISE WARNING/);
    const declare = del.slice(del.indexOf('DECLARE'), del.indexOf('BEGIN'));
    expect(declare).not.toContain(':=');
  });

  it('only a never-hired open -> deleted soft delete becomes a cancellation', () => {
    expect(upd).toMatch(/NEW\.status::text = 'deleted'\s+AND OLD\.status::text = 'open'\s+AND OLD\.accepted_by IS NULL/);
    expect(upd).toContain("WHEN v_poster_cancel THEN 'bounty.cancelled'");
    // The event key is unchanged, so replays stay idempotent.
    expect(upd).toContain("'bounty.status:' || NEW.id || ':' || NEW.status || ':' || v_stamp");
  });

  it('SECURITY DEFINER with a fixed search_path, revoked from clients', () => {
    for (const body of [del, upd]) {
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toContain("SET search_path TO 'public', 'pg_temp'");
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounty_delete() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounties() FROM PUBLIC, anon, authenticated;');
    for (const sig of ['trg_bounty_events_from_bounty_delete()', 'trg_bounty_events_from_bounties()']) {
      const entry = manifest.functions.find((f: any) => f.signature === sig);
      expect(entry?.forbid_execute).toEqual(expect.arrayContaining(['anon', 'authenticated', 'PUBLIC']));
    }
  });

  it('the rollback drops the trigger and restores the original status mapping', () => {
    expect(down).toContain('DROP TRIGGER IF EXISTS bounty_events_from_bounty_deletes ON public.bounties;');
    expect(down).toContain('DROP FUNCTION IF EXISTS public.trg_bounty_events_from_bounty_delete();');
    const restored = fnBody(down, 'trg_bounty_events_from_bounties');
    expect(restored).toContain('CASE NEW.status::text');
    expect(restored).not.toContain('v_poster_cancel');
  });
});
