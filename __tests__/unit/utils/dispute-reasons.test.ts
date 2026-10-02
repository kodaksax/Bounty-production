import { getDisputeReasonOptions } from '../../../lib/utils/dispute-reasons';

// Must stay inside bounty_disputes_reason_code_check
// (supabase/migrations/20261002120100_review_window_and_recourse_queue.sql).
const DB_CODES = [
  'hunter_unresponsive', 'poster_unresponsive', 'work_quality',
  'scope_disagreement', 'missed_deadline', 'communication', 'other',
];

describe('getDisputeReasonOptions', () => {
  it('offers the poster "Hunter hasn\'t responded" while no work is submitted (T22)', () => {
    const options = getDisputeReasonOptions('poster', { workSubmitted: false });
    expect(options[0]).toMatchObject({ code: 'hunter_unresponsive', label: "Hunter hasn't responded" });
    expect(options.map((o) => o.code)).not.toContain('work_quality');
  });

  it('swaps it for a work-quality reason once the hunter has submitted', () => {
    const codes = getDisputeReasonOptions('poster', { workSubmitted: true }).map((o) => o.code);
    expect(codes).not.toContain('hunter_unresponsive');
    expect(codes).toContain('work_quality');
  });

  it('gives the hunter a poster-unresponsive reason in both stages', () => {
    for (const workSubmitted of [false, true]) {
      const codes = getDisputeReasonOptions('hunter', { workSubmitted }).map((o) => o.code);
      expect(codes[0]).toBe('poster_unresponsive');
      expect(codes).not.toContain('hunter_unresponsive');
    }
  });

  it('every code is accepted by the database CHECK and every option explains what happens', () => {
    for (const role of ['poster', 'hunter'] as const) {
      for (const workSubmitted of [false, true]) {
        for (const o of getDisputeReasonOptions(role, { workSubmitted })) {
          expect(DB_CODES).toContain(o.code);
          expect(o.help.length).toBeGreaterThan(20);
        }
      }
    }
  });
});
