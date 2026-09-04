/**
 * Contract for the grouped Work / Posts lists.
 *
 * `toBountyListRows` is what lets the management lists stay FlatLists (their
 * rows are expandable and variable-height) while still showing "Needs your
 * attention" / "In progress" / … section headers. The invariants below are the
 * ones the screens rely on: header ids can never collide with bounty ids, and
 * an ungrouped list renders through exactly the same code path.
 */
import { toBountyListRows } from '../../../hooks/useBountyStatusFilters';

const b = (id: string) => ({ id, title: `Bounty ${id}`, status: 'open' }) as any;

describe('toBountyListRows', () => {
  it('returns plain bounty rows when there are no sections', () => {
    const rows = toBountyListRows([], [b('1'), b('2')]);
    expect(rows).toEqual([
      { kind: 'bounty', id: '1', bounty: b('1') },
      { kind: 'bounty', id: '2', bounty: b('2') },
    ]);
  });

  it('interleaves a header before each section, in the order given', () => {
    const rows = toBountyListRows(
      [
        { key: 'attention', label: 'Needs your attention', data: [b('1')] },
        { key: 'waiting', label: 'Waiting on them', data: [b('2'), b('3')] },
      ],
      []
    );

    expect(rows.map(r => r.kind)).toEqual(['section', 'bounty', 'section', 'bounty', 'bounty']);
    expect(rows[0]).toMatchObject({ label: 'Needs your attention', count: 1, group: 'attention' });
    expect(rows[2]).toMatchObject({ label: 'Waiting on them', count: 2, group: 'waiting' });
  });

  it('namespaces header ids so they cannot collide with a bounty id', () => {
    // A bounty whose id is literally "attention" would otherwise produce a
    // duplicate FlatList key and drop a row.
    const rows = toBountyListRows(
      [{ key: 'attention', label: 'Needs your attention', data: [b('attention')] }],
      []
    );
    const ids = rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['section:attention', 'attention']);
  });

  it('ignores the fallback list once sections are supplied', () => {
    const rows = toBountyListRows(
      [{ key: 'past', label: 'Past & archived', data: [b('1')] }],
      [b('99')]
    );
    expect(rows.filter(r => r.kind === 'bounty').map(r => r.id)).toEqual(['1']);
  });
});
