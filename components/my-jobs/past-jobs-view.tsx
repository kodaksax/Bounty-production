/**
 * Profile › Past jobs (Focus-first P.1), as presentation only: the route
 * (app/profile/past-jobs.tsx) supplies rows from usePastJobs and handles
 * navigation. What each row may say about money is decided in
 * lib/my-jobs/past-jobs.ts.
 *
 * A section only shows for a side you have past jobs on, so a poster-only or
 * hunter-only account isn't shown an empty half.
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatJobAmount } from '../../lib/my-jobs/format';
import type { PastJobRow, PastJobs, RatingFact } from '../../lib/my-jobs/past-jobs';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { PosterPalette } from '../../lib/themes/poster-palette';
import { FactsList, FlowNav, FlowTitle, NoteBox, SectionLabel, type FactRow } from '../poster/blocks';
import { PinnedFooter, WorkspaceLayout } from '../poster/layout';
import { PosterButton } from '../poster/poster-button';

export interface PastJobsViewProps extends PastJobs {
  rating: RatingFact;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onBack: () => void;
  onOpenRow: (row: PastJobRow) => void;
  onOpenWallet: () => void;
}

export function PastJobsView({ work, posted, earned, rating, loading, failed, onRetry, onBack, onOpenRow, onOpenWallet }: PastJobsViewProps) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);

  const hasAny = work.length > 0 || posted.length > 0;
  const firstLoad = loading && !hasAny;

  const facts: FactRow[] = [];
  if (work.length > 0) facts.push({ icon: 'account-balance-wallet', label: 'Earned on Bounty', value: formatJobAmount(earned) });
  if (hasAny) facts.push({ icon: 'star', label: rating.label, value: rating.value, muted: rating.muted });

  return (
    <WorkspaceLayout
      testID="past-jobs"
      refreshing={loading && hasAny}
      onRefresh={onRetry}
      footer={
        <PinnedFooter>
          <PosterButton
            kind="secondary"
            icon="account-balance-wallet"
            label="See earnings in Wallet"
            onPress={onOpenWallet}
            testID="past-jobs-wallet"
          />
        </PinnedFooter>
      }
    >
      <FlowNav label="Profile" onBack={onBack} />
      <FlowTitle title="Past jobs" />

      {failed ? (
        <View style={s.block}>
          <NoteBox
            tone="e"
            icon="wifi-off"
            title="We couldn't load your past jobs"
            text="Check your connection, then try again."
            testID="past-jobs-error"
          />
          <PosterButton kind="quiet" icon="refresh" label="Try again" onPress={onRetry} testID="past-jobs-retry" />
        </View>
      ) : null}

      {firstLoad ? (
        <View style={s.loading} accessible accessibilityLabel="Loading your past jobs">
          <ActivityIndicator color={p.gt} />
        </View>
      ) : null}

      {facts.length > 0 ? <FactsList rows={facts} testID="past-jobs-facts" /> : null}

      {!loading && !failed && !hasAny ? (
        <Text style={s.empty} testID="past-jobs-empty">
          Jobs you finish or cancel show up here, for jobs you post and work you do.
        </Text>
      ) : null}

      {work.length > 0 ? (
        <View style={s.section} testID="past-jobs-work">
          <SectionLabel>WORK YOU DID</SectionLabel>
          {work.map((row) => (
            <PastJobRowView key={row.key} row={row} onPress={() => onOpenRow(row)} palette={p} />
          ))}
        </View>
      ) : null}

      {posted.length > 0 ? (
        <View style={s.section} testID="past-jobs-posted">
          <SectionLabel>JOBS YOU POSTED</SectionLabel>
          {posted.map((row) => (
            <PastJobRowView key={row.key} row={row} onPress={() => onOpenRow(row)} palette={p} />
          ))}
        </View>
      ) : null}
    </WorkspaceLayout>
  );
}

/** One past job (handoff block `arow`): tap opens its receipt or workspace. */
function PastJobRowView({ row, onPress, palette: p }: { row: PastJobRow; onPress: () => void; palette: PosterPalette }) {
  const s = useMemo(() => makeStyles(p), [p]);
  const statusColor = row.state === 'cancel' ? p.ink2 : p.gt;
  const label = [row.title, row.meta, row.amount, row.status, row.quote].filter(Boolean).join('. ');
  return (
    <TouchableOpacity
      onPress={onPress}
      style={s.row}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={row.side === 'did' ? 'Opens the receipt for this job' : 'Opens this job'}
      testID={`past-job-${row.key}`}
    >
      <View style={s.rowTop}>
        <View style={s.tile} accessible={false} importantForAccessibility="no-hide-descendants">
          <MaterialIcons name={row.icon} size={24} color={p.photoInk} />
        </View>
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={2}>
            {row.title}
          </Text>
          {row.meta ? <Text style={s.rowMeta}>{row.meta}</Text> : null}
        </View>
        {row.amount ? <Text style={s.rowAmount}>{row.amount}</Text> : null}
      </View>
      <View style={s.status}>
        <MaterialIcons name={row.state === 'cancel' ? 'cancel' : 'task-alt'} size={20} color={statusColor} />
        <Text style={[s.statusText, { color: statusColor }]}>{row.status}</Text>
      </View>
      {row.quote ? <Text style={s.quote}>{row.quote}</Text> : null}
    </TouchableOpacity>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    block: { gap: 10 },
    loading: { paddingVertical: 32, alignItems: 'center' },
    empty: { color: p.ink2, fontSize: 17, lineHeight: 25 },
    section: { gap: 10 },
    row: {
      backgroundColor: p.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: p.line,
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap: 10,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    tile: { width: 48, height: 48, borderRadius: 14, backgroundColor: p.photo, alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: { color: p.ink, fontSize: 17, fontWeight: '700', lineHeight: 22 },
    rowMeta: { color: p.ink2, fontSize: 15 },
    rowAmount: { color: p.ink, fontSize: 18, fontWeight: '800' },
    status: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    statusText: { flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 22 },
    quote: { color: p.ink2, fontSize: 15, lineHeight: 22 },
  });
}
