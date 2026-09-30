import type { Conversation } from '../types';

/**
 * A row in the conversation list. Every bounty opens its own 1:1
 * conversation, so one person can back several conversations; the list shows
 * them as a single row. `conversationIds` holds every conversation merged into
 * the row so read/delete actions reach all of them.
 */
export type ConversationListRow = Conversation & { conversationIds: string[] };

function timeOf(conversation: Conversation): number {
  const t = conversation.updatedAt ? Date.parse(conversation.updatedAt) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Collapse 1:1 conversations into one row per other user, like a DM list.
 * The row takes the name, avatar, last message and id of that user's most
 * recently active conversation, sums unread counts across all of them, and
 * rows are ordered newest activity first. Group conversations stay as-is.
 * Conversations with no messages yet are left out.
 */
export function groupConversationsByUser(
  conversations: Conversation[],
  currentUserId: string | null | undefined
): ConversationListRow[] {
  const rowsByKey = new Map<string, ConversationListRow>();

  for (const conversation of conversations) {
    // Opening a DM (e.g. from a profile's Message button) creates the
    // conversation up front, before anything is sent. It only belongs in the
    // list once a message exists — fetchConversations leaves lastMessage
    // undefined exactly when there are none (attachment-only messages get a
    // media label, so they still count).
    if (conversation.lastMessage === undefined) continue;

    const otherUserId = !conversation.isGroup
      ? conversation.participantIds?.find(id => id !== currentUserId)
      : undefined;
    const key = otherUserId ? `user:${otherUserId}` : `conv:${conversation.id}`;

    const existing = rowsByKey.get(key);
    if (!existing) {
      rowsByKey.set(key, { ...conversation, conversationIds: [conversation.id] });
      continue;
    }

    const unread = (existing.unread ?? 0) + (conversation.unread ?? 0);
    const conversationIds = [...existing.conversationIds, conversation.id];
    const latest = timeOf(conversation) > timeOf(existing) ? conversation : existing;
    rowsByKey.set(key, { ...latest, unread, conversationIds });
  }

  return [...rowsByKey.values()].sort((a, b) => timeOf(b) - timeOf(a));
}
