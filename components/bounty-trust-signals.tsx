import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  type BountyFundingState,
  getBountyFundingState,
} from '../lib/services/bounty-funding-service';
import {
  type ProfileActivityStats,
  profileStatsService,
} from '../lib/services/profile-stats-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { deriveCoarseVerificationStatus } from '../lib/utils/normalize-profile';
import { formatAccountAge, formatPosterTrustSummary } from '../lib/utils/trust-summary';
import { VerificationBadge } from './ui/verification-badge';

/** Hunter-facing copy per funding state. null = render nothing. */
export const FUNDING_COPY: Record<BountyFundingState, { icon: 'lock' | 'schedule' | 'money-off'; title: string; body: string } | null> = {
  held: {
    icon: 'lock',
    title: 'Payment held',
    body: "Bounty is holding this reward. It's released to the hunter when the poster approves the work.",
  },
  held_on_selection: {
    icon: 'schedule',
    title: 'Payment not held yet',
    body: 'Bounty takes the payment from the poster when they choose a hunter, before any work starts.',
  },
  not_held: {
    icon: 'money-off',
    title: 'No payment held',
    body: "Bounty isn't holding payment for this bounty.",
  },
  not_applicable: null,
};

interface PosterIdentity {
  created_at?: string | null;
  stripe_identity_status?: string | null;
  id_verification_status?: string | null;
}

interface BountyTrustSignalsProps {
  bountyId: string | number;
  posterId?: string | null;
  /** Already-loaded public profile of the poster (account age + ID status). */
  poster?: PosterIdentity | null;
}

/**
 * What a hunter can check about a bounty before applying: whether the money
 * is actually held, and who the poster is in terms of evidence the server
 * holds (account age, earned ID verification, completed bounties, rating).
 *
 * Every line is read from the backend and omitted when the backend didn't
 * answer -- nothing here has a reassuring default. A brand-new poster with no
 * history reads as exactly that ("Joined today · No completed bounties
 * yet"). Unverified ID is silence, not a pill, same as the applicant card.
 * (trust-spine audit T10/T14, docs/trust-spine-audit-2026-09-30.md)
 */
export function BountyTrustSignals({ bountyId, posterId, poster }: BountyTrustSignalsProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [fundingState, setFundingState] = useState<BountyFundingState | null>(null);
  const [stats, setStats] = useState<ProfileActivityStats | null>(null);

  useEffect(() => {
    let active = true;
    setFundingState(null);
    getBountyFundingState(bountyId).then((state) => {
      if (active) setFundingState(state);
    });
    return () => {
      active = false;
    };
  }, [bountyId]);

  useEffect(() => {
    let active = true;
    setStats(null);
    if (!posterId) return;
    profileStatsService.getActivityStatsOrNull(String(posterId)).then((result) => {
      if (active) setStats(result);
    });
    return () => {
      active = false;
    };
  }, [posterId]);

  const funding = fundingState ? FUNDING_COPY[fundingState] : null;
  const accountAge = formatAccountAge(poster?.created_at);
  const idVerified =
    deriveCoarseVerificationStatus(
      poster?.stripe_identity_status ?? undefined,
      poster?.id_verification_status ?? undefined
    ) === 'verified';
  const history = stats
    ? formatPosterTrustSummary({
        bountiesCompleted: stats.bountiesCompleted,
        averageRating: stats.ratingAvg,
        ratingCount: stats.ratingCount,
      })
    : '';
  const posterLine = [accountAge, history].filter(Boolean).join(' · ');

  if (!funding && !posterLine && !idVerified) return null;

  return (
    <View style={s.container}>
      {funding && (
        <View
          style={s.row}
          accessible
          accessibilityLabel={`${funding.title}. ${funding.body}`}
          testID="bounty-funding-state"
        >
          <MaterialIcons name={funding.icon} size={16} color={fundingState === 'held' ? theme.primary : theme.textSecondary} />
          <View style={s.rowText}>
            <Text style={s.title}>{funding.title}</Text>
            <Text style={s.body}>{funding.body}</Text>
          </View>
        </View>
      )}
      {(posterLine || idVerified) && (
        <View style={s.row} testID="bounty-poster-trust">
          <MaterialIcons name="person-outline" size={16} color={theme.textSecondary} />
          <View style={s.rowText}>
            <Text style={s.title}>About the poster</Text>
            {!!posterLine && <Text style={s.body}>{posterLine}</Text>}
            {idVerified && (
              <View style={s.badgeRow}>
                <VerificationBadge status="verified" size="small" showLabel showExplanation />
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      gap: 12,
      marginBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
    },
    body: {
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    badgeRow: {
      flexDirection: 'row',
      marginTop: 4,
    },
  });
}
