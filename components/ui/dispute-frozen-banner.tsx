/**
 * DisputeFrozenBanner
 *
 * Shown inside in-progress bounty cards / screens whenever an open or
 * under_review workflow dispute exists for the bounty. Communicates that
 * the submission and review flow is paused until an admin resolves the
 * dispute, so that hunters cannot keep submitting evidence and posters
 * cannot release payout while the matter is being arbitrated.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { withAlpha } from '../../lib/utils';
import { useMemo } from 'react';

type Props = {
  message?: string;
};

const DEFAULT_MESSAGE =
  'A dispute has been opened for this bounty. The submission and review flow is paused until an admin resolves the dispute.';

export function DisputeFrozenBanner({ message }: Props) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.container}>
      <MaterialIcons name="gavel" size={18} color={theme.warningText} />
      <Text style={styles.text}>{message ?? DEFAULT_MESSAGE}</Text>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: theme.warningTint,
    borderWidth: 1,
    borderColor: withAlpha(theme.warning, 0.6),
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  text: {
    color: theme.warningText,
    fontSize: 12,
    flex: 1,
    fontWeight: '600',
  },
});
}
