/**
 * lib/services/poster-job-activity.ts feeds the job page's timeline and
 * "Last message from …". A failed read must degrade to "unknown", never to
 * "no messages" (which would tell the poster a responsive helper went quiet).
 */
type Result = { data: any; error: any };
const mockTables: Record<string, (filters: Record<string, unknown>) => Result> = {};

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const b: any = {
    select: () => b,
    eq: (k: string, v: unknown) => ((filters[k] = v), b),
    in: (k: string, v: unknown) => ((filters[k] = v), b),
    order: () => b,
    limit: () => b,
    then: (resolve: (r: Result) => void, reject: (e: unknown) => void) => {
      try {
        resolve(mockTables[table](filters));
      } catch (e) {
        reject(e);
      }
    },
  };
  return b;
}

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (t: string) => builder(t) },
}));

import { getPendingOfferCounts, getPosterJobActivity } from '../../../lib/services/poster-job-activity';

beforeEach(() => {
  mockTables.bounty_requests = () => ({
    data: [
      // accepted_at is timestamp WITHOUT time zone: no offset in the API reply.
      { hunter_id: 'h1', status: 'accepted', created_at: '2026-11-10T10:00:00Z', accepted_at: '2026-11-12T09:00:00' },
      { hunter_id: 'h2', status: 'rejected', created_at: '2026-11-10T11:00:00Z', accepted_at: null },
    ],
    error: null,
  });
  mockTables.conversations = () => ({ data: [{ id: 'c1' }], error: null });
  mockTables.messages = f => {
    // Only typed messages count; the automatic 'Applied' system message must not.
    expect(f.message_type).toBe('text');
    return f.sender_id === 'h1'
      ? { data: [{ created_at: '2026-11-13T08:00:00Z' }], error: null }
      : { data: [{ created_at: '2026-11-12T09:01:00Z' }], error: null };
  };
});

it('reads offers, the hire time and the last message from each side', async () => {
  const a = await getPosterJobActivity({ bountyId: 'b1', posterId: 'p1', helperId: 'h1' });
  expect(a.offers).toHaveLength(2);
  expect(a.hiredAt).toBe('2026-11-12T09:00:00Z');
  expect(a.lastHelperMessageAt).toBe('2026-11-13T08:00:00Z');
  expect(a.lastPosterMessageAt).toBe('2026-11-12T09:01:00Z');
  expect(a.messagesKnown).toBe(true);
});

it("reads a zone-less accepted_at as UTC, not the phone's local time", async () => {
  const a = await getPosterJobActivity({ bountyId: 'b1', posterId: 'p1', helperId: 'h1' });
  expect(new Date(a.hiredAt!).toISOString()).toBe('2026-11-12T09:00:00.000Z');
});

it('no conversation yet is a known "no messages"', async () => {
  mockTables.conversations = () => ({ data: [], error: null });
  const a = await getPosterJobActivity({ bountyId: 'b1', posterId: 'p1', helperId: 'h1' });
  expect(a.messagesKnown).toBe(true);
  expect(a.lastHelperMessageAt).toBeNull();
});

it('a failed message read is "unknown", not "no messages"', async () => {
  mockTables.messages = () => ({ data: null, error: new Error('rls') });
  const a = await getPosterJobActivity({ bountyId: 'b1', posterId: 'p1', helperId: 'h1' });
  expect(a.messagesKnown).toBe(false);
  expect(a.lastHelperMessageAt).toBeNull();
  // The offers read is independent and still lands.
  expect(a.hiredAt).toBe('2026-11-12T09:00:00Z');
});

it('a failed offers read leaves the timeline without offers rather than "none"', async () => {
  mockTables.bounty_requests = () => ({ data: null, error: new Error('offline') });
  const a = await getPosterJobActivity({ bountyId: 'b1', posterId: 'p1', helperId: 'h1' });
  expect(a.offers).toBeNull();
  expect(a.hiredAt).toBeNull();
});

it('before anyone is chosen there is no message read at all', async () => {
  const spy = jest.fn(() => ({ data: [], error: null }));
  mockTables.conversations = spy;
  const a = await getPosterJobActivity({ bountyId: 'b1', posterId: 'p1', helperId: null });
  expect(spy).not.toHaveBeenCalled();
  expect(a.messagesKnown).toBe(false);
});

it('counts pending offers per job, and throws on a failed read', async () => {
  mockTables.bounty_requests = f => {
    expect(f.status).toBe('pending');
    return { data: [{ bounty_id: 'b1' }, { bounty_id: 'b1' }, { bounty_id: 'b2' }], error: null };
  };
  const counts = await getPendingOfferCounts(['b1', 'b2', 'b3']);
  expect(counts.get('b1')).toBe(2);
  expect(counts.get('b2')).toBe(1);
  expect(counts.get('b3')).toBeUndefined();

  mockTables.bounty_requests = () => ({ data: null, error: new Error('offline') });
  await expect(getPendingOfferCounts(['b1'])).rejects.toThrow('offline');
});
