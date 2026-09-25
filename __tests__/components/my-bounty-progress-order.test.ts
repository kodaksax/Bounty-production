jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

import { sortByProgress } from '../../components/my-bounty-progress-banner';

const item = (id: string, stage: any, created_at: string) =>
  ({ bounty: { id, created_at } as any, stage });

describe('sortByProgress', () => {
  it('puts the furthest-along stage first, oldest first within a stage', () => {
    const sorted = sortByProgress([
      item('open-new', 'open', '2026-09-20T00:00:00Z'),
      item('wip-new', 'in_progress', '2026-09-18T00:00:00Z'),
      item('review', 'review', '2026-09-10T00:00:00Z'),
      item('open-old', 'open', '2026-09-01T00:00:00Z'),
      item('wip-old', 'in_progress', '2026-09-05T00:00:00Z'),
    ]);
    expect(sorted.map(i => i.bounty.id)).toEqual([
      'review',
      'wip-old',
      'wip-new',
      'open-old',
      'open-new',
    ]);
  });
});
