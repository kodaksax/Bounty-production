/**
 * Bounty quality scoring + poster nudges (notification overhaul, Phase 2).
 *
 * A poster nudge fires in exactly two moments, each once per bounty:
 *   stage 1 — at post time, only if the bounty is clearly incomplete
 *   stage 2 — at the 2h liquidity checkpoint, only if still middling and
 *             still zero applications
 * and never a third time. These invariants live entirely in SQL (a trigger
 * function and a branch inside the liquidity-escalation sweep), so — matching
 * this repo's existing pattern for migration behavior that can't run against
 * a real Postgres instance in CI (see reconciliation-alerts.test.ts,
 * settlement-state.test.ts) — these tests assert against the actual deployed
 * SQL text rather than re-implementing the logic in JS and testing that
 * instead.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const stripSqlComments = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

// The trigger function + stage-1 condition, unchanged since this migration.
const scoreAndNudgeMigration = stripSqlComments(
  read('supabase/migrations/20260912143515_bounty_quality_score_and_poster_nudges.sql')
);

// fn_escalate_stale_bounty_liquidity (which owns the stage-2 follow-up) was
// redefined again in a later migration (bounding the online-bounty candidate
// query) — that file, not the original, is the live definition.
const escalationMigration = stripSqlComments(
  read('supabase/migrations/20260912152257_bound_online_liquidity_escalation_candidates.sql')
);

describe('stage 1: post-time nudge', () => {
  test('fires only on INSERT, only when the score is under 50, only once', () => {
    expect(scoreAndNudgeMigration).toMatch(
      /IF TG_OP = 'INSERT' AND v_score IS NOT NULL AND v_score < 50 AND COALESCE\(NEW\.quality_nudge_stage, 0\) = 0 THEN/
    );
  });

  test('sets quality_nudge_stage to 1, not an incrementing counter', () => {
    // Hardcoded to a literal stage number, not `quality_nudge_stage + 1` —
    // asserting the literal is what makes "caps at 2, ever" true by
    // construction rather than by a separate bound check that could drift.
    expect(scoreAndNudgeMigration).toMatch(/quality_nudge_stage = 1\b/);
    expect(scoreAndNudgeMigration).not.toMatch(/quality_nudge_stage\s*\+\s*1/);
  });

  test('the nudge is enqueued through notifications_outbox, not a direct in-app insert', () => {
    // Chained non-greedy match: the IF condition must be immediately
    // followed (in source order) by the outbox insert and the type literal,
    // so this can't accidentally match the unrelated 'bounty_quality_nudge'
    // occurrence in the CHECK constraint's allow-list earlier in the file.
    expect(scoreAndNudgeMigration).toMatch(
      /IF TG_OP = 'INSERT'[\s\S]*?INSERT INTO public\.notifications_outbox[\s\S]*?'bounty_quality_nudge'/
    );
  });

  test('a plain UPDATE (not matching the INSERT+score condition) only recomputes the score', () => {
    expect(scoreAndNudgeMigration).toMatch(/ELSE\s+UPDATE public\.bounties SET quality_score = v_score WHERE id = NEW\.id;/);
  });

  test('the UPDATE trigger does not watch quality_score/quality_nudge_stage themselves', () => {
    // Isolate just the watched-column list (AFTER UPDATE OF ... ON) rather
    // than the whole CREATE TRIGGER statement -- the statement also names
    // the trigger function itself (fn_bounty_quality_score_and_nudge),
    // which contains "quality_score" as a substring and would false-positive
    // a naive whole-statement match.
    const columnListMatch = scoreAndNudgeMigration.match(
      /CREATE TRIGGER trg_bounties_quality_score_on_update\s+AFTER UPDATE OF ([\s\S]*?)\s+ON public\.bounties/
    );
    expect(columnListMatch).not.toBeNull();
    const columnList = columnListMatch![1];
    expect(columnList).not.toMatch(/quality_score/);
    expect(columnList).not.toMatch(/quality_nudge_stage/);
  });
});

describe('stage 2: 2h liquidity-checkpoint follow-up', () => {
  test('fires only at the first checkpoint (liquidity_stage = 1), not the second (2->3)', () => {
    const condition = escalationMigration.match(
      /IF v_bounty\.liquidity_stage = 1\s+AND COALESCE\(v_bounty\.quality_score, 100\) < 70\s+AND COALESCE\(v_bounty\.quality_nudge_stage, 0\) < 2\s+AND v_poster_id IS NOT NULL\s+THEN/
    );
    expect(condition).not.toBeNull();
  });

  test('requires score < 70 and quality_nudge_stage < 2 — a bounty already nudged twice is skipped', () => {
    expect(escalationMigration).toMatch(/COALESCE\(v_bounty\.quality_nudge_stage, 0\) < 2/);
  });

  test('sets quality_nudge_stage to the literal 2, not an incrementing counter', () => {
    expect(escalationMigration).toMatch(/UPDATE public\.bounties SET quality_nudge_stage = 2 WHERE id = v_bounty\.id;/);
  });

  test('the stage-2 outbox row carries the same bounty_quality_nudge type and stage 2', () => {
    expect(escalationMigration).toMatch(
      /Your bounty hasn''t gotten much attention yet[\s\S]*?'type', 'bounty_quality_nudge'[\s\S]*?'stage', 2/
    );
  });
});

describe('the online-bounty candidate pool is bounded', () => {
  test("work_type = 'online' no longer aggregates every profile unfiltered", () => {
    const onlineBranch = escalationMigration.slice(
      escalationMigration.indexOf("IF v_bounty.work_type = 'online' THEN"),
      escalationMigration.indexOf('ELSIF v_bounty.geom IS NOT NULL THEN')
    );
    expect(onlineBranch).toMatch(/LIMIT 500/);
    expect(onlineBranch).toMatch(/last_session_at/);
  });
});
