/**
 * Reads the person-message filter out of the get_conversation_summaries
 * migration, and evaluates it, so tests can compare what My Jobs gets from
 * the SQL with what the job pages compute in TypeScript (PERSON_MESSAGE_RULE).
 */
import * as fs from 'fs';
import * as path from 'path';

export const SUMMARIES_MIGRATION = 'supabase/migrations/20261125180000_conversation_summaries_last_person_message.sql';
export const SUMMARIES_ROLLBACK =
  'supabase/rollbacks/production/20261125180000_conversation_summaries_last_person_message.down.sql';

const ROOT = path.resolve(__dirname, '../..');
export const readRepoFile = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r/g, '');

/** The filter as the migration's function body writes it: `message_type IN (…)` and `text !~ '…'`. */
export function sqlPersonRule(sql: string = readRepoFile(SUMMARIES_MIGRATION)): { types: string[]; pattern: string } {
  const body = sql.slice(sql.indexOf('AS $$'), sql.indexOf('$$;'));
  const types = body.match(/x\.message_type IN \(([^)]*)\)/);
  const pattern = body.match(/x\.text !~ '((?:[^']|'')*)'/);
  if (!types || !pattern) throw new Error('person-message filter not found in the migration body');
  return {
    types: types[1].split(',').map((t) => t.trim().replace(/^'|'$/g, '')),
    pattern: pattern[1].replace(/''/g, "'"),
  };
}

export interface SqlMessageRow {
  sender_id: string;
  created_at: string;
  message_type: string;
  text: string;
}

/**
 * What the function returns as my_last_message_at / other_last_message_at for
 * `viewer`, evaluated from the SQL's own filter (Postgres `\s` ≈ JS `\s` here).
 */
export function sqlLastPersonMessages(rows: readonly SqlMessageRow[], viewer: string): { mine: string | null; other: string | null } {
  const rule = sqlPersonRule();
  const re = new RegExp(rule.pattern);
  const max = (list: SqlMessageRow[]) =>
    list.length ? list.map((r) => r.created_at).reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
  const person = rows.filter((r) => rule.types.includes(r.message_type) && !re.test(r.text));
  return {
    mine: max(person.filter((r) => r.sender_id === viewer)),
    other: max(person.filter((r) => r.sender_id !== viewer)),
  };
}
