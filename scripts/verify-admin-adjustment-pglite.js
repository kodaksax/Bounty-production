/* scripts/verify-admin-adjustment-pglite.js
 *
 * Functional checks for admin_apply_balance_adjustment()
 * (supabase/migrations/20261012120100_admin_financial_action_guards.sql) on an
 * in-process PostgreSQL (PGlite). Staging cannot run these: its
 * wallet_tx_type_enum has no 'admin_adjustment' label, which prod has.
 *
 * The schema here is a minimal stand-in: the enum with prod's labels,
 * profiles.balance, wallet_transactions, admin_action_log with prod's
 * constraint, and update_balance() copied from prod (2026-10-12) minus the
 * profile-guard plumbing. The function under test is read straight from the
 * migration file, so this exercises the shipped SQL.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite      (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-admin-adjustment-pglite.js
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261012120100_admin_financial_action_guards.sql');

function loadPGlite() {
  const from = process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : __filename;
  const req = createRequire(from);
  return import(pathToFileURL(req.resolve('@electric-sql/pglite')).href).then((m) => m.PGlite);
}

function extract(sql, startMarker, endMarker) {
  const start = sql.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const end = sql.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found after: ${startMarker}`);
  return sql.slice(start, end + endMarker.length);
}

const SCHEMA = `
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TYPE public.wallet_tx_type_enum AS ENUM
  ('escrow','release','refund','deposit','withdrawal','dispute_loss','admin_adjustment');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, balance numeric NOT NULL DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, bounty_id uuid, type public.wallet_tx_type_enum NOT NULL, amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending', description text, idempotency_key text, metadata jsonb,
  created_at timestamptz DEFAULT now());
-- prod's legacy CHECK, which the migration drops
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK (type = ANY (ARRAY[
  'escrow','release','refund','deposit','withdrawal','dispute_loss']::public.wallet_tx_type_enum[]));
CREATE TABLE public.admin_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_user_id uuid NOT NULL, action_type text NOT NULL,
  target_user_id uuid NOT NULL, target_transaction_id uuid, amount numeric, reason text NOT NULL,
  result text NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.update_balance(p_user_id uuid, p_amount numeric) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_new_balance numeric;
BEGIN
  UPDATE profiles SET balance = balance + p_amount, updated_at = now() WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance USING ERRCODE = '23514';
  END IF;
  RETURN v_new_balance;
END; $$;
`;

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const USER = '00000000-0000-0000-0000-00000000000b';
const GHOST = '00000000-0000-0000-0000-00000000000c';

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  -- ' + JSON.stringify(info) : ''}`);
}

async function main() {
  const PGlite = await loadPGlite();
  const db = await PGlite.create();
  await db.exec(SCHEMA);

  const sql = fs.readFileSync(MIGRATION, 'utf8');
  await db.exec(extract(sql, 'ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;', 'END;\n$$;'));
  await db.exec(extract(sql, 'CREATE OR REPLACE FUNCTION public.admin_apply_balance_adjustment(', '\n$$;'));
  check('migration SQL for the adjustment loads', true);

  await db.query(`INSERT INTO profiles (id, balance) VALUES ($1, 0), ($2, 5)`, [ADMIN, USER]);

  const call = async (user, amount, key, reason = 'support credit') => {
    try {
      const r = await db.query(
        `SELECT * FROM admin_apply_balance_adjustment($1, $2, $3, $4, $5, NULL)`, [ADMIN, user, amount, reason, key]);
      return { ok: true, row: r.rows[0] };
    } catch (e) {
      return { ok: false, err: e.message, code: e.code };
    }
  };
  const state = async () => ({
    balance: Number((await db.query(`SELECT balance FROM profiles WHERE id = $1`, [USER])).rows[0].balance),
    ledger: Number((await db.query(`SELECT count(*) n FROM wallet_transactions WHERE user_id = $1`, [USER])).rows[0].n),
    audit: Number((await db.query(`SELECT count(*) n FROM admin_action_log WHERE target_user_id = $1`, [USER])).rows[0].n),
  });

  const first = await call(USER, 12.5, 'idem-key-0001');
  check('credit applied', first.ok && first.row.replayed === false && Number(first.row.new_balance) === 17.5, first);
  check('ledger row written with type admin_adjustment (legacy CHECK no longer rejects it)', (await state()).ledger === 1);

  const replay = await call(USER, 12.5, 'idem-key-0001');
  check('same key replays instead of crediting again', replay.ok && replay.row.replayed === true && replay.row.transaction_id === first.row.transaction_id, replay);
  check('balance, ledger and audit each moved once', JSON.stringify(await state()) === JSON.stringify({ balance: 17.5, ledger: 1, audit: 1 }), await state());

  const conflict = await call(USER, 99, 'idem-key-0001');
  check('same key with a different amount is refused', !conflict.ok && conflict.code === '23505', conflict);

  const overdraw = await call(USER, -100, 'idem-key-0002');
  check('debit below zero refused', !overdraw.ok && overdraw.code === '23514', overdraw);
  check('refused debit left no ledger or audit row', JSON.stringify(await state()) === JSON.stringify({ balance: 17.5, ledger: 1, audit: 1 }), await state());

  const ghost = await call(GHOST, 10, 'idem-key-0003');
  check('unknown user refused', !ghost.ok && ghost.code === 'P0002', ghost);

  // Atomicity: if the audit insert fails, the balance and ledger must roll back too.
  await db.exec(`ALTER TABLE admin_action_log ADD CONSTRAINT harness_block CHECK (reason <> 'block-audit')`);
  const blocked = await call(USER, 3, 'idem-key-0004', 'block-audit');
  check('audit failure aborts the adjustment', !blocked.ok, blocked);
  check('...and nothing was half-applied', JSON.stringify(await state()) === JSON.stringify({ balance: 17.5, ledger: 1, audit: 1 }), await state());

  const debit = await call(USER, -7.5, 'idem-key-0005');
  check('debit applied', debit.ok && Number(debit.row.new_balance) === 10, debit);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
