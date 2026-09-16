/**
 * Inbox loading (fetchConversations).
 *
 * Last message + unread count come from one get_conversation_summaries RPC.
 * The pre-migration path issued two requests per conversation, so an inbox
 * of 40 conversations cost ~84 requests -- each paying the messages RLS
 * check -- and it ran on every realtime change. It is kept as a fallback for
 * environments where the migration is not applied yet.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock('../../../lib/services/monitoring', () => ({
  logClientError: jest.fn(),
  logClientInfo: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { fetchConversations } from '../../../lib/services/supabase-messaging';
import { supabase } from '../../../lib/supabase';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONV_A = '11111111-1111-4111-8111-111111111111';
const CONV_B = '22222222-2222-4222-8222-222222222222';

/** Resolves any awaited chain to `rows`, and records which table was hit. */
function chain(rows: any, extra: Record<string, any> = {}) {
  const c: any = { ...extra };
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'gt', 'neq', 'limit']) {
    c[m] = jest.fn().mockReturnValue(c);
  }
  c.maybeSingle = jest.fn().mockResolvedValue({ data: rows, error: null });
  c.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: rows, error: null, count: extra.count ?? null }).then(resolve, reject);
  return c;
}

function mockTables(overrides: Record<string, () => any>) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    const make = overrides[table];
    if (!make) throw new Error(`unexpected table ${table}`);
    return make();
  });
}

const baseTables = () => ({
  conversation_participants: (() => {
    let call = 0;
    return () => {
      call += 1;
      // 1st: my participations; 2nd: all participants of those conversations.
      return call === 1
        ? chain([
            { conversation_id: CONV_A, last_read_at: '2026-01-01T00:00:00Z' },
            { conversation_id: CONV_B, last_read_at: null },
          ])
        : chain([
            { conversation_id: CONV_A, user_id: ME },
            { conversation_id: CONV_A, user_id: THEM },
            { conversation_id: CONV_B, user_id: ME },
            { conversation_id: CONV_B, user_id: THEM },
          ]);
    };
  })(),
  conversations: () =>
    chain([
      { id: CONV_A, is_group: false, bounty_id: null, created_at: 'x', updated_at: '2026-02-01T00:00:00Z' },
      { id: CONV_B, is_group: false, bounty_id: null, created_at: 'x', updated_at: '2026-01-01T00:00:00Z' },
    ]),
  public_profiles: () => chain([{ id: THEM, username: 'them', display_name: null, avatar: null }]),
});

describe('fetchConversations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gets last message and unread counts from one RPC', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          conversation_id: CONV_A,
          last_read_at: '2026-01-01T00:00:00Z',
          last_message_text: 'see you then',
          last_message_media_url: null,
          last_message_at: '2026-02-01T00:00:00Z',
          unread_count: 3,
        },
        {
          conversation_id: CONV_B,
          last_read_at: null,
          last_message_text: '',
          last_message_media_url: 'https://cdn.example.com/a.jpg',
          last_message_at: '2026-01-01T00:00:00Z',
          unread_count: 0,
        },
      ],
      error: null,
    });
    mockTables({
      ...baseTables(),
      messages: () => {
        throw new Error('messages must not be queried per conversation');
      },
    });

    const result = await fetchConversations(ME);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_conversation_summaries');
    expect(result.map(c => [c.id, c.name, c.lastMessage, c.unread])).toEqual([
      [CONV_A, 'them', 'see you then', 3],
      [CONV_B, 'them', '📷 Photo', 0],
    ]);
  });

  it('falls back to per-conversation queries when the RPC is unavailable', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'function public.get_conversation_summaries() does not exist' },
    });
    const messagesChain = jest.fn(() =>
      chain({ conversation_id: CONV_A, text: 'fallback', created_at: 'x', media_url: null }, { count: 2 })
    );
    mockTables({ ...baseTables(), messages: messagesChain });

    const result = await fetchConversations(ME);

    // 2 last-message lookups + 1 unread count (CONV_B has no last_read_at).
    expect(messagesChain).toHaveBeenCalledTimes(3);
    expect(result.find(c => c.id === CONV_A)?.lastMessage).toBe('fallback');
    expect(result.find(c => c.id === CONV_A)?.unread).toBe(2);
  });
});
