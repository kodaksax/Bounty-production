/**
 * The conversation row from the Messages inbox: avatar, the other person's
 * name, time, last-message preview and an unread dot.
 *
 * Shared so the My Bounties inbox renders its threads with exactly the same
 * row as Messages. Purely presentational — callers resolve the name/avatar and
 * own any swipe/long-press behaviour around it.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar, AvatarFallback, AvatarImage } from 'components/ui/avatar';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

export interface ConversationListRowProps {
  displayName: string;
  avatarUrl?: string | null;
  initials?: string;
  /** Shown instead of initials when there is no person (e.g. no applicants yet). */
  fallbackIcon?: keyof typeof MaterialIcons.glyphMap;
  timeLabel?: string;
  preview: string;
  unread?: number;
  /** Optional extra line under the preview. */
  meta?: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  /** Tapping the avatar (e.g. to open the profile). Omit to make it inert. */
  onAvatarPress?: () => void;
  accessibilityHint?: string;
}

export function ConversationListRow({
  displayName,
  avatarUrl,
  initials,
  fallbackIcon,
  timeLabel,
  preview,
  unread = 0,
  meta,
  onPress,
  onLongPress,
  onAvatarPress,
  accessibilityHint = 'Opens the conversation',
}: ConversationListRowProps) {
  const { theme } = useAppThemeContext();
  const hasUnread = unread > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={
        hasUnread ? `${displayName}, ${unread} unread. ${preview}` : `${displayName}. ${preview}`
      }
      accessibilityHint={accessibilityHint}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.background,
      }}
    >
      <TouchableOpacity
        onPress={onAvatarPress}
        disabled={!onAvatarPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`View ${displayName}'s profile`}
        style={{ marginRight: theme.spacing.md }}
      >
        <Avatar className="h-12 w-12">
          <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
          <AvatarFallback style={{ backgroundColor: theme.surfaceSecondary }}>
            {fallbackIcon ? (
              <MaterialIcons name={fallbackIcon} size={20} color={theme.primary} />
            ) : (
              <Text style={{ color: theme.primary, fontSize: 15, fontWeight: '700' }}>
                {initials || '?'}
              </Text>
            )}
          </AvatarFallback>
        </Avatar>
      </TouchableOpacity>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              marginRight: theme.spacing.sm,
              fontSize: theme.typography.fontSize.base,
              fontWeight: hasUnread ? '700' : '600',
              color: theme.text,
            }}
          >
            {displayName}
          </Text>
          {!!timeLabel && (
            <Text
              style={{
                fontSize: theme.typography.fontSize.xs,
                fontWeight: hasUnread ? '600' : '400',
                color: hasUnread ? theme.primary : theme.textDisabled,
              }}
            >
              {timeLabel}
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              marginRight: hasUnread ? theme.spacing.sm : 0,
              fontSize: theme.typography.fontSize.sm,
              fontWeight: hasUnread ? '500' : '400',
              color: hasUnread ? theme.text : theme.textSecondary,
            }}
          >
            {preview}
          </Text>
          {hasUnread && (
            <View
              accessibilityElementsHidden={true}
              importantForAccessibility="no"
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primary }}
            />
          )}
        </View>

        {meta}
      </View>
    </TouchableOpacity>
  );
}
