// Open ops alerts with Acknowledge / Resolve. See lib/admin/opsAlertsClient.ts
// for what each action means server-side.
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../../hooks/use-app-theme';
import {
  acknowledgeOpsAlert,
  fetchOpenOpsAlerts,
  resolveOpsAlert,
  type OpsAlert,
} from '../../lib/admin/opsAlertsClient';
import { AdminBadge, AdminButton, AdminErrorBanner, AdminPanel, AdminSection, formatDateTime } from './AdminUI';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `reloadKey` changes when the parent screen is pulled to refresh. */
export function OpsAlertsSection({ reloadKey }: { reloadKey: number }) {
  const { theme } = useAppTheme();
  const [alerts, setAlerts] = useState<OpsAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await fetchOpenOpsAlerts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <AdminSection title="Ops alerts">
      {error ? <AdminErrorBanner message={error} onRetry={load} /> : null}
      {alerts && alerts.length === 0 ? (
        <AdminPanel>
          <View style={styles.inline}>
            <MaterialIcons name="check-circle" size={20} color={theme.success} />
            <Text style={{ color: theme.textSecondary, fontSize: 14, flex: 1 }}>No open ops alerts.</Text>
          </View>
        </AdminPanel>
      ) : null}
      {(alerts ?? []).map((alert) => (
        <OpsAlertCard key={alert.id} alert={alert} onChanged={load} />
      ))}
    </AdminSection>
  );
}

function OpsAlertCard({ alert, onChanged }: { alert: OpsAlert; onChanged: () => void }) {
  const { theme } = useAppTheme();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'ack' | 'resolve' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acknowledgedRecently =
    alert.acknowledgedAt != null && Date.now() - new Date(alert.acknowledgedAt).getTime() < DAY_MS;
  const color = alert.clearedAt ? theme.textSecondary : alert.severity === 'critical' ? theme.error : theme.warning;

  const run = async (kind: 'ack' | 'resolve', action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPanel style={{ gap: theme.spacing.sm }}>
      <View style={styles.inline}>
        <MaterialIcons name={alert.clearedAt ? 'history' : 'report-problem'} size={20} color={color} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text, flex: 1 }}>{alert.alertKey}</Text>
        {alert.causeKind ? <AdminBadge label={alert.causeKind} tone="info" /> : null}
        <AdminBadge
          label={alert.clearedAt ? 'cleared' : 'failing'}
          tone={alert.clearedAt ? 'neutral' : alert.severity === 'critical' ? 'error' : 'warning'}
        />
      </View>
      <Text style={{ fontSize: 13, color: theme.text, lineHeight: 18 }} numberOfLines={4}>
        {alert.summary}
      </Text>
      <Text style={{ fontSize: 11, color: theme.textSecondary }}>
        Open since {formatDateTime(alert.openedAt)}
        {alert.clearedAt ? ` · cleared ${formatDateTime(alert.clearedAt)}` : ` · last seen ${formatDateTime(alert.lastSeenAt)}`}
        {alert.occurrences > 1 ? ` · came back ${alert.occurrences - 1}×` : ''}
        {acknowledgedRecently ? ' · acknowledged' : ''}
      </Text>

      {error ? <Text style={{ fontSize: 12, color: theme.error }}>{error}</Text> : null}

      {resolving ? (
        <View style={{ gap: theme.spacing.sm }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What fixed it?"
            placeholderTextColor={theme.textDisabled}
            multiline
            accessibilityLabel="Resolution note"
            style={{
              minHeight: 64,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              color: theme.text,
              fontSize: 14,
              textAlignVertical: 'top',
            }}
          />
          <Text style={{ fontSize: 11, color: theme.textSecondary }}>
            If it is still failing, a new alert opens within 5 minutes.
          </Text>
          <View style={styles.buttons}>
            <AdminButton label="Cancel" variant="secondary" onPress={() => setResolving(false)} style={styles.button} />
            <AdminButton
              label="Resolve"
              disabled={note.trim().length === 0}
              loading={busy === 'resolve'}
              onPress={() => run('resolve', () => resolveOpsAlert(alert.id, note.trim()))}
              style={styles.button}
            />
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          {acknowledgedRecently ? null : (
            <AdminButton
              label="Acknowledge"
              variant="secondary"
              loading={busy === 'ack'}
              onPress={() => run('ack', () => acknowledgeOpsAlert(alert.id))}
              accessibilityLabel={`Acknowledge ${alert.alertKey}; silences the reminder for 24 hours`}
              style={styles.button}
            />
          )}
          <AdminButton label="Resolve…" onPress={() => setResolving(true)} style={styles.button} />
        </View>
      )}
    </AdminPanel>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1 },
});
