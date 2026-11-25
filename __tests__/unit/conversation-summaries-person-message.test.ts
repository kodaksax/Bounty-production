/**
 * ONE definition of "a person's own message" (lib/utils/hired-phase.ts,
 * PERSON_MESSAGE_RULE) is used by the job pages, and matched by
 * get_conversation_summaries, which My Jobs reads. This fails if the SQL, the
 * TypeScript rule, the code that SENDS the hire welcome, or the manual runbook
 * that sends it from SQL drift apart.
 */
import { buildHireWelcomeMessage, HIRE_WELCOME_PREFIX } from '../../lib/messaging/hire-welcome';
import { PERSON_MESSAGE_RULE, PERSON_MESSAGE_TYPES } from '../../lib/utils/hired-phase';
import { readRepoFile as read, sqlPersonRule, SUMMARIES_MIGRATION as MIGRATION, SUMMARIES_ROLLBACK as ROLLBACK } from '../helpers/person-message-sql';

describe('get_conversation_summaries matches PERSON_MESSAGE_RULE exactly', () => {
  const rule = sqlPersonRule(read(MIGRATION));

  it('the same message types, in the same order', () => {
    expect(rule.types).toEqual([...PERSON_MESSAGE_TYPES]);
    expect(rule.types).not.toContain('system');
  });

  it('the same hire-welcome prefix, after leading whitespace', () => {
    expect(rule.pattern).toBe(`^\\s*${PERSON_MESSAGE_RULE.automatedTextPrefix}`);
    // A regex in SQL, a plain prefix in TypeScript: only safe while the
    // prefix has no regex metacharacters.
    expect(PERSON_MESSAGE_RULE.automatedTextPrefix).not.toMatch(/[.*+?^${}()|[\]\\]/);
  });

  it("the code that SENDS the welcome uses the rule's prefix", () => {
    expect(PERSON_MESSAGE_RULE.automatedTextPrefix).toBe(HIRE_WELCOME_PREFIX);
    expect(buildHireWelcomeMessage('Fix the gate').startsWith(PERSON_MESSAGE_RULE.automatedTextPrefix)).toBe(true);
    expect(new RegExp(rule.pattern).test(buildHireWelcomeMessage('Fix the gate'))).toBe(true);
  });

  it("the manual-assignment runbook's SQL sends the same welcome", () => {
    const runbook = read('docs/bounty-flows/MANUAL_HUNTER_ASSIGNMENT_RUNBOOK.md');
    const sent = runbook.match(/'(Welcome! You''ve been selected for[^']*(?:''[^']*)*)'/);
    expect(sent).not.toBeNull();
    expect(sent![1].replace(/''/g, "'").startsWith(HIRE_WELCOME_PREFIX)).toBe(true);
  });

  it('the server event cards are excluded: "Applied to this bounty." is a system message', () => {
    expect(rule.types).not.toContain('system');
    // The 284 cards on staging are all message_type 'system' (checked 2026-11-25).
  });
});

describe('the migration keeps everything else and the rollback restores it', () => {
  const sql = read(MIGRATION);
  const down = read(ROLLBACK);
  const columns = (s: string) =>
    s
      .slice(s.indexOf('RETURNS TABLE ('), s.indexOf(')\nLANGUAGE'))
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((c) => c && !c.startsWith('RETURNS'));

  it('adds two columns after the existing six, in order', () => {
    expect(columns(sql)).toEqual([
      'conversation_id',
      'last_read_at',
      'last_message_text',
      'last_message_media_url',
      'last_message_at',
      'unread_count',
      'my_last_message_at',
      'other_last_message_at',
    ]);
  });

  it('the rollback restores the six columns', () => {
    expect(columns(down)).toEqual(columns(sql).slice(0, 6));
  });

  it('both stay SECURITY INVOKER, STABLE, search_path = public, and keep anon out', () => {
    for (const s of [sql, down]) {
      expect(s).toMatch(/SECURITY INVOKER/);
      expect(s).toMatch(/STABLE/);
      expect(s).toMatch(/SET search_path = public/);
      expect(s).toMatch(/REVOKE ALL ON FUNCTION public\.get_conversation_summaries\(\) FROM public, anon;/);
      expect(s).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_conversation_summaries\(\) TO authenticated, service_role;/);
    }
  });
});
