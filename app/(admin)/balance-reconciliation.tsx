// app/(admin)/balance-reconciliation.tsx - Stripe <-> wallet balance sync dashboard
//
// Calls the admin-withdrawals Edge Function's balance-reconciliation actions
// (run_stripe_balance_sync, list_balance_findings, acknowledge_finding). The
// same sweep also runs automatically every hour via pg_cron — this screen is
// for on-demand runs and for reviewing/acknowledging what the hourly sweep
// and the real-time balance.available webhook have already found. Also
// surfaces failed webhook deliveries (stripe_events where status='failed')
// as a combined "what needs attention" view.

import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { supabase } from '../../lib/supabase';

interface ReconciliationFinding {
  id: string;
  run_at: string;
  finding_type: string;
  severity: 'info' | 'warning' | 'critical';
  user_id: string | null;
  details: Record<string, unknown>;
  acknowledged_at: string | null;
  auto_repaired: boolean;
  resolution: string | null;
}

interface BalanceSnapshot {
  id: string;
  captured_at: string;
  scope: 'platform' | 'connect_account';
  user_id: string | null;
  stripe_available_cents: number;
  stripe_pending_cents: number;
  ledger_reference_cents: number;
  drift_cents: number;
}

interface FailedWebhookEvent {
  id: string;
  stripe_event_id: string;
  event_type: string;
  status: string;
  last_error: string | null;
  retry_count: number;
  last_retry_at: string | null;
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

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#f44336',
  warning: '#f5a623',
  info: 'rgba(255,254,245,0.6)',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function BalanceReconciliationScreen() {
  const [findings, setFindings] = useState<ReconciliationFinding[]>([]);
  const [snapshots, setSnapshots] = useState<BalanceSnapshot[]>([]);
  const [failedEvents, setFailedEvents] = useState<FailedWebhookEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callAdminWithdrawals({ action: 'list_balance_findings', limit: 100 });
      setFindings((data?.findings ?? []) as ReconciliationFinding[]);
      setSnapshots((data?.snapshots ?? []) as BalanceSnapshot[]);
      setFailedEvents((data?.failedWebhookEvents ?? []) as FailedWebhookEvent[]);
    } catch (err) {
      Alert.alert('Failed to load', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runSyncNow = async () => {
    setRunning(true);
    try {
      const data = await callAdminWithdrawals({ action: 'run_stripe_balance_sync' });
      Alert.alert(
        'Sync complete',
        `Checked ${data.accountsChecked} connected account(s), applied ${data.repairsApplied} auto-repair(s), ${data.errorCount} error(s).`
      );
      load();
    } catch (err) {
      Alert.alert('Sync failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  };

  const acknowledge = (finding: ReconciliationFinding) => {
    Alert.alert(
      'Acknowledge this finding?',
      'This records that a human reviewed it. It does not change any balance.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Acknowledge',
          onPress: async () => {
            setAcknowledging(finding.id);
            try {
              await callAdminWithdrawals({ action: 'acknowledge_finding', findingId: finding.id });
              load();
            } catch (err) {
              Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setAcknowledging(null);
            }
          },
        },
      ]
    );
  };

  const unacknowledged = findings.filter(f => !f.acknowledged_at);
  const acknowledged = findings.filter(f => f.acknowledged_at);
  const latestPlatformSnapshot = snapshots.find(s => s.scope === 'platform');

  return (
    <View style={styles.container}>
      <AdminHeader title="Balance Reconciliation" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#00dc50" />}
      >
        <Text style={styles.sectionTitle}>Stripe ↔ Wallet Sync</Text>
        <AdminCard>
          <Text style={styles.hint}>
            Compares Stripe&apos;s actual balance (platform account + every connected account)
            against the wallet ledger. Runs automatically every hour via pg_cron, and in real time
            on Stripe&apos;s balance.available webhook. Never edits a balance directly from a bare
            number mismatch — only replays a specific missed webhook&apos;s own effect when
            Stripe&apos;s Transfer/Payout object shows an unambiguous terminal state a stuck row
            never recorded. Everything else is flagged below for review.
          </Text>
          {latestPlatformSnapshot && (
            <View style={styles.platformRow}>
              <Text style={styles.platformLabel}>Platform balance (Stripe)</Text>
              <Text style={styles.platformValue}>
                {formatCents(latestPlatformSnapshot.stripe_available_cents + latestPlatformSnapshot.stripe_pending_cents)}
              </Text>
              <Text style={styles.platformLabel}>Ledger total</Text>
              <Text style={styles.platformValue}>{formatCents(latestPlatformSnapshot.ledger_reference_cents)}</Text>
              <Text style={styles.platformLabel}>Drift</Text>
              <Text
                style={[
                  styles.platformValue,
                  { color: Math.abs(latestPlatformSnapshot.drift_cents) > 100 ? '#f44336' : '#00dc50' },
                ]}
              >
                {formatCents(latestPlatformSnapshot.drift_cents)}
              </Text>
              <Text style={styles.logDate}>
                as of {new Date(latestPlatformSnapshot.captured_at).toLocaleString()}
              </Text>
            </View>
          )}
          <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={runSyncNow} disabled={running}>
            {running ? <ActivityIndicator color="#fffef5" /> : <Text style={styles.buttonText}>Run Sync Now</Text>}
          </TouchableOpacity>
        </AdminCard>

        <View style={styles.logHeaderRow}>
          <Text style={styles.sectionTitle}>Unacknowledged Findings ({unacknowledged.length})</Text>
          <TouchableOpacity onPress={load}>
            <MaterialIcons name="refresh" size={22} color="#00dc50" />
          </TouchableOpacity>
        </View>
        {loading && findings.length === 0 ? (
          <ActivityIndicator color="#00dc50" style={{ marginTop: 12 }} />
        ) : unacknowledged.length === 0 ? (
          <Text style={styles.hint}>Nothing outstanding.</Text>
        ) : (
          unacknowledged.map(finding => (
            <AdminCard key={finding.id}>
              <View style={styles.logRow}>
                <Text style={styles.logAction}>{finding.finding_type}</Text>
                <Text style={[styles.severityBadge, { color: SEVERITY_COLOR[finding.severity] }]}>
                  {finding.severity.toUpperCase()}
                </Text>
              </View>
              {finding.user_id && <Text style={styles.logMeta}>user: {finding.user_id}</Text>}
              {finding.auto_repaired && (
                <Text style={[styles.logMeta, { color: '#00dc50' }]}>✓ auto-repaired: {finding.resolution}</Text>
              )}
              <Text style={styles.logMeta} numberOfLines={4}>
                {JSON.stringify(finding.details)}
              </Text>
              <Text style={styles.logDate}>{new Date(finding.run_at).toLocaleString()}</Text>
              <TouchableOpacity
                style={[styles.ackButton, acknowledging === finding.id && styles.buttonDisabled]}
                onPress={() => acknowledge(finding)}
                disabled={acknowledging === finding.id}
              >
                {acknowledging === finding.id ? (
                  <ActivityIndicator color="#fffef5" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Acknowledge</Text>
                )}
              </TouchableOpacity>
            </AdminCard>
          ))
        )}

        <Text style={styles.sectionTitle}>Failed Webhook Deliveries ({failedEvents.length})</Text>
        {failedEvents.length === 0 ? (
          <Text style={styles.hint}>None recorded.</Text>
        ) : (
          failedEvents.map(evt => (
            <AdminCard key={evt.id}>
              <View style={styles.logRow}>
                <Text style={styles.logAction}>{evt.event_type}</Text>
                <Text style={styles.logMeta}>retries: {evt.retry_count}</Text>
              </View>
              <Text style={styles.logMeta}>id: {evt.stripe_event_id}</Text>
              {evt.last_error && (
                <Text style={styles.logMeta} numberOfLines={3}>
                  error: {evt.last_error}
                </Text>
              )}
              <Text style={styles.logDate}>
                last retry: {evt.last_retry_at ? new Date(evt.last_retry_at).toLocaleString() : 'n/a'}
              </Text>
            </AdminCard>
          ))
        )}

        <Text style={styles.sectionTitle}>Acknowledged ({acknowledged.length})</Text>
        {acknowledged.length === 0 ? (
          <Text style={styles.hint}>None yet.</Text>
        ) : (
          acknowledged.slice(0, 20).map(finding => (
            <AdminCard key={finding.id}>
              <View style={styles.logRow}>
                <Text style={styles.logAction}>{finding.finding_type}</Text>
                <Text style={styles.logMeta}>{finding.severity}</Text>
              </View>
              <Text style={styles.logDate}>
                acknowledged {finding.acknowledged_at ? new Date(finding.acknowledged_at).toLocaleString() : ''}
              </Text>
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
  button: {
    backgroundColor: '#00912C',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fffef5', fontSize: 14, fontWeight: '700' },
  ackButton: {
    backgroundColor: '#2d5240',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.4)',
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
  severityBadge: { fontWeight: '700', fontSize: 12 },
  logMeta: { color: 'rgba(255,254,245,0.7)', fontSize: 12, marginBottom: 2 },
  logDate: { color: 'rgba(255,254,245,0.5)', fontSize: 11, marginTop: 4 },
  platformRow: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  platformLabel: { color: 'rgba(255,254,245,0.6)', fontSize: 11, marginTop: 4 },
  platformValue: { color: '#fffef5', fontSize: 16, fontWeight: '700' },
});
