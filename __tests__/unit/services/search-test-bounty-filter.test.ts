/**
 * SBA-11 (docs/audits/shoal-behavioral-audit.md): search autocomplete showed
 * QA test bounties. bountyService.search had no is_test filter while the
 * results list (searchWithFilters) hid test rows, so a query matching only a
 * test bounty offered a suggestion above "No bounties found".
 *
 * The fake Supabase below applies .eq() filters to its rows, so these tests
 * pin what comes back, not just which methods were called.
 */

export {};

type Row = Record<string, unknown>;

const BOUNTIES: Row[] = [
  { id: 'real-1', title: 'Paint my fence', poster_id: 'u1', status: 'open', is_test: false, amount: 40, created_at: new Date().toISOString() },
  { id: 'test-1', title: 'Paint QA fixture', poster_id: 'u2', status: 'open', is_test: true, amount: 5, created_at: new Date().toISOString() },
];

const eqCalls: { table: string; column: string; value: unknown }[] = [];

function fakeQuery(table: string) {
  const filters: [string, unknown][] = [];
  const builder: any = {};
  for (const m of ['select', 'or', 'order', 'range', 'limit', 'in', 'gte', 'ilike']) {
    builder[m] = () => builder;
  }
  builder.eq = (column: string, value: unknown) => {
    eqCalls.push({ table, column, value });
    filters.push([column, value]);
    return builder;
  };
  builder.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const rows = table === 'bounties' ? BOUNTIES.filter(r => filters.every(([c, v]) => r[c] === v)) : [];
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  };
  return builder;
}

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table: string) => fakeQuery(table) },
}));
jest.mock('lib/utils/postgrest-utils', () => ({
  escapeIlike: (s: string) => s,
  quotePostgrestValue: (s: string) => `"${s}"`,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('lib/services/user-search-service', () => ({
  userSearchService: { getUserSuggestions: jest.fn().mockResolvedValue([]) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bountyService } = require('lib/services/bounty-service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { searchService } = require('lib/services/search-service');

const bountyEqs = (column: string) => eqCalls.filter(c => c.table === 'bounties' && c.column === column);

beforeEach(() => {
  eqCalls.length = 0;
});

describe('bountyService.search hides test bounties (SBA-11)', () => {
  it('filters is_test = false by default', async () => {
    const results = await bountyService.search('paint');
    expect(bountyEqs('is_test')).toEqual([{ table: 'bounties', column: 'is_test', value: false }]);
    expect(results.map((b: Row) => b.id)).toEqual(['real-1']);
  });

  it('includes test bounties only when an internal viewer opts in', async () => {
    const results = await bountyService.search('paint', { includeTest: true });
    expect(bountyEqs('is_test')).toEqual([]);
    expect(results.map((b: Row) => b.id).sort()).toEqual(['real-1', 'test-1']);
  });
});

describe('search autocomplete (SBA-11)', () => {
  it('never suggests a test bounty to a regular viewer', async () => {
    const suggestions = await searchService.getAutocompleteSuggestions('paint');
    const bountyIds = suggestions.filter((s: Row) => s.type === 'bounty').map((s: Row) => s.id);
    expect(bountyIds).toEqual(['bounty_real-1']);
  });

  it('a query that matches only test bounties suggests no bounty', async () => {
    const before = BOUNTIES.length;
    BOUNTIES.splice(0, 1); // leave only the test row
    try {
      const suggestions = await searchService.getAutocompleteSuggestions('qa fixture');
      expect(suggestions.filter((s: Row) => s.type === 'bounty')).toEqual([]);
    } finally {
      BOUNTIES.unshift({ id: 'real-1', title: 'Paint my fence', poster_id: 'u1', status: 'open', is_test: false, amount: 40, created_at: new Date().toISOString() });
      expect(BOUNTIES.length).toBe(before);
    }
  });

  it('passes an internal viewer\'s opt-in through', async () => {
    const suggestions = await searchService.getAutocompleteSuggestions('paint', 8, { includeTest: true });
    const bountyIds = suggestions.filter((s: Row) => s.type === 'bounty').map((s: Row) => s.id).sort();
    expect(bountyIds).toEqual(['bounty_real-1', 'bounty_test-1']);
  });
});

describe('trending on the search screen applies the same rule', () => {
  it('hides test bounties by default', async () => {
    const trending = await searchService.getTrendingBounties(5);
    expect(bountyEqs('is_test')).toContainEqual({ table: 'bounties', column: 'is_test', value: false });
    expect(trending.map((b: Row) => b.id)).not.toContain('test-1');
  });

  it('shows them to an internal viewer who opted in', async () => {
    await searchService.getTrendingBounties(5, { includeTest: true });
    expect(bountyEqs('is_test')).toEqual([]);
  });
});
