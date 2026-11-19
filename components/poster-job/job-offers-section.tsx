/**
 * "People who offered": every pending offer for THIS job, one under another,
 * so a poster can compare three people without remembering three chats.
 *
 * Each card is the existing ApplicantCard (photo, name, ID badge only when
 * Stripe Identity verified them, jobs done, sample-gated rating, distance,
 * their message, skills they listed), in its job-page variant: "View profile
 * and reviews", "Choose Ada", "Ask a question", "Not this time".
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BountyRequestWithDetails } from '../../lib/services/bounty-request-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { ApplicantCard } from '../applicant-card';
import type { OffersLoadState } from '../../hooks/usePosterJobOffers';

interface Props {
  offers: BountyRequestWithDetails[];
  loadState: OffersLoadState;
  onChoose: (requestId: string | number) => Promise<unknown>;
  onPass: (requestId: string | number) => Promise<unknown>;
  onAsk: (requestId: string | number) => void;
  onRetry: () => void;
  askingRequestId: string | null;
  isAskBusy: boolean;
}

export function JobOffersSection({
  offers,
  loadState,
  onChoose,
  onPass,
  onAsk,
  onRetry,
  askingRequestId,
  isAskBusy,
}: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const n = offers.length;

  return (
    <View style={s.section} testID="poster-offers">
      <Text style={s.title} accessibilityRole="header">
        {loadState === 'ready' && n > 1 ? 'Compare the people who offered' : 'Who offered'}
      </Text>

      {loadState === 'loading' ? (
        <View style={s.center} accessibilityLabel="Loading the offers">
          <ActivityIndicator color={theme.primary} />
          <Text style={s.muted}>Loading the offers…</Text>
        </View>
      ) : loadState === 'failed' ? (
        <View style={s.box}>
          <Text style={s.body}>{"We couldn't load the offers just now. Nothing has changed."}</Text>
          <TouchableOpacity
            style={s.retry}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try loading the offers again"
            testID="poster-offers-retry"
          >
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : n === 0 ? (
        <View style={s.box} testID="poster-offers-empty">
          <Text style={s.body}>
            {"No offers yet. When someone offers to help, they'll appear here with what we know about them, and we'll send you a notification."}
          </Text>
        </View>
      ) : (
        <>
          <Text style={s.body}>
            {n === 1
              ? 'They offered to do the job for your price. Their profile shows their reviews and past jobs.'
              : 'Each of them offered to do the job for your price. Their profiles show their reviews and past jobs.'}
          </Text>
          {offers.map(r => (
            <ApplicantCard
              key={String(r.id)}
              request={r}
              variant="job_page"
              confirmBeforeAccept
              onAccept={onChoose}
              onReject={onPass}
              onRequestMoreInfo={onAsk}
              isAskingQuestion={askingRequestId === String(r.id)}
              isAskQuestionDisabled={isAskBusy && askingRequestId !== String(r.id)}
            />
          ))}
        </>
      )}
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    section: { marginBottom: 8, gap: 12 },
    title: { color: t.text, fontSize: 22, fontWeight: '800' },
    body: { color: t.text, fontSize: 17, lineHeight: 25 },
    muted: { color: t.textSecondary, fontSize: 16 },
    center: { alignItems: 'center', gap: 10, paddingVertical: 24 },
    box: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.borderSubtle,
      padding: 16,
      gap: 12,
    },
    retry: {
      minHeight: 48,
      borderRadius: 14,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: { color: t.onPrimary, fontSize: 18, fontWeight: '700' },
  });
}
