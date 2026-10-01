// lib/utils/conversation-rows.ts
//
// Builds the inbox rows for the Messages screen (app/tabs/messenger-screen.tsx).
//
// Every bounty gets its own backing conversation, so one person you worked
// with twice showed up as two or three rows (#875). Tapping any of them opens
// the same merged thread (ROUTES.MESSAGES.WITH_USER), so the extra rows were
// pure duplication. The inbox now shows one row per person: the latest
// activity, the most recent message preview, and the unread count summed
// across every backing conversation. Group conversations stay one row each.

import type { Conversation } from '../types';

export interface ConversationRow extends Conversation {
  /** The other participant of a 1:1 row; null for groups. */
  otherUserId: string | null;
  /** Every conversation this row stands for (read/delete act on all of them). */
  backingConversationIds: string[];
}

function timeOf(conv: Conversation): number {
  const t = conv.updatedAt ? Date.parse(conv.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function buildConversationRows(
  conversations: Conversation[],
  currentUserId: string | null | undefined
): ConversationRow[] {
  const byPerson = new Map<string, Conversation[]>();
  const rows: ConversationRow[] = [];

  for (const conv of conversations) {
    const otherUserId = !conv.isGroup
      ? conv.participantIds?.find((id) => id !== currentUserId) ?? null
      : null;
    if (!otherUserId) {
      rows.push({ ...conv, otherUserId: null, backingConversationIds: [conv.id] });
      continue;
    }
    const list = byPerson.get(otherUserId);
    if (list) list.push(conv);
    else byPerson.set(otherUserId, [conv]);
  }

  for (const [otherUserId, list] of byPerson) {
    const sorted = [...list].sort((a, b) => timeOf(b) - timeOf(a));
    const latest = sorted[0];
    // An empty conversation (created, never written in) must not hide the
    // last thing actually said to this person.
    // lastMessage is undefined only when a conversation has no messages; an
    // empty-string preview is still a message.
    const withMessage = sorted.find((c) => c.lastMessage !== undefined);
    rows.push({
      ...latest,
      lastMessage: withMessage?.lastMessage,
      // Sort by the last real message too: opening a DM from someone's
      // profile creates an empty conversation, which would otherwise bump an
      // old contact to the top without anything having been said.
      updatedAt: (withMessage ?? latest).updatedAt,
      unread: sorted.reduce((sum, c) => sum + (c.unread ?? 0), 0),
      otherUserId,
      backingConversationIds: sorted.map((c) => c.id),
    });
  }

  return rows.sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * The rows the Messages list actually shows: buildConversationRows, minus
 * people you haven't exchanged a message with yet. Opening a DM from a
 * profile creates the conversation before anything is sent, and it shouldn't
 * appear in the inbox until something is. fetchConversations leaves
 * lastMessage undefined exactly when a conversation has no messages, so a
 * message with an empty preview still counts.
 */
export function buildVisibleConversationRows(
  conversations: Conversation[],
  currentUserId: string | null | undefined
): ConversationRow[] {
  return buildConversationRows(conversations, currentUserId).filter(
    (row) => row.isGroup || row.lastMessage !== undefined
  );
}

/**
 * "Just now" / "5m" / "3h" / "Yesterday" / "Tue" / "Sep 17" / "Sep 17, 2025".
 * Replaces toLocaleDateString(), which rendered a full "9/17/2026" in a
 * narrow column.
 */
export function formatConversationTime(updatedAt?: string, now: Date = new Date()): string {
  if (!updatedAt) return '';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h`;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (dayDiff <= 1) return 'Yesterday';
  if (dayDiff < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
