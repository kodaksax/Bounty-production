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

type Props = {
  message?: string;
};

const DEFAULT_MESSAGE =
  'A dispute has been opened for this bounty. The submission and review flow is paused until an admin resolves the dispute.';

export function DisputeFrozenBanner({ message }: Props) {
  return (
    <View style={styles.container}>
      <MaterialIcons name="gavel" size={18} color="#fbbf24" />
      <Text style={styles.text}>{message ?? DEFAULT_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(120, 53, 15, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.6)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  text: {
    color: '#fde68a',
    fontSize: 12,
    flex: 1,
    fontWeight: '600',
  },
});
