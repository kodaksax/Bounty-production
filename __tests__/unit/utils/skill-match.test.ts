import { getRelevantSkills } from '../../../lib/utils/skill-match';

describe('getRelevantSkills', () => {
  const plumbingBounty = {
    title: 'Fix a leaking bathroom sink',
    description: 'Need an experienced plumber for a same-day repair.',
    category: 'home',
  };

  test('hunter with relevant skills: matches surface, in the hunter\'s own order', () => {
    const skills = ['Plumbing', 'Graphic Design', 'Carpentry'];
    const result = getRelevantSkills(skills, plumbingBounty);
    expect(result).toEqual(['Plumbing']);
  });

  test('hunter with no relevant skills: row is omitted (empty array)', () => {
    const skills = ['Graphic Design', 'Video Editing', 'Copywriting'];
    const result = getRelevantSkills(skills, plumbingBounty);
    expect(result).toEqual([]);
  });

  test('caps at 3 matches even when more overlap', () => {
    const skills = ['Plumbing', 'Pipe repair', 'Bathroom renovation', 'Sink installation', 'Leak detection'];
    const bounty = { title: 'Need plumbing pipe sink bathroom leak work', description: '', category: 'home' };
    const result = getRelevantSkills(skills, bounty, 3);
    expect(result).toHaveLength(3);
  });

  test('no skills on the hunter profile: returns empty, never throws', () => {
    expect(getRelevantSkills(undefined, plumbingBounty)).toEqual([]);
    expect(getRelevantSkills(null, plumbingBounty)).toEqual([]);
    expect(getRelevantSkills([], plumbingBounty)).toEqual([]);
  });

  test('bounty with no usable text: returns empty rather than matching everything', () => {
    const result = getRelevantSkills(['Plumbing'], { title: '', description: '', category: '' });
    expect(result).toEqual([]);
  });

  test('is case-insensitive', () => {
    const result = getRelevantSkills(['PLUMBING'], plumbingBounty);
    expect(result).toEqual(['PLUMBING']);
  });

  test('ignores blank/whitespace-only skill entries', () => {
    const result = getRelevantSkills(['', '   ', 'Plumbing'], plumbingBounty);
    expect(result).toEqual(['Plumbing']);
  });
});
