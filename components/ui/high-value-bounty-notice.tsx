import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** Bounty amounts at or above this threshold trigger the high-value notice. */
export const HIGH_VALUE_BOUNTY_THRESHOLD = 100;

/**
 * HighValueBountyNotice — displayed when a bounty amount meets or exceeds
 * HIGH_VALUE_BOUNTY_THRESHOLD. Surfaces the extra rules that apply to
 * high-value postings so posters know what to expect before submitting.
 */
export function HighValueBountyNotice() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="workspace-premium" size={20} color="#fbbf24" />
        <Text style={styles.title}>High-Value Bounty Rules</Text>
      </View>

      <Text style={styles.subtitle}>
        Bounties over ${HIGH_VALUE_BOUNTY_THRESHOLD} require extra safeguards to protect both parties.
      </Text>

      <View style={styles.ruleList}>
        <RuleRow icon="verified-user" text="Identity verification required before the bounty goes live" />
        <RuleRow icon="photo-camera" text="Photo or document proof of work may be required at completion" />
        <RuleRow icon="account-balance-wallet" text="Milestone payments are encouraged for staged work" />
        <RuleRow icon="rate-review" text="A brief manual review may be triggered for first-time high-value postings" />
      </View>

      <TouchableOpacity
        style={styles.learnMore}
        onPress={() => router.push('/legal/safety')}
        accessibilityRole="link"
        accessibilityLabel="Learn more about how Bounty stays safe"
      >
        <MaterialIcons name="info-outline" size={14} color="#6ee7b7" />
        <Text style={styles.learnMoreText}>How Bounty stays safe</Text>
      </TouchableOpacity>
    </View>
  );
}

function RuleRow({ icon, text }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; text: string }) {
  return (
    <View style={styles.ruleRow}>
      <MaterialIcons name={icon} size={16} color="#fbbf24" style={styles.ruleIcon} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fbbf24',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(251,191,36,0.8)',
    marginBottom: 12,
    lineHeight: 17,
  },
  ruleList: {
    gap: 8,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  ruleIcon: {
    marginTop: 1,
  },
  ruleText: {
    flex: 1,
    fontSize: 12,
    color: 'rgba(255,254,245,0.85)',
    lineHeight: 17,
  },
  learnMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  learnMoreText: {
    fontSize: 12,
    color: '#6ee7b7',
    textDecorationLine: 'underline',
  },
});
