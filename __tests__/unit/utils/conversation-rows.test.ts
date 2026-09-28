import { buildConversationRows, formatConversationTime } from '../../../lib/utils/conversation-rows';
import type { Conversation } from '../../../lib/types';

const me = 'me';

function conv(partial: Partial<Conversation> & { id: string }): Conversation {
  return { isGroup: false, name: 'x', participantIds: [me, 'other'], ...partial };
}

describe('buildConversationRows (#875)', () => {
  it('collapses every 1:1 conversation with the same person into one row', () => {
    const rows = buildConversationRows(
      [
        conv({ id: 'a1', participantIds: [me, 'arki'], lastMessage: 'Bet', updatedAt: '2026-09-14T10:00:00Z', unread: 1 }),
        conv({ id: 'a2', participantIds: [me, 'arki'], lastMessage: 'Welcome!', updatedAt: '2026-09-14T09:00:00Z', unread: 2 }),
        conv({ id: 't1', participantIds: [me, 'tahl'], lastMessage: 'Photo', updatedAt: '2026-09-13T09:00:00Z' }),
      ],
      me
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'a1',
      otherUserId: 'arki',
      lastMessage: 'Bet',
      unread: 3,
      backingConversationIds: ['a1', 'a2'],
    });
    expect(rows[1]).toMatchObject({ otherUserId: 'tahl', backingConversationIds: ['t1'] });
  });

  it('keeps the last real message when the newest conversation is empty', () => {
    const [row] = buildConversationRows(
      [
        conv({ id: 'new', updatedAt: '2026-09-27T10:00:00Z' }),
        conv({ id: 'old', lastMessage: 'See you then', updatedAt: '2026-09-10T10:00:00Z' }),
      ],
      me
    );
    expect(row.id).toBe('new');
    expect(row.lastMessage).toBe('See you then');
    expect(row.updatedAt).toBe('2026-09-27T10:00:00Z');
  });

  it('never merges group conversations', () => {
    const rows = buildConversationRows(
      [
        conv({ id: 'g1', isGroup: true, participantIds: [me, 'a', 'b'] }),
        conv({ id: 'g2', isGroup: true, participantIds: [me, 'a', 'b'] }),
      ],
      me
    );
    expect(rows.map((r) => r.id).sort()).toEqual(['g1', 'g2']);
    expect(rows.every((r) => r.otherUserId === null)).toBe(true);
  });

  it('orders rows by latest activity, undated last', () => {
    const rows = buildConversationRows(
      [
        conv({ id: 'undated', participantIds: [me, 'u'] }),
        conv({ id: 'older', participantIds: [me, 'o'], updatedAt: '2026-09-01T00:00:00Z' }),
        conv({ id: 'newer', participantIds: [me, 'n'], updatedAt: '2026-09-20T00:00:00Z' }),
      ],
      me
    );
    expect(rows.map((r) => r.id)).toEqual(['newer', 'older', 'undated']);
  });
});

describe('formatConversationTime', () => {
  const now = new Date(2026, 8, 28, 12, 0, 0); // Mon Sep 28 2026, local

  it('uses compact relative times for today', () => {
    expect(formatConversationTime(new Date(2026, 8, 28, 11, 59, 40).toISOString(), now)).toBe('Just now');
    expect(formatConversationTime(new Date(2026, 8, 28, 11, 55).toISOString(), now)).toBe('5m');
    expect(formatConversationTime(new Date(2026, 8, 28, 9, 0).toISOString(), now)).toBe('3h');
  });

  it('uses a short date instead of a full numeric one', () => {
    expect(formatConversationTime(new Date(2026, 8, 27, 8, 0).toISOString(), now)).toBe('Yesterday');
    expect(formatConversationTime(new Date(2026, 8, 17, 8, 0).toISOString(), now)).toBe('Sep 17');
    expect(formatConversationTime(new Date(2025, 8, 17, 8, 0).toISOString(), now)).toBe('Sep 17, 2025');
  });

  it('returns empty for missing or invalid input', () => {
    expect(formatConversationTime(undefined, now)).toBe('');
    expect(formatConversationTime('not a date', now)).toBe('');
  });
});
