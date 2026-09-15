/**
 * Which of a hunter's self-reported skills look relevant to a specific
 * bounty. There is no dedicated skill/keyword-matching infrastructure in the
 * codebase (the existing moderation regex scanner targets spam/scam signals,
 * not skill relevance -- see supabase/migrations/20260829120000_bounty_moderation_queue.sql),
 * so this is a deliberately simple, deterministic word-overlap heuristic:
 * good enough to surface an obviously-relevant skill ("Plumbing" on a
 * plumbing bounty) without pretending to be a real recommender system.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with',
  'is', 'are', 'be', 'this', 'that', 'i', 'my', 'me', 'need', 'needed',
  'please', 'help', 'looking',
]);

function tokenize(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export interface SkillMatchBountyInput {
  title?: string | null;
  description?: string | null;
  category?: string | null;
}

/**
 * Loose same-word-family check without a real stemmer: "plumbing" and
 * "plumber" should count as the same word for matching purposes even though
 * they're not the exact same string. Requires both words to be at least 4
 * characters and share their first 5 (or fewer, if a word is shorter) --
 * long enough to avoid accidental matches like "cleaning"/"clearance".
 */
function sharesWordFamily(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  const prefixLen = Math.min(5, minLen);
  return a.slice(0, prefixLen) === b.slice(0, prefixLen);
}

/**
 * Returns up to `max` of the hunter's skills that share a word with the
 * bounty's title/description/category. Order follows the hunter's own skill
 * order (their most emphasized skills win ties), not a relevance score --
 * there isn't enough signal here to rank meaningfully beyond "matches or
 * doesn't."
 */
export function getRelevantSkills(
  hunterSkills: string[] | null | undefined,
  bounty: SkillMatchBountyInput,
  max = 3
): string[] {
  if (!hunterSkills || hunterSkills.length === 0) return [];

  const bountyWords = new Set<string>([
    ...tokenize(bounty.title),
    ...tokenize(bounty.description),
    ...tokenize(bounty.category),
  ]);
  if (bountyWords.size === 0) return [];

  const matches: string[] = [];
  for (const rawSkill of hunterSkills) {
    const skill = typeof rawSkill === 'string' ? rawSkill.trim() : '';
    if (!skill) continue;
    const skillWords = tokenize(skill);
    let overlaps = false;
    for (const skillWord of skillWords) {
      for (const bountyWord of bountyWords) {
        if (sharesWordFamily(skillWord, bountyWord)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) break;
    }
    if (overlaps) {
      matches.push(skill);
      if (matches.length >= max) break;
    }
  }
  return matches;
}
