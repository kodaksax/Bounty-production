import { buildGridRows } from '../../components/bounty-grid-rows';
import type { Bounty } from '../../lib/services/database.types';
import type { BountyCompleteness } from '../../lib/utils/bounty-completeness';

// The featured carousel is the top of the price order. Incompleteness sinks a
// listing within the grid below, but must never cost it a featured slot — that
// used to let a complete $10 bounty outrank an incomplete $500 one, so the
// carousel showed lower prices than the cards underneath it.

const bounty = (id: string, amount: number, extra: Partial<Bounty> = {}): Bounty =>
  ({
    id,
    title: `Bounty ${id}`,
    description: '',
    amount,
    location: '',
    timeline: '',
    skills_required: '',
    poster_id: 'p1',
    user_id: 'p1',
    created_at: '2026-09-24T00:00:00Z',
    status: 'open',
    ...extra,
  }) as unknown as Bounty;

const completeness = (
  entries: Record<string, boolean>
): Map<string, BountyCompleteness> =>
  new Map(
    Object.entries(entries).map(([id, isComplete]) => [
      id,
      { isComplete, missing: [] } as unknown as BountyCompleteness,
    ])
  );

const featuredOf = (rows: ReturnType<typeof buildGridRows>) => {
  const row = rows.find(r => r.type === 'featuredCarousel');
  if (!row || row.type !== 'featuredCarousel') return [];
  return row.items.map(i => String(i.item.id));
};

const gridOf = (rows: ReturnType<typeof buildGridRows>) =>
  rows.flatMap(r =>
    r.type === 'pair' ? [r.left, r.right].filter(Boolean).map(b => String(b!.id)) : []
  );

describe('buildGridRows — featured selection', () => {
  it('features the three highest prices', () => {
    const bounties = [
      bounty('a', 50),
      bounty('b', 500),
      bounty('c', 10),
      bounty('d', 250),
      bounty('e', 100),
    ];
    const rows = buildGridRows(bounties, completeness({}));
    expect(featuredOf(rows)).toEqual(['b', 'd', 'e']);
  });

  it('keeps a high-priced incomplete listing in the carousel', () => {
    const bounties = [bounty('cheap', 10), bounty('rich', 500)];
    const rows = buildGridRows(
      bounties,
      completeness({ cheap: true, rich: false })
    );
    expect(featuredOf(rows)[0]).toBe('rich');
  });

  it('still sinks incomplete listings below complete ones in the grid', () => {
    const bounties = [
      bounty('f1', 900),
      bounty('f2', 800),
      bounty('f3', 700),
      bounty('incomplete', 600),
      bounty('complete', 100),
    ];
    const rows = buildGridRows(
      bounties,
      completeness({ incomplete: false, complete: true })
    );
    expect(featuredOf(rows)).toEqual(['f1', 'f2', 'f3']);
    expect(gridOf(rows)).toEqual(['complete', 'incomplete']);
  });

  it('ranks for-honor bounties last, never featured over a paid one', () => {
    const bounties = [
      bounty('honor', 0, { is_for_honor: true }),
      bounty('paid', 5),
    ];
    const rows = buildGridRows(bounties, completeness({}));
    expect(featuredOf(rows)).toEqual(['paid', 'honor']);
  });
});
