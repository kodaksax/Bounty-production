/**
 * One conversation in the My Bounties inbox, rendered with the exact row the
 * Messages inbox uses (components/messaging/conversation-list-row.tsx): the
 * person on the other side of the bounty — their avatar and name — the time,
 * and the latest message.
 *
 * The only addition is a small line underneath naming the bounty and its
 * status, since the same person can be on more than one of your bounties.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { generateInitials } from 'lib/services/supabase-messaging';
import { userProfileService } from 'lib/services/userProfile';
import { getValidAvatarUrl } from 'lib/utils/avatar-utils';
import type { BountyDisplayStatus } from 'lib/utils/bounty-display-status';
import { formatConversationTime } from 'lib/utils/conversation-rows';
import { ConversationListRow } from '../messaging/conversation-list-row';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { StatusBadge } from './status-badge';

export interface InboxPerson {
  id: string;
  name?: string | null;
  avatar?: string | null;
}

// Module-level so scrolling the list doesn't refetch the same profile per row.
const profileCache = new Map<string, Promise<{ name: string | null; avatar: string | null }>>();

function loadPerson(id: string) {
  let p = profileCache.get(id);
  if (!p) {
    p = userProfileService
      .getProfile(id)
      .then(prof => ({ name: (prof as any)?.username ?? null, avatar: (prof as any)?.avatar ?? null }))
      .catch(() => ({ name: null, avatar: null }));
    profileCache.set(id, p);
  }
  return p;
}

/** Fills in a person's name/avatar when the list row didn't already carry it. */
export function useInboxPerson(person: InboxPerson | null | undefined): InboxPerson | null {
  const [resolved, setResolved] = useState<InboxPerson | null>(person ?? null);
  const id = person?.id;
  const needsFetch = !!id && (!person?.name || !person?.avatar);
  useEffect(() => {
    setResolved(person ?? null);
    if (!id || !needsFetch) return;
    let alive = true;
    loadPerson(id).then(p => {
      if (!alive) return;
      setResolved({ id, name: person?.name || p.name, avatar: person?.avatar || p.avatar });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, person?.name, person?.avatar]);
  return resolved;
}

interface BountyConversationRowProps {
  /** Who the viewer is dealing with on this bounty; null when nobody yet. */
  person: InboxPerson | null;
  /** Shown as the name when there is no person (an open bounty, no applicants). */
  emptyName?: string;
  bountyTitle: string;
  status: BountyDisplayStatus;
  preview: string;
  timeIso?: string | null;
  unread?: number;
  yourTurn?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

export function BountyConversationRow({
  person,
  emptyName = 'Waiting for applicants',
  bountyTitle,
  status,
  preview,
  timeIso,
  unread = 0,
  yourTurn,
  onPress,
  onLongPress,
}: BountyConversationRowProps) {
  const { theme } = useAppThemeContext();
  const router = useRouter();
  const p = useInboxPerson(person);
  const displayName = p?.name || (person ? 'User' : emptyName);

  return (
    <ConversationListRow
      displayName={displayName}
      avatarUrl={getValidAvatarUrl(p?.avatar ?? undefined)}
      initials={p?.name ? generateInitials(p.name) : undefined}
      fallbackIcon={person ? undefined : 'hourglass-empty'}
      timeLabel={timeIso ? formatConversationTime(timeIso) : undefined}
      preview={preview}
      unread={unread}
      onPress={onPress}
      onLongPress={onLongPress}
      onAvatarPress={person ? () => router.push(`/profile/${person.id}` as never) : undefined}
      accessibilityHint={`Opens the conversation about ${bountyTitle}`}
      meta={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <StatusBadge status={status} />
          {yourTurn && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: '#d97706' }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>YOUR MOVE</Text>
            </View>
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
            {bountyTitle}
          </Text>
        </View>
      }
    />
  );
}
