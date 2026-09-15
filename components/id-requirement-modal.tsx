import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { AppModal } from './ui/app-modal';
import { Button } from './ui/button';

export interface IdRequirementModalProps {
  visible: boolean;
  onCancel: () => void;
  /** Navigates into the existing ID-verification handoff. */
  onVerify: () => void;
}

/**
 * Shown when a hunter tries to apply to a bounty with requires_id_verified
 * set and they aren't ID-verified themselves. The real gate is server-side
 * (a BEFORE INSERT trigger on bounty_requests — see
 * supabase/migrations/20260915053615_bounty_trust_tier.sql); this exists so
 * they see it before investing time in a pitch, framed around what it takes
 * to be CHOSEN for this specific bounty rather than a generic "verify to get
 * paid faster" pitch.
 */
export function IdRequirementModal({ visible, onCancel, onVerify }: IdRequirementModalProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);

  return (
    <AppModal visible={visible} onRequestClose={onCancel} variant="dialog">
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="verified-user" size={32} color={theme.primary} />
        </View>
        <Text style={styles.title}>This poster requires ID verification</Text>
        <Text style={styles.body}>
          Only ID-verified hunters can apply to this bounty. Verifying your ID is quick and is what
          this poster is looking for before choosing someone.
        </Text>
        <Button variant="default" onPress={onVerify} style={styles.verifyButton}>
          Verify ID
        </Button>
        <Button variant="ghost" onPress={onCancel} style={styles.cancelButton}>
          Not now
        </Button>
      </View>
    </AppModal>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: theme.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 20,
      alignItems: 'center',
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 2,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
    },
    verifyButton: { width: '100%', marginBottom: 10 },
    cancelButton: { width: '100%' },
  });
}
