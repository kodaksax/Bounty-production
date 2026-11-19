/**
 * "Who's doing the job": the chosen person, when they were chosen, and when
 * they last wrote, with Message and View profile one tap away.
 *
 * "Last message" only renders from a successful message read; while it is
 * unknown the line is simply absent, never "hasn't messaged yet".
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { formatAgo } from '../../lib/utils/poster-plain-copy';

interface Props {
  name: string;
  avatar: string | null;
  hiredAt: string | null;
  lastHelperMessageAt: string | null;
  messagesKnown: boolean;
  /** Finished jobs show "Did the job" rather than "Doing the job". */
  finished: boolean;
  onMessage: () => void;
  onViewProfile: (() => void) | null;
  isOpeningMessage?: boolean;
  now?: Date;
}

export function HelperCard({
  name,
  avatar,
  hiredAt,
  lastHelperMessageAt,
  messagesKnown,
  finished,
  onMessage,
  onViewProfile,
  isOpeningMessage = false,
  now,
}: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const chosenAgo = formatAgo(hiredAt, now);
  const lastAgo = formatAgo(lastHelperMessageAt, now);
  const contactLine = !messagesKnown
    ? null
    : lastAgo
      ? `Last message from ${name}: ${lastAgo}`
      : `${name} hasn't sent a message yet`;

  return (
    <View style={s.card} testID="poster-helper-card">
      <Text style={s.title} accessibilityRole="header">
        {finished ? 'Who did the job' : "Who's doing the job"}
      </Text>
      <View style={s.personRow}>
        {avatar ? (
          <ExpoImage source={{ uri: avatar }} style={s.avatar} recyclingKey={avatar} accessibilityLabel={`${name}'s photo`} />
        ) : (
          <View style={[s.avatar, s.avatarFallback]}>
            <MaterialIcons name="person" size={30} color={theme.textSecondary} />
          </View>
        )}
        <View style={s.personText}>
          <Text style={s.name}>{name}</Text>
          {chosenAgo ? <Text style={s.meta}>{`You chose ${name} ${chosenAgo}`}</Text> : null}
          {contactLine && !finished ? (
            <Text style={s.meta} testID="poster-helper-last-message">
              {contactLine}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={s.actions}>
        <TouchableOpacity
          style={s.btn}
          onPress={onMessage}
          disabled={isOpeningMessage}
          accessibilityRole="button"
          accessibilityLabel={`Message ${name}`}
          accessibilityState={{ busy: isOpeningMessage }}
          testID="poster-helper-message"
        >
          {isOpeningMessage ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <MaterialIcons name="chat-bubble-outline" size={20} color={theme.text} />
          )}
          <Text style={s.btnText}>Message</Text>
        </TouchableOpacity>
        {onViewProfile ? (
          <TouchableOpacity
            style={s.btn}
            onPress={onViewProfile}
            accessibilityRole="button"
            accessibilityLabel={`View ${name}'s profile`}
            testID="poster-helper-profile"
          >
            <MaterialIcons name="person-search" size={20} color={theme.text} />
            <Text style={s.btnText}>View profile</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 18,
      borderWidth: 1,
      ...t.insetBorder,
      padding: 18,
      marginBottom: 16,
      gap: 14,
    },
    title: { color: t.text, fontSize: 20, fontWeight: '800' },
    personRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: t.surfaceSecondary },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    personText: { flex: 1, gap: 3 },
    name: { color: t.text, fontSize: 19, fontWeight: '800' },
    meta: { color: t.textSecondary, fontSize: 16, lineHeight: 22 },
    actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    btn: {
      flexGrow: 1,
      flexBasis: 140,
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 14,
    },
    btnText: { color: t.text, fontSize: 17, fontWeight: '600' },
  });
}
