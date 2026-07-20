import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useAuthContext } from '../hooks/use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { AddBankAccountModal } from './add-bank-account-modal';
import { AddDebitCardModal } from './add-debit-card-modal';

interface BankAccount {
  id: string;
  bankName?: string | null;
  last4: string | null;
  accountType?: string | null;
  default: boolean;
  status: string;
}

interface DebitCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  instantEligible: boolean;
}

interface PayoutMethodsScreenProps {
  onBack: () => void;
}

/**
 * Payout destination management: bank accounts (standard withdrawals, one
 * can be `default` — Stripe's automatic sweep always targets whichever
 * account is default) and debit cards (Instant Cash Out only — deliberately
 * never has a "set default" affordance, since a card must never become
 * default_for_currency; see the constraint documented next to
 * resolveInstantDestination() in supabase/functions/connect/index.ts).
 */
export function PayoutMethodsScreen({ onBack }: PayoutMethodsScreenProps) {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [debitCards, setDebitCards] = useState<DebitCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddBank, setShowAddBank] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);

  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
    }),
    [session?.access_token]
  );

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setIsLoading(true);
    try {
      const [bankRes, cardRes] = await Promise.all([
        fetch(`${API_BASE_URL}/connect/bank-accounts`, { method: 'GET', headers: authHeaders() }),
        fetch(`${API_BASE_URL}/connect/debit-cards`, { method: 'GET', headers: authHeaders() }),
      ]);
      const bankData = bankRes.ok ? await bankRes.json() : { bankAccounts: [] };
      const cardData = cardRes.ok ? await cardRes.json() : { debitCards: [] };
      setBankAccounts(bankData.bankAccounts ?? []);
      setDebitCards(cardData.debitCards ?? []);
    } catch (error) {
      console.error('[payout-methods] Failed to load payout methods:', error);
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSetDefaultBank = async (bankAccountId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/connect/bank-accounts/${bankAccountId}/default`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('Failed to set default bank account');
      await load();
    } catch {
      Alert.alert('Error', 'Failed to update your default bank account.');
    }
  };

  const handleRemoveBank = (bankAccountId: string) => {
    Alert.alert('Remove Bank Account', 'Are you sure you want to remove this bank account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/connect/bank-accounts/${bankAccountId}`, {
              method: 'DELETE',
              headers: authHeaders(),
            });
            if (!response.ok) throw new Error('Failed to remove bank account');
            await load();
          } catch {
            Alert.alert('Error', 'Failed to remove bank account.');
          }
        },
      },
    ]);
  };

  const handleRemoveCard = (debitCardId: string) => {
    Alert.alert('Remove Debit Card', 'Are you sure you want to remove this debit card?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/connect/debit-cards/${debitCardId}`, {
              method: 'DELETE',
              headers: authHeaders(),
            });
            if (!response.ok) throw new Error('Failed to remove debit card');
            await load();
          } catch {
            Alert.alert('Error', 'Failed to remove debit card.');
          }
        },
      },
    ]);
  };

  if (showAddBank) {
    return <AddBankAccountModal onBack={() => setShowAddBank(false)} onSave={() => load()} />;
  }
  if (showAddCard) {
    return <AddDebitCardModal onBack={() => setShowAddCard(false)} onSave={() => load()} />;
  }

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
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <View>
                  <Text style={s.sectionTitle}>Bank Account</Text>
                  <Text style={s.sectionSubtitle}>Standard withdrawals · no fee · 1-2 business days</Text>
                </View>
                <TouchableOpacity onPress={() => setShowAddBank(true)} style={s.addButton} accessibilityRole="button" accessibilityLabel="Add bank account">
                  <MaterialIcons name="add" size={18} color={theme.primary} />
                  <Text style={s.addButtonText}>Add</Text>
                </TouchableOpacity>
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
                      {!account.default && (
                        <TouchableOpacity onPress={() => handleSetDefaultBank(account.id)} accessibilityRole="button" accessibilityLabel="Make default">
                          <Text style={s.setDefaultLink}>Make Default</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => handleRemoveBank(account.id)} style={s.removeButton} accessibilityRole="button" accessibilityLabel="Remove bank account">
                      <MaterialIcons name="close" size={20} color={theme.textDisabled} />
                    </TouchableOpacity>
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
                <TouchableOpacity onPress={() => setShowAddCard(true)} style={s.addButton} accessibilityRole="button" accessibilityLabel="Add debit card">
                  <MaterialIcons name="add" size={18} color={theme.primary} />
                  <Text style={s.addButtonText}>Add</Text>
                </TouchableOpacity>
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
                    <TouchableOpacity onPress={() => handleRemoveCard(card.id)} style={s.removeButton} accessibilityRole="button" accessibilityLabel="Remove debit card">
                      <MaterialIcons name="close" size={20} color={theme.textDisabled} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
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
  addButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceSecondary,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  addButtonText: { fontSize: 14, fontWeight: '600', color: t.primary, marginLeft: 4 },
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
  setDefaultLink: { fontSize: 12, fontWeight: '600', color: t.primary, marginTop: 4 },
  removeButton: { padding: 8 },
}); }
