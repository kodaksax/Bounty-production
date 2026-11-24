/**
 * The side label ("You posted this", "You offered", "You're doing this",
 * "You did this"): words first, then icon and colour, never colour alone.
 * Kept apart from the workspace header so screens that only need the label
 * (the job thread's strip) don't load the header's image dependency.
 */
import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { PosterPalette } from '../../lib/themes/poster-palette';

export type WorkspaceSide = 'posted' | 'offered' | 'doing' | 'did';

export const SIDE_LABELS: Record<WorkspaceSide, { text: string; icon: IconName }> = {
  posted: { text: 'You posted this', icon: 'assignment-ind' },
  offered: { text: 'You offered', icon: 'send' },
  doing: { text: "You're doing this", icon: 'construction' },
  did: { text: 'You did this', icon: 'task-alt' },
};

/** The handoff's colour role for each side (posted green, offered neutral, doing/did blue). */
export function sideColors(p: PosterPalette, side: WorkspaceSide): { bg: string; fg: string } {
  switch (side) {
    case 'posted':
      return { bg: p.gtint, fg: p.ink };
    case 'offered':
      return { bg: p.chip, fg: p.ink };
    default:
      return { bg: p.itint, fg: p.it };
  }
}

export function SidePill({ side, size = 'small', testID }: { side: WorkspaceSide; size?: 'small' | 'large'; testID?: string }) {
  const { theme } = useAppThemeContext();
  const { text, icon } = SIDE_LABELS[side];
  const { bg, fg } = sideColors(theme.poster, side);
  const large = size === 'large';
  return (
    <View
      style={[styles.pill, { backgroundColor: bg }, large && styles.pillLarge]}
      testID={testID ?? `side-label-${side}`}
    >
      <MaterialIcons name={icon} size={large ? 18 : 16} color={fg} />
      <Text style={[styles.pillText, { color: fg }, large && styles.pillTextLarge]}>{text}</Text>
    </View>
  );
}


const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 3,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 999,
  },
  pillLarge: { paddingVertical: 6, paddingLeft: 9, paddingRight: 12, gap: 6 },
  pillText: { fontSize: 13, fontWeight: '800' },
  pillTextLarge: { fontSize: 14 },
});
