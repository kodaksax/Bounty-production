/**
 * "What's happened": the job's history in plain words, oldest first, with
 * the one thing that happens next shown greyed at the end.
 *
 * Every row comes from buildPosterTimeline, which only lists events backed by
 * a real row or status. A row with no reliable time shows no time rather than
 * a guessed one.
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { formatAgo, type PosterTimelineEvent } from '../../lib/utils/poster-plain-copy';

interface Props {
  events: PosterTimelineEvent[];
  upcoming: string | null;
  now?: Date;
}

export function JobTimeline({ events, upcoming, now }: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (events.length === 0) return null;

  return (
    <View style={s.card} testID="poster-timeline">
      <Text style={s.title} accessibilityRole="header">
        {"What's happened"}
      </Text>
      {events.map((e, i) => {
        const ago = formatAgo(e.at, now);
        return (
          <View
            key={`${e.key}-${i}`}
            style={s.row}
            accessible
            accessibilityLabel={ago ? `${e.label}, ${ago}` : e.label}
            testID={`timeline-${e.key}`}
          >
            <View style={s.markerCol}>
              <View style={s.dotDone}>
                <MaterialIcons name="check" size={14} color={theme.onPrimary} />
              </View>
              {i < events.length - 1 || upcoming ? <View style={s.line} /> : null}
            </View>
            <View style={s.textCol}>
              <Text style={s.label}>{e.label}</Text>
              {ago ? <Text style={s.time}>{ago}</Text> : null}
            </View>
          </View>
        );
      })}
      {upcoming ? (
        <View style={s.row} accessible accessibilityLabel={upcoming} testID="timeline-upcoming">
          <View style={s.markerCol}>
            <View style={s.dotNext} />
          </View>
          <View style={s.textCol}>
            <Text style={s.upcoming}>{upcoming}</Text>
          </View>
        </View>
      ) : null}
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
    },
    title: { color: t.text, fontSize: 20, fontWeight: '800', marginBottom: 12 },
    row: { flexDirection: 'row', gap: 12 },
    markerCol: { width: 24, alignItems: 'center' },
    dotDone: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotNext: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    line: { flex: 1, width: 2, backgroundColor: t.border, minHeight: 16 },
    textCol: { flex: 1, paddingBottom: 14 },
    label: { color: t.text, fontSize: 17, lineHeight: 24, fontWeight: '600' },
    time: { color: t.textSecondary, fontSize: 15, lineHeight: 21 },
    upcoming: { color: t.textSecondary, fontSize: 17, lineHeight: 24 },
  });
}
