/**
 * Per-user trust indicators: "Government ID verified", "Human verified",
 * "Verified since <date>". Distinct from components/ui/trust-badges.tsx,
 * which is PLATFORM-level (escrow, secure payments, etc.) rather than
 * about a specific user's own verification state.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export interface TrustIndicatorsProps {
  /** ISO timestamp of when this user's Stripe Identity verification first succeeded. */
  verifiedSince?: string | null;
}

function formatVerifiedSince(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

/**
 * Renders the 3 "Verified" trust lines for a user who has completed Stripe
 * Identity verification. Callers are expected to only render this when the
 * user is actually verified (stripe_identity_status === 'verified' or
 * legacy id_verification_status === 'verified') -- it has no internal
 * unverified state, unlike VerificationBadge.
 */
export function TrustIndicators({ verifiedSince }: TrustIndicatorsProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const sinceLabel = formatVerifiedSince(verifiedSince);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <MaterialIcons name="check-circle" size={16} color="#059669" accessibilityElementsHidden />
        <Text style={styles.text}>Government ID verified</Text>
      </View>
      <View style={styles.row}>
        <MaterialIcons name="check-circle" size={16} color="#059669" accessibilityElementsHidden />
        <Text style={styles.text}>Human verified</Text>
      </View>
      {sinceLabel && (
        <View style={styles.row}>
          <MaterialIcons name="check-circle" size={16} color="#059669" accessibilityElementsHidden />
          <Text style={styles.text}>Verified since {sinceLabel}</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.isDark ? 'rgba(16,185,129,0.1)' : 'rgba(5,150,105,0.07)',
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    text: { fontSize: 13, color: theme.text, fontWeight: '500' },
  });
}
