// app/(admin)/withdrawal-recovery.tsx - Admin withdrawal recovery tool
//
// Calls the admin-withdrawals Edge Function to (a) force-retry a
// permanently_failed withdrawal beyond the 3-attempt client cap, or
// (b) apply a manual balance credit/debit for CRITICAL/orphaned-
// reconciliation cases. Before this screen existed, every such case required
// an engineer running SQL directly against production — see
// docs/withdrawals/02-support-runbook.md.
//
// Every action is server-side audited (admin_action_log) regardless of
// outcome; this screen also shows the most recent entries so support can
// confirm an action actually happened without needing DB access.

import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { supabase } from '../../lib/supabase';

interface AdminActionLogEntry {
  id: string;
  admin_user_id: string;
  action_type:
    | 'force_retry_withdrawal'
    | 'manual_balance_adjustment'
    | 'mark_externally_settled_withdrawal'
    | 'reverse_stripe_transfer';
  target_user_id: string;
  target_transaction_id: string | null;
  amount: number | null;
  reason: string;
  result: 'success' | 'failure';
  created_at: string;
}

async function callAdminWithdrawals(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  const { data, error } = await supabase.functions.invoke('admin-withdrawals', {
    body,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (error) throw new Error(error.message || 'Request failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function AdminWithdrawalRecoveryScreen() {
  const [retryTransactionId, setRetryTransactionId] = useState('');
  const [retryReason, setRetryReason] = useState('');
  const [retrying, setRetrying] = useState(false);

  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustRelatedTx, setAdjustRelatedTx] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const [settleTransactionId, setSettleTransactionId] = useState('');
  const [settleReason, setSettleReason] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [settleBalanceAdjustment, setSettleBalanceAdjustment] = useState('');
  const [settleConfirmed, setSettleConfirmed] = useState(false);
  const [settling, setSettling] = useState(false);

  const [reverseTransactionId, setReverseTransactionId] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  const [runningReconciliation, setRunningReconciliation] = useState(false);

  const [log, setLog] = useState<AdminActionLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const data = await callAdminWithdrawals({ action: 'list_log', limit: 25 });
      setLog((data?.entries ?? []) as AdminActionLogEntry[]);
    } catch {
      // Non-fatal — the log is a convenience view, not required for the
      // actions above to function.
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  const submitForceRetry = () => {
    if (!retryTransactionId.trim() || !retryReason.trim()) {
      Alert.alert('Missing information', 'Transaction ID and reason are both required.');
      return;
    }
    Alert.alert(
      'Force-retry this withdrawal?',
      'This bypasses the 3-attempt client cap and will attempt a real Stripe transfer using this hunter’s current balance and payout destination. Only do this after confirming the underlying issue is resolved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force Retry',
          style: 'destructive',
          onPress: async () => {
            setRetrying(true);
            try {
              const data = await callAdminWithdrawals({
                action: 'force_retry',
                transactionId: retryTransactionId.trim(),
                reason: retryReason.trim(),
              });
              Alert.alert('Retry submitted', `Transfer ${data.transferId} created.`);
              setRetryTransactionId('');
              setRetryReason('');
              loadLog();
            } catch (err) {
              Alert.alert('Retry failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setRetrying(false);
            }
          },
        },
      ]
    );
  };

  const submitAdjustment = () => {
    const amountNum = Number(adjustAmount);
    if (!adjustUserId.trim() || !adjustReason.trim() || !Number.isFinite(amountNum) || amountNum === 0) {
      Alert.alert(
        'Missing information',
        'User ID, a non-zero amount, and a reason are all required. Use a negative amount to debit.'
      );
      return;
    }
    Alert.alert(
      'Apply manual balance adjustment?',
      `This will ${amountNum > 0 ? 'credit' : 'debit'} $${Math.abs(amountNum).toFixed(2)} on this user's balance immediately. This is a real, audited financial action.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          style: 'destructive',
          onPress: async () => {
            setAdjusting(true);
            try {
              const data = await callAdminWithdrawals({
                action: 'manual_adjustment',
                userId: adjustUserId.trim(),
                amount: amountNum,
                reason: adjustReason.trim(),
                relatedTransactionId: adjustRelatedTx.trim() || undefined,
              });
              Alert.alert('Adjustment applied', `New balance: $${Number(data.newBalance).toFixed(2)}`);
              setAdjustUserId('');
              setAdjustAmount('');
              setAdjustReason('');
              setAdjustRelatedTx('');
              loadLog();
            } catch (err) {
              Alert.alert('Adjustment failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setAdjusting(false);
            }
          },
        },
      ]
    );
  };

  const submitMarkExternallySettled = () => {
    if (!settleTransactionId.trim() || !settleReason.trim()) {
      Alert.alert('Missing information', 'Transaction ID and reason are both required.');
      return;
    }
    if (!settleConfirmed) {
      Alert.alert(
        'Confirmation required',
        "Check the box confirming you've verified in the Stripe Dashboard that no payout has landed for this withdrawal before marking it externally settled."
      );
      return;
    }
    const adjustmentNum = settleBalanceAdjustment.trim() ? Number(settleBalanceAdjustment) : 0;
    if (settleBalanceAdjustment.trim() && !Number.isFinite(adjustmentNum)) {
      Alert.alert('Invalid amount', 'Balance adjustment must be a number, or leave it blank for no adjustment.');
      return;
    }
    Alert.alert(
      'Mark as externally settled?',
      'This permanently marks the withdrawal as paid outside the app (status: manually_paid) and prevents it from ever being retried or refunded automatically. Only do this after confirming in Stripe that no payout has landed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Settled',
          style: 'destructive',
          onPress: async () => {
            setSettling(true);
            try {
              const data = await callAdminWithdrawals({
                action: 'mark_externally_settled',
                transactionId: settleTransactionId.trim(),
                reason: settleReason.trim(),
                note: settleNote.trim() || undefined,
                confirmedNoStripePayout: true,
                balanceAdjustment: adjustmentNum || undefined,
              });
              Alert.alert(
                data.alreadySettled ? 'Already settled' : 'Marked as settled',
                data.alreadySettled
                  ? 'This transaction was already marked manually_paid — no changes made.'
                  : `Transaction ${data.transactionId} is now manually_paid.`
              );
              setSettleTransactionId('');
              setSettleReason('');
              setSettleNote('');
              setSettleBalanceAdjustment('');
              setSettleConfirmed(false);
              loadLog();
            } catch (err) {
              Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setSettling(false);
            }
          },
        },
      ]
    );
  };

  const submitReverseTransfer = () => {
    if (!reverseTransactionId.trim() || !reverseReason.trim()) {
      Alert.alert('Missing information', 'Transaction ID and reason are both required.');
      return;
    }
    Alert.alert(
      'Reverse the Stripe transfer?',
      'This pulls the funds back from the hunter’s connected-account Stripe balance to the platform, preventing a future automatic payout. Only works on a transaction already marked manually_paid — use "Mark Withdrawal as Externally Settled" first. This is a real, irreversible-from-here Stripe action.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reverse Transfer',
          style: 'destructive',
          onPress: async () => {
            setReversing(true);
            try {
              const data = await callAdminWithdrawals({
                action: 'reverse_transfer',
                transactionId: reverseTransactionId.trim(),
                reason: reverseReason.trim(),
              });
              Alert.alert(
                data.alreadyReversed ? 'Already reversed' : 'Transfer reversed',
                data.alreadyReversed
                  ? 'This transfer was already reversed — no changes made.'
                  : `Reversal ${data.reversalId} created.`
              );
              setReverseTransactionId('');
              setReverseReason('');
              loadLog();
            } catch (err) {
              Alert.alert('Reversal failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setReversing(false);
            }
          },
        },
      ]
    );
  };

  const runReconciliationNow = async () => {
    setRunningReconciliation(true);
    try {
      const data = await callAdminWithdrawals({ action: 'run_reconciliation' });
      Alert.alert(
        'Reconciliation run complete',
        `${data.findingCountThisRun} new finding(s) this run. ${data.unacknowledgedFindings?.length ?? 0} total unacknowledged.`
      );
    } catch (err) {
      Alert.alert('Reconciliation failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunningReconciliation(false);
    }
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Withdrawal Recovery" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Force-Retry a Failed Withdrawal</Text>
        <AdminCard>
          <Text style={styles.hint}>
            For a withdrawal with status &apos;failed&apos; that has exhausted its 3 self-service
            retries (metadata.transfer_status = &apos;permanently_failed&apos;). Confirm the
            original failure cause is resolved before retrying.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="wallet_transactions.id"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={retryTransactionId}
            onChangeText={setRetryTransactionId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Reason (required, goes in the audit log)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={retryReason}
            onChangeText={setRetryReason}
            multiline
          />
          <TouchableOpacity
            style={[styles.button, retrying && styles.buttonDisabled]}
            onPress={submitForceRetry}
            disabled={retrying}
          >
            {retrying ? (
              <ActivityIndicator color="#fffef5" />
            ) : (
              <Text style={styles.buttonText}>Force Retry</Text>
            )}
          </TouchableOpacity>
        </AdminCard>

        <Text style={styles.sectionTitle}>Manual Balance Adjustment</Text>
        <AdminCard>
          <Text style={styles.hint}>
            For CRITICAL/orphaned-reconciliation cases only (e.g. a refund RPC failed after a
            failed transfer). Positive amount credits, negative debits. Writes a real
            &apos;admin_adjustment&apos; ledger row.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="User ID (profiles.id)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={adjustUserId}
            onChangeText={setAdjustUserId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Amount, e.g. 38.00 or -38.00"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={adjustAmount}
            onChangeText={setAdjustAmount}
            keyboardType="numbers-and-punctuation"
          />
          <TextInput
            style={styles.input}
            placeholder="Related transaction ID (optional)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={adjustRelatedTx}
            onChangeText={setAdjustRelatedTx}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Reason (required, goes in the audit log)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={adjustReason}
            onChangeText={setAdjustReason}
            multiline
          />
          <TouchableOpacity
            style={[styles.button, adjusting && styles.buttonDisabled]}
            onPress={submitAdjustment}
            disabled={adjusting}
          >
            {adjusting ? (
              <ActivityIndicator color="#fffef5" />
            ) : (
              <Text style={styles.buttonText}>Apply Adjustment</Text>
            )}
          </TouchableOpacity>
        </AdminCard>

        <Text style={styles.sectionTitle}>Mark Withdrawal as Externally Settled</Text>
        <AdminCard>
          <Text style={styles.hint}>
            For a &apos;pending&apos; or &apos;failed&apos; withdrawal paid to the hunter outside
            the app (e.g. after confirming no Stripe payout landed). Sets status to
            &apos;manually_paid&apos; — this transaction will never be auto-retried or
            auto-refunded again, and stops being flagged by reconciliation. Only use after
            verifying directly in the Stripe Dashboard that no payout has landed for this
            withdrawal.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="wallet_transactions.id"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={settleTransactionId}
            onChangeText={setSettleTransactionId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Reason (required, goes in the audit log)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={settleReason}
            onChangeText={setSettleReason}
            multiline
          />
          <TextInput
            style={styles.input}
            placeholder="Note (optional, e.g. how/when paid)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={settleNote}
            onChangeText={setSettleNote}
            multiline
          />
          <TextInput
            style={styles.input}
            placeholder="Balance adjustment (optional — leave blank if balance is already correct)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={settleBalanceAdjustment}
            onChangeText={setSettleBalanceAdjustment}
            keyboardType="numbers-and-punctuation"
          />
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setSettleConfirmed(v => !v)}
          >
            <MaterialIcons
              name={settleConfirmed ? 'check-box' : 'check-box-outline-blank'}
              size={20}
              color="#00dc50"
            />
            <Text style={styles.checkboxLabel}>
              I&apos;ve verified in the Stripe Dashboard that no payout has landed for this withdrawal
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, settling && styles.buttonDisabled]}
            onPress={submitMarkExternallySettled}
            disabled={settling}
          >
            {settling ? (
              <ActivityIndicator color="#fffef5" />
            ) : (
              <Text style={styles.buttonText}>Mark Settled</Text>
            )}
          </TouchableOpacity>
        </AdminCard>

        <Text style={styles.sectionTitle}>Reverse Stripe Transfer</Text>
        <AdminCard>
          <Text style={styles.hint}>
            Pulls the funds back from the hunter&apos;s connected-account Stripe balance to the
            platform, so Stripe&apos;s automatic payout schedule can never sweep it to their bank.
            Only works on a transaction already &apos;manually_paid&apos; — always use &quot;Mark
            Withdrawal as Externally Settled&quot; first. Doing this out of order risks resurrecting
            the balance via the transfer.reversed webhook.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="wallet_transactions.id"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={reverseTransactionId}
            onChangeText={setReverseTransactionId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Reason (required, goes in the audit log)"
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={reverseReason}
            onChangeText={setReverseReason}
            multiline
          />
          <TouchableOpacity
            style={[styles.button, reversing && styles.buttonDisabled]}
            onPress={submitReverseTransfer}
            disabled={reversing}
          >
            {reversing ? (
              <ActivityIndicator color="#fffef5" />
            ) : (
              <Text style={styles.buttonText}>Reverse Transfer</Text>
            )}
          </TouchableOpacity>
        </AdminCard>

        <Text style={styles.sectionTitle}>Reconciliation</Text>
        <AdminCard>
          <Text style={styles.hint}>
            Runs the same checks as the daily scheduled job on demand (balance drift, stuck
            pending withdrawals, duplicates, orphaned transactions). Read-only — writes
            diagnostic findings rows only, never touches balances or Stripe.
          </Text>
          <TouchableOpacity
            style={[styles.button, runningReconciliation && styles.buttonDisabled]}
            onPress={runReconciliationNow}
            disabled={runningReconciliation}
          >
            {runningReconciliation ? (
              <ActivityIndicator color="#fffef5" />
            ) : (
              <Text style={styles.buttonText}>Run Reconciliation Now</Text>
            )}
          </TouchableOpacity>
        </AdminCard>

        <View style={styles.logHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Recovery Actions</Text>
          <TouchableOpacity onPress={loadLog}>
            <MaterialIcons name="refresh" size={22} color="#00dc50" />
          </TouchableOpacity>
        </View>
        {loadingLog && log.length === 0 ? (
          <ActivityIndicator color="#00dc50" style={{ marginTop: 12 }} />
        ) : log.length === 0 ? (
          <Text style={styles.hint}>No recovery actions recorded yet.</Text>
        ) : (
          log.map((entry) => (
            <AdminCard key={entry.id}>
              <View style={styles.logRow}>
                <Text style={styles.logAction}>{entry.action_type}</Text>
                <Text style={[styles.logResult, entry.result === 'failure' && styles.logResultFailure]}>
                  {entry.result}
                </Text>
              </View>
              <Text style={styles.logMeta}>user: {entry.target_user_id}</Text>
              {entry.amount != null && (
                <Text style={styles.logMeta}>amount: ${Number(entry.amount).toFixed(2)}</Text>
              )}
              <Text style={styles.logMeta}>reason: {entry.reason}</Text>
              <Text style={styles.logDate}>{new Date(entry.created_at).toLocaleString()}</Text>
            </AdminCard>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a3d2e' },
  content: { padding: 16 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fffef5',
    marginTop: 8,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
    marginBottom: 12,
    lineHeight: 17,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fffef5',
    marginBottom: 10,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#00912C',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fffef5', fontSize: 14, fontWeight: '700' },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  checkboxLabel: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  logHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  logAction: { color: '#00dc50', fontWeight: '700', fontSize: 13 },
  logResult: { color: '#00dc50', fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
  logResultFailure: { color: '#f44336' },
  logMeta: { color: 'rgba(255,254,245,0.7)', fontSize: 12, marginBottom: 2 },
  logDate: { color: 'rgba(255,254,245,0.5)', fontSize: 11, marginTop: 4, textAlign: 'right' },
});
