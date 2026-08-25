/**
 * Regression tests for message attachments.
 *
 * Attachments are persisted as `messages.media_url`. The upload pipeline always
 * worked, but the value was dropped on the way back out of `sendMessage`, so a
 * just-sent photo disappeared from the thread the moment the optimistic copy
 * was replaced by the server's row.
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

import { fetchMessages, sendMessage } from '../../../lib/services/supabase-messaging';
import { supabase } from '../../../lib/supabase';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const MEDIA_URL =
  'https://project.supabase.co/storage/v1/object/public/bounty-attachments/messages/1-0-photo.jpg';

/** Minimal stand-in for the insert().select().single() chain. */
function mockInsert(row: any) {
  const single = jest.fn().mockResolvedValue({ data: row, error: null });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  (supabase.from as jest.Mock).mockReturnValue({ insert });
  return { insert, select, single };
}

/** Minimal stand-in for the select().eq().order() chain. */
function mockSelectMessages(rows: any[]) {
  const order = jest.fn().mockResolvedValue({ data: rows, error: null });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  (supabase.from as jest.Mock).mockReturnValue({ select });
  return { select, eq, order };
}

describe('supabase-messaging attachments', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('sendMessage', () => {
    it('writes media_url on the inserted row', async () => {
      const { insert } = mockInsert({
        id: 'msg-1',
        conversation_id: CONVERSATION_ID,
        sender_id: 'user-1',
        text: '',
        media_url: MEDIA_URL,
        created_at: '2026-08-25T00:00:00Z',
      });

      await sendMessage(CONVERSATION_ID, '', 'user-1', MEDIA_URL);

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: CONVERSATION_ID,
          sender_id: 'user-1',
          text: '',
          media_url: MEDIA_URL,
        })
      );
    });

    it('returns the attachment on the sent message', async () => {
      mockInsert({
        id: 'msg-1',
        conversation_id: CONVERSATION_ID,
        sender_id: 'user-1',
        text: 'look at this',
        media_url: MEDIA_URL,
        created_at: '2026-08-25T00:00:00Z',
        is_pinned: false,
      });

      const message = await sendMessage(CONVERSATION_ID, 'look at this', 'user-1', MEDIA_URL);

      expect(message.mediaUrl).toBe(MEDIA_URL);
      expect(message.text).toBe('look at this');
      expect(message.status).toBe('sent');
    });

    it('falls back to the requested URL when the row comes back without one', async () => {
      mockInsert({
        id: 'msg-1',
        conversation_id: CONVERSATION_ID,
        sender_id: 'user-1',
        text: '',
        created_at: '2026-08-25T00:00:00Z',
      });

      const message = await sendMessage(CONVERSATION_ID, '', 'user-1', MEDIA_URL);

      expect(message.mediaUrl).toBe(MEDIA_URL);
    });

    it('leaves mediaUrl undefined for a plain text message', async () => {
      mockInsert({
        id: 'msg-1',
        conversation_id: CONVERSATION_ID,
        sender_id: 'user-1',
        text: 'hello',
        media_url: null,
        created_at: '2026-08-25T00:00:00Z',
      });

      const message = await sendMessage(CONVERSATION_ID, 'hello', 'user-1');

      expect(message.mediaUrl).toBeUndefined();
    });
  });

  describe('fetchMessages', () => {
    it('maps media_url onto the message', async () => {
      mockSelectMessages([
        {
          id: 'msg-1',
          conversation_id: CONVERSATION_ID,
          sender_id: 'user-1',
          text: '',
          media_url: MEDIA_URL,
          created_at: '2026-08-25T00:00:00Z',
        },
      ]);

      const messages = await fetchMessages(CONVERSATION_ID);

      expect(messages[0].mediaUrl).toBe(MEDIA_URL);
    });

    it('falls back to attachment_url for rows that use the older column', async () => {
      mockSelectMessages([
        {
          id: 'msg-1',
          conversation_id: CONVERSATION_ID,
          sender_id: 'user-1',
          text: '',
          media_url: null,
          attachment_url: MEDIA_URL,
          created_at: '2026-08-25T00:00:00Z',
        },
      ]);

      const messages = await fetchMessages(CONVERSATION_ID);

      expect(messages[0].mediaUrl).toBe(MEDIA_URL);
    });
  });
});
