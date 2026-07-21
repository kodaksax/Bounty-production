import { MaterialIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UseConnectEligibilityResult } from '../hooks/use-connect-eligibility';
import type { UsePayoutMethodsResult } from '../hooks/use-payout-methods';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

interface PayoutMethodsScreenProps {
  onBack: () => void;
  payoutMethods: UsePayoutMethodsResult;
  eligibility: UseConnectEligibilityResult;
}

/**
 * Payout destination management: bank accounts (standard withdrawals, one
 * can be `default` — Stripe's automatic sweep always targets whichever
 * account is default) and debit cards (Instant Cash Out only).
 *
 * Adding, removing, and setting a default account all happen in Stripe's own
 * hosted Express Dashboard (opened via openPayoutDashboard) — these Connect
 * accounts have controller.requirement_collection === "stripe", so Stripe
 * rejects any platform-side write to external accounts unconditionally. This
 * screen is read-only plus a single entry point into that dashboard.
 */
export function PayoutMethodsScreen({ onBack, payoutMethods, eligibility }: PayoutMethodsScreenProps) {
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);

  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { bankAccounts, debitCards, isLoading, openPayoutDashboard } = payoutMethods;

  const handleOpenDashboard = async () => {
    console.log('[payout-methods-screen] Manage Payout Methods button pressed');
    if (isOpeningDashboard) return;
    setIsOpeningDashboard(true);
    try {
      const result = await openPayoutDashboard();
      if (!result.ok) {
        console.error('[payout-methods-screen] openPayoutDashboard failed', result.error);
        Alert.alert('Error', result.error);
      } else {
        console.log('[payout-methods-screen] refreshing Connect eligibility after dashboard return');
        await eligibility.refresh();
      }
    } finally {
      setIsOpeningDashboard(false);
    }
  };

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onBack} style={s.backButton} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Payout Methods</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {isLoading ? (
          <ActivityIndicator size="small" color={theme.primary} style={{ marginVertical: 24 }} />
        ) : (
          <>
            {eligibility.connectedAccountExists && (
              <TouchableOpacity
                onPress={handleOpenDashboard}
                disabled={isOpeningDashboard}
                style={[s.dashboardButton, isOpeningDashboard && s.dashboardButtonDisabled]}
                accessibilityRole="button"
                accessibilityLabel="Manage payout methods"
                accessibilityHint="Opens your Stripe payout dashboard to add, remove, or set a default bank account or debit card"
              >
                {isOpeningDashboard ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <MaterialIcons name="open-in-new" size={18} color="#ffffff" />
                    <Text style={s.dashboardButtonText}>Manage Payout Methods</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <View style={s.section}>
              <View style={s.sectionHeader}>
                <View>
                  <Text style={s.sectionTitle}>Bank Account</Text>
                  <Text style={s.sectionSubtitle}>Standard withdrawals · no fee · 1-2 business days</Text>
                </View>
              </View>

              {bankAccounts.length === 0 ? (
                <View style={s.emptyState}>
                  <MaterialIcons name="account-balance" size={20} color={theme.textDisabled} />
                  <Text style={s.emptyStateText}>No bank accounts linked</Text>
                </View>
              ) : (
                bankAccounts.map(account => (
                  <View key={account.id} style={s.methodRow}>
                    <MaterialIcons name="account-balance" size={22} color={theme.text} />
                    <View style={s.methodInfo}>
                      <View style={s.methodHeaderRow}>
                        <Text style={s.methodName}>{account.bankName || 'Bank Account'} •••• {account.last4}</Text>
                        {account.default && (
                          <View style={s.defaultBadge}>
                            <Text style={s.defaultBadgeText}>Default</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.methodStatus}>Status: {account.status}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={s.section}>
              <View style={s.sectionHeader}>
                <View>
                  <Text style={s.sectionTitle}>Debit Card</Text>
                  <Text style={s.sectionSubtitle}>Instant Cash Out only · fee applies · usually minutes</Text>
                </View>
              </View>

              {debitCards.length === 0 ? (
                <View style={s.emptyState}>
                  <MaterialIcons name="credit-card" size={20} color={theme.textDisabled} />
                  <Text style={s.emptyStateText}>No debit cards linked</Text>
                </View>
              ) : (
                debitCards.map(card => (
                  <View key={card.id} style={s.methodRow}>
                    <MaterialIcons name="credit-card" size={22} color={theme.text} />
                    <View style={s.methodInfo}>
                      <View style={s.methodHeaderRow}>
                        <Text style={s.methodName}>{card.brand ?? 'Card'} •••• {card.last4}</Text>
                        {card.instantEligible ? (
                          <View style={s.instantBadge}>
                            <Text style={s.instantBadgeText}>Instant-eligible</Text>
                          </View>
                        ) : (
                          <View style={s.ineligibleBadge}>
                            <Text style={s.ineligibleBadgeText}>Not instant-eligible</Text>
                          </View>
                        )}
                      </View>
                      {card.expMonth && card.expYear ? (
                        <Text style={s.methodStatus}>Expires {card.expMonth}/{card.expYear}</Text>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </View>

            {eligibility.connectedAccountExists && (
              <TouchableOpacity
                onPress={() => router.push('/wallet/payments' as Href)}
                style={s.paymentActivityLink}
                accessibilityRole="button"
                accessibilityLabel="View payment activity"
              >
                <MaterialIcons name="receipt-long" size={20} color={theme.text} />
                <Text style={s.paymentActivityLinkText}>View Payment Activity</Text>
                <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(t: AppTheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: t.text },
  content: { padding: 16 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: t.text },
  sectionSubtitle: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
  dashboardButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.primary, borderRadius: 12, paddingVertical: 14, marginBottom: 20,
  },
  dashboardButtonDisabled: { opacity: 0.6 },
  dashboardButtonText: { fontSize: 15, fontWeight: '600', color: '#ffffff' },
  emptyState: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surfaceSecondary,
    borderRadius: 10, padding: 12,
  },
  emptyStateText: { flex: 1, fontSize: 13, color: t.textSecondary },
  methodRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceSecondary,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  methodInfo: { flex: 1, marginLeft: 12 },
  methodHeaderRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  methodName: { fontSize: 15, fontWeight: '600', color: t.text },
  methodStatus: { fontSize: 12, color: t.textDisabled, marginTop: 2 },
  defaultBadge: { backgroundColor: '#059669', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  defaultBadgeText: { fontSize: 10, fontWeight: '600', color: '#fff' },
  instantBadge: { backgroundColor: 'rgba(34,197,94,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  instantBadgeText: { fontSize: 10, fontWeight: '600', color: '#22c55e' },
  ineligibleBadge: { backgroundColor: 'rgba(148,163,184,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  ineligibleBadgeText: { fontSize: 10, fontWeight: '600', color: t.textDisabled },
  paymentActivityLink: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface,
    borderRadius: 12, padding: 14, marginTop: 4,
  },
  paymentActivityLinkText: { flex: 1, fontSize: 14, fontWeight: '600', color: t.text, marginLeft: 10 },
}); }
