/**
 * Regression tests for quoted replies.
 *
 * A reply is a normal message whose `messages.reply_to` points at the message
 * it answers. `sendMessage` must write that link, and must never send the
 * column at all for an ordinary message (it is nullable, and older insert
 * fallbacks do not know about it).
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

import { fetchMessagesForConversations, sendMessage } from '../../../lib/services/supabase-messaging';
import { supabase } from '../../../lib/supabase';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const ORIGINAL_ID = '22222222-2222-4222-8222-222222222222';

/** Minimal stand-in for the insert().select().single() chain. */
function mockInsert(row: any) {
  const single = jest.fn().mockResolvedValue({ data: row, error: null });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  (supabase.from as jest.Mock).mockReturnValue({ insert });
  return { insert };
}

describe('supabase-messaging replies', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('writes reply_to on the inserted row and echoes it back', async () => {
    const { insert } = mockInsert({
      id: 'msg-1',
      conversation_id: CONVERSATION_ID,
      sender_id: 'user-1',
      text: 'yes, tomorrow works',
      created_at: '2026-09-16T10:00:00Z',
      reply_to: ORIGINAL_ID,
    });

    const message = await sendMessage(CONVERSATION_ID, 'yes, tomorrow works', 'user-1', null, ORIGINAL_ID);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ reply_to: ORIGINAL_ID }));
    expect(message.replyTo).toBe(ORIGINAL_ID);
  });

  it('omits reply_to entirely for a message that is not a reply', async () => {
    const { insert } = mockInsert({
      id: 'msg-2',
      conversation_id: CONVERSATION_ID,
      sender_id: 'user-1',
      text: 'hello',
      created_at: '2026-09-16T10:00:00Z',
      reply_to: null,
    });

    const message = await sendMessage(CONVERSATION_ID, 'hello', 'user-1');

    expect(insert.mock.calls[0][0]).not.toHaveProperty('reply_to');
    expect(message.replyTo).toBeUndefined();
  });
});

describe('supabase-messaging fetchMessagesForConversations', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('fetches all conversations in one request, oldest first', async () => {
    const order = jest.fn().mockResolvedValue({
      data: [
        { id: 'm1', conversation_id: CONVERSATION_ID, sender_id: 'u1', text: 'a', created_at: '2026-01-01T00:00:00Z', reply_to: null },
        { id: 'm2', conversation_id: ORIGINAL_ID, sender_id: 'u2', text: 'b', created_at: '2026-01-02T00:00:00Z', reply_to: 'm1' },
      ],
      error: null,
    });
    const inFn = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ in: inFn });
    (supabase.from as jest.Mock).mockReturnValue({ select });

    const result = await fetchMessagesForConversations([CONVERSATION_ID, ORIGINAL_ID, 'conv-local']);

    expect(supabase.from).toHaveBeenCalledTimes(1);
    // Local/non-UUID ids are dropped rather than sent to Postgres.
    expect(inFn).toHaveBeenCalledWith('conversation_id', [CONVERSATION_ID, ORIGINAL_ID]);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result.map(m => [m.id, m.conversationId, m.replyTo])).toEqual([
      ['m1', CONVERSATION_ID, null],
      ['m2', ORIGINAL_ID, 'm1'],
    ]);
  });

  it('makes no request when there is nothing to fetch', async () => {
    const result = await fetchMessagesForConversations(['conv-local']);

    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
