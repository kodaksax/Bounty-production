/**
 * The batched, best-effort reads My Jobs uses to give every job on the tab
 * the same state its own screen loads: open disputes, pending cancellation
 * requests (and who asked), and how each posted job is funded.
 */
type Result = { data: unknown; error: unknown };

const calls: { table: string; ops: [string, unknown[]][] }[] = [];
let nextResult: Result = { data: [], error: null };

/** A chainable, awaitable stand-in for a PostgREST query builder. */
function builder(table: string) {
  const entry = { table, ops: [] as [string, unknown[]][] };
  calls.push(entry);
  const b: any = {};
  for (const op of ['select', 'in', 'eq']) {
    b[op] = (...args: unknown[]) => {
      entry.ops.push([op, args]);
      return b;
    };
  }
  b.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(nextResult).then(resolve, reject);
  return b;
}

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table: string) => builder(table) },
}));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), warning: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { bountyService } from '../../../lib/services/bounty-service';
import { cancellationService } from '../../../lib/services/cancellation-service';
import { disputeService } from '../../../lib/services/dispute-service';

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: [], error: null };
});

describe('disputeService.getOpenDisputeBountyIds', () => {
  it('asks once for open or under-review disputes on these bounties', async () => {
    nextResult = { data: [{ bounty_id: 'b1' }, { bounty_id: 7 }], error: null };
    const ids = await disputeService.getOpenDisputeBountyIds(['b1', 'b2', 'b1', 7]);
    expect(ids).toEqual(new Set(['b1', '7']));
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('bounty_disputes');
    expect(calls[0].ops).toEqual([
      ['select', ['bounty_id']],
      ['in', ['bounty_id', ['b1', 'b2', '7']]],
      ['in', ['status', ['open', 'under_review']]],
    ]);
  });

  it('skips the query for no ids, and reports nothing on failure', async () => {
    expect(await disputeService.getOpenDisputeBountyIds([])).toEqual(new Set());
    expect(calls).toHaveLength(0);
    nextResult = { data: null, error: new Error('rls') };
    expect(await disputeService.getOpenDisputeBountyIds(['b1'])).toEqual(new Set());
  });
});

describe('cancellationService.getPendingCancellationsForBounties', () => {
  it('maps each pending request to who asked, ignoring unknown roles', async () => {
    nextResult = {
      data: [
        { bounty_id: 'b1', requester_type: 'hunter' },
        { bounty_id: 'b2', requester_type: 'poster' },
        { bounty_id: 'b3', requester_type: null },
      ],
      error: null,
    };
    const pending = await cancellationService.getPendingCancellationsForBounties(['b1', 'b2', 'b3']);
    expect(Object.fromEntries(pending)).toEqual({ b1: 'hunter', b2: 'poster' });
    expect(calls[0].table).toBe('bounty_cancellations');
    expect(calls[0].ops).toContainEqual(['eq', ['status', 'pending']]);
  });

  it('is empty on failure', async () => {
    nextResult = { data: null, error: new Error('offline') };
    expect((await cancellationService.getPendingCancellationsForBounties(['b1'])).size).toBe(0);
  });
});

describe('bountyService.getFundingModes', () => {
  it('reads only id and funding_mode, keeping known modes', async () => {
    nextResult = {
      data: [
        { id: 'b1', funding_mode: 'at_accept' },
        { id: 'b2', funding_mode: 'at_post' },
        { id: 'b3', funding_mode: 'something_else' },
      ],
      error: null,
    };
    const modes = await bountyService.getFundingModes(['b1', 'b2', 'b3']);
    expect(Object.fromEntries(modes)).toEqual({ b1: 'at_accept', b2: 'at_post' });
    expect(calls[0].table).toBe('bounties');
    expect(calls[0].ops[0]).toEqual(['select', ['id, funding_mode']]);
  });

  it('is empty for no ids and on failure', async () => {
    expect((await bountyService.getFundingModes([])).size).toBe(0);
    nextResult = { data: null, error: new Error('rls') };
    expect((await bountyService.getFundingModes(['b1'])).size).toBe(0);
  });
});
