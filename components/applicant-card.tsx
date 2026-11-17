// components/applicant-card.tsx - Applicant card with explicit confirmation for accept/reject
import { MaterialIcons } from '@expo/vector-icons';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { markApplicantProfileViewed } from '../lib/analytics/sessionFlags';
import { trustSafetyStrings } from '../lib/strings/trust-safety';
import type { BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { formatApplicantDistance } from '../lib/utils/applicant-distance';
import { getAvatarInitials, getValidAvatarUrl } from '../lib/utils/avatar-utils';
import { deriveCoarseVerificationStatus } from '../lib/utils/normalize-profile';
import { getRelevantSkills } from '../lib/utils/skill-match';
import { formatHunterTrustSummary, formatPlainHelperTrust } from '../lib/utils/trust-summary';
import { isHighRiskTrustTier } from '../lib/utils/trust-tier';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import TextGuard from './ui/TextGuard';
import { VerificationBadge, type VerificationLevel } from './ui/verification-badge';
import { withAlpha } from '../lib/utils';

interface ApplicantCardProps {
  request: BountyRequestWithDetails;
  onAccept: (requestId: string | number) => Promise<unknown>;
  onReject: (requestId: string | number) => Promise<unknown>;
  /**
   * 'job_page' is the poster's own job page: the job is already on screen, so
   * the "Applying to" row is dropped, and the card uses the plain words the
   * rest of that page uses.
   */
  variant?: 'default' | 'job_page';
  /**
   * Show this card's own "Choose …?" confirmation before onAccept. Turn it off
   * only when the caller's next step is itself a confirmation (the pay sheet
   * for a pay-when-you-choose job), so the poster answers one question, not two.
   */
  confirmBeforeAccept?: boolean;
  onRequestMoreInfo?: (requestId: string | number) => void;
  /** True while the "Ask a question" conversation is being opened. */
  isAskingQuestion?: boolean;
  /** True when another applicant's conversation is opening and this action is locked. */
  isAskQuestionDisabled?: boolean;
  referrerOverride?: string;
}

// Memoized: rendered as a FlatList row, so it must not re-render on every
// parent (postings screen) state change while the list is scrolling.
export const ApplicantCard = memo(function ApplicantCard({
  request,
  onAccept,
  onReject,
  onRequestMoreInfo,
  isAskingQuestion = false,
  isAskQuestionDisabled = false,
  referrerOverride,
  variant = 'default',
  confirmBeforeAccept = true,
}: ApplicantCardProps) {
  const onJobPage = variant === 'job_page';
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [actionType, setActionType] = useState<'accept' | 'reject' | null>(null);
  const [isNavigatingToProfile, setIsNavigatingToProfile] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const globalSearchParams = useGlobalSearchParams();
  // Built with encodeURIComponent rather than the global URLSearchParams --
  // RN runtimes don't all polyfill it, and this only needs to produce a
  // query string, not parse one.
  const searchString = Object.keys(globalSearchParams || {}).length
    ? `?${Object.entries(globalSearchParams as Record<string, string | string[]>)
        .flatMap(([key, value]) =>
          (Array.isArray(value) ? value : [value]).map(
            (v) => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`
          )
        )
        .join('&')}`
    : '';
  const referrerValue = `${pathname || ''}${searchString}`;

  const isMountedRef = useRef(true);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const NAVIGATION_LOADING_TIMEOUT_MS = 400;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  const runAccept = async () => {
    setIsProcessing(true);
    setActionType('accept');
    try {
      await onAccept(request.id);
    } catch (error) {
      console.error('Error accepting request:', error);
    } finally {
      setIsProcessing(false);
      setActionType(null);
    }
  };

  const runReject = async () => {
    setIsProcessing(true);
    setActionType('reject');
    try {
      await onReject(request.id);
    } catch (error) {
      console.error('Error rejecting request:', error);
    } finally {
      setIsProcessing(false);
      setActionType(null);
    }
  };

  // Derived from the actual Stripe Identity state (stripe_identity_status,
  // with legacy id_verification_status as a fallback for pre-migration
  // profiles) via the same helper every other profile surface uses --
  // this used to read a `verificationStatus` field that bounty-request-service
  // never populated, so every applicant showed "unverified" regardless of
  // real status. See lib/utils/normalize-profile.ts.
  const identityStatus = useMemo(
    () =>
      deriveCoarseVerificationStatus(
        (request.profile as any)?.stripe_identity_status,
        (request.profile as any)?.id_verification_status
      ) as VerificationLevel,
    [request.profile]
  );
  // Row 1 shows an EARNED badge only -- an "Unverified"/"Pending" pill reads
  // as a claim we checked and found lacking, when really we just don't have
  // a signal either way. Silence is the honest default; only "verified" is
  // something Bounty actually confirmed.
  const isIdentityVerified = identityStatus === 'verified';

  // Row 2: "3 bounties done · ★4.9 (4)" / "3 bounties done" / "New to Bounty".
  // Suppresses the average below MIN_RATING_SAMPLE ratings -- see
  // lib/utils/trust-summary.ts.
  const trustSummary = useMemo(
    () =>
      formatHunterTrustSummary({
        hunterCompleted: request.profile?.hunterCompleted,
        averageRating: request.profile?.averageRating,
        ratingCount: request.profile?.ratingCount,
      }),
    [request.profile]
  );
  // Same facts and the same small-sample rule, in the job page's words.
  const plainTrust = useMemo(
    () =>
      formatPlainHelperTrust({
        hunterCompleted: request.profile?.hunterCompleted,
        averageRating: request.profile?.averageRating,
        ratingCount: request.profile?.ratingCount,
      }),
    [request.profile]
  );

  // Row 3: up to 3 of the hunter's self-reported skills that share a word
  // with this specific bounty. Omitted entirely when nothing matches --
  // this is a relevance filter, not a skills list.
  const relevantSkills = useMemo(
    () =>
      getRelevantSkills(request.profile?.skills, {
        title: request.bounty?.title,
        description: request.bounty?.description,
        category: request.bounty?.category,
      }),
    [request.profile, request.bounty]
  );

  // High-risk tiers (lib/utils/trust-tier.ts) get an explicit ID-status row
  // even when NOT verified -- the general "silence is the honest default"
  // rule above suppresses an unverified badge because most bounties never
  // asked. Once a poster is evaluating hunters for pet care, home entry,
  // licensed trades, or care of a vulnerable person, ID status IS one of the
  // signals they're weighing, whichever way it comes out.
  const isHighRiskBounty = isHighRiskTrustTier(request.bounty?.trust_tier);

  // "About 4 mi away" / "Under 1 mi away", stamped by the server when they
  // applied (SBA-02). Nothing when it isn't known (online job, no location).
  const distanceLabel = formatApplicantDistance(request.distance_mi);

  const applicantName = request.profile?.username || (onJobPage ? 'this person' : 'this hunter');
  const isForHonor = !!request.bounty?.is_for_honor;
  const amount = typeof request.bounty?.amount === 'number' ? request.bounty.amount : 0;
  const amountText = `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;

  const handleAccept = () => {
    if (!confirmBeforeAccept) {
      void runAccept();
      return;
    }
    // This dialog never says money is "held now": for a pay-when-you-choose
    // job nothing has been charged yet (the pay sheet that follows shows the
    // exact amount), and for a job paid up front it was charged when posted.
    const fundingMode = (request.bounty as { funding_mode?: string | null } | undefined)?.funding_mode;
    const moneyLine =
      isForHonor || amount <= 0
        ? 'No payment is involved in this job.'
        : fundingMode === 'at_accept'
          ? `Next you'll see exactly what you pay (${amountText}) before anything is charged. ${applicantName} is paid only after you approve the finished work.`
          : `You already paid ${amountText} when you posted this job. Bounty keeps holding it, and ${applicantName} is paid only after you approve the finished work.`;

    Alert.alert(
      `Choose ${applicantName}?`,
      `${applicantName} can start once this goes through, and the other offers will be closed. ${moneyLine}\n\n${trustSafetyStrings.posterHire}`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: `Choose ${applicantName}`, style: 'default', onPress: runAccept },
      ],
      { cancelable: true }
    );
  };

  const handleReject = () => {
    // Declining removes the offer; it never touches the job itself.
    Alert.alert(
      onJobPage ? 'Not this time?' : 'Decline this application?',
      onJobPage
        ? `${applicantName}'s offer will be removed. Your job stays open, and everyone else's offers stay as they are.`
        : `${applicantName}'s application will be removed. Your bounty stays open for other hunters.`,
      [
        { text: onJobPage ? 'Keep the offer' : 'Cancel', style: 'cancel' },
        { text: onJobPage ? 'Remove offer' : 'Decline', style: 'destructive', onPress: runReject },
      ],
      { cancelable: true }
    );
  };

  const handleRequestInfo = () => {
    if (onRequestMoreInfo) {
      onRequestMoreInfo(request.id);
    }
  };

  const handleProfilePress = useCallback(() => {
    const id = (request as any).hunter_id || (request as any).user_id;
    if (id) {
      setIsNavigatingToProfile(true);
      const finalRef = referrerOverride ?? referrerValue;
      const bountyId = (request.bounty as any)?.id ?? (request as any)?.bounty_id;
      if (bountyId != null) {
        // Backs application_accepted's profileViewedBeforeAccept -- see
        // lib/analytics/sessionFlags.ts.
        markApplicantProfileViewed(String(bountyId), String(id));
      }
      // Object-based push (rather than a manually built URL string) lets
      // expo-router handle encoding and avoids relying on the global
      // URLSearchParams API, which isn't guaranteed on every RN runtime.
      router.push({
        pathname: '/profile/[userId]',
        params: {
          userId: String(id),
          // On the job page, no referrer: the profile's back button then
          // simply goes back, to the offers the poster was comparing. With a
          // referrer it resets to the tab root and re-navigates, which landed
          // a senior persona on Home instead (16 Nov swarm).
          ...(onJobPage ? {} : { referrer: finalRef }),
          source: 'applicant_card',
          isApplicant: 'true',
          ...(bountyId != null ? { bountyId: String(bountyId) } : {}),
        },
      } as any);
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
      navigationTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setIsNavigatingToProfile(false);
        }
      }, NAVIGATION_LOADING_TIMEOUT_MS);
    }
  }, [request, router, referrerOverride, referrerValue, onJobPage]);

  const profileId = (request as any).hunter_id || (request as any).user_id;
  const validAvatarUrl = getValidAvatarUrl(request.profile?.avatar || request.profile?.avatar_url);

  return (
    <TextGuard>
      <View style={s.card}>
        {/* Header with avatar and applicant info */}
        <TouchableOpacity
          style={s.header}
          onPress={handleProfilePress}
          disabled={!profileId || isNavigatingToProfile}
          accessibilityRole="button"
          accessibilityLabel={
            onJobPage
              ? [
                  applicantName,
                  isIdentityVerified ? 'ID checked by Bounty' : null,
                  plainTrust.jobs,
                  plainTrust.rating,
                  distanceLabel,
                ]
                  .filter(Boolean)
                  .join('. ')
              : `View ${request.profile?.username || 'applicant'}'s profile`
          }
          accessibilityHint={onJobPage ? 'Opens their profile' : "Opens the applicant's profile page"}
        >
          <View style={s.avatarContainer}>
            {isNavigatingToProfile ? (
              <View style={[s.avatar, s.avatarLoading]}>
                <ActivityIndicator size="small" color={theme.textSecondary} />
              </View>
            ) : (
              <Avatar style={s.avatar}>
                <AvatarImage
                  src={validAvatarUrl}
                  alt={request.profile?.username || 'Applicant'}
                />
                <AvatarFallback style={s.avatarFallback}>
                  <Text style={s.avatarText}>
                    {getAvatarInitials(request.profile?.username)}
                  </Text>
                </AvatarFallback>
              </Avatar>
            )}
          </View>

          <View style={s.applicantInfo}>
            <View style={s.nameRow}>
              <Text style={s.applicantName}>
                {request.profile?.username || 'Unknown User'}
              </Text>
              {isIdentityVerified && (
                <VerificationBadge
                  status="verified"
                  size="small"
                  showLabel={true}
                  showExplanation={true}
                />
              )}
            </View>
            {onJobPage ? (
              <>
                <Text style={s.trustSummary} testID="applicant-jobs-done">{plainTrust.jobs}</Text>
                {plainTrust.rating ? (
                  <Text style={s.trustSummary} testID="applicant-rating">{plainTrust.rating}</Text>
                ) : null}
              </>
            ) : (
              <Text style={s.trustSummary}>{trustSummary}</Text>
            )}
            {distanceLabel && (
              <View style={s.distanceRow} testID="applicant-distance">
                <MaterialIcons name="place" size={13} color={theme.textSecondary} />
                <Text style={s.distanceText}>{distanceLabel}</Text>
              </View>
            )}
            {isHighRiskBounty && !isIdentityVerified && (
              <View style={s.idStatusRow}>
                <MaterialIcons name="gpp-maybe" size={13} color={theme.textSecondary} />
                <Text style={s.idStatusText}>Not ID-verified</Text>
              </View>
            )}
          </View>

          {profileId && !onJobPage ? (
            <View style={s.viewProfileHint}>
              <Text style={s.viewProfileText}>View profile</Text>
              <MaterialIcons name="chevron-right" size={18} color={theme.textSecondary} />
            </View>
          ) : null}
        </TouchableOpacity>

        {/* Relevant skills — only rendered when something actually matches
            this bounty; self-reported, so labeled as such rather than
            implying Bounty verified them. */}
        {relevantSkills.length > 0 && (
          <View style={s.skillsSection}>
            <Text style={s.skillsLabel}>Relevant skills (self-reported)</Text>
            <View style={s.skillsRow}>
              {relevantSkills.map((skill) => (
                <View key={skill} style={s.skillChip}>
                  <Text style={s.skillChipText}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {request.qualification && (
          <View style={s.skillsSection}>
            <Text style={s.skillsLabel}>Structured task fit · self-reported</Text>
            {request.qualification.matchedTerms.length > 0 && (
              <View style={s.skillsRow}>
                {request.qualification.matchedTerms.map(term => (
                  <View key={`${term.importance}:${term.label}`} style={s.skillChip}>
                    <Text style={s.skillChipText}>
                      {term.label} · {term.importance}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {request.qualification.missingRequiredTerms.length > 0 && (
              <Text style={s.qualificationNote}>
                Required terms not declared: {request.qualification.missingRequiredTerms.join(', ')}
              </Text>
            )}
            <Text style={s.qualificationNote}>Declarations are not independently verified credentials.</Text>
          </View>
        )}

        {/* Application pitch — the strongest pre-hire capability signal
            available, so it gets prominent placement rather than being
            buried under bounty details the poster already knows. */}
        {request.message ? (
          <View style={s.pitchSection}>
            <MaterialIcons name="format-quote" size={16} color={theme.isDark ? theme.primaryLight : theme.primary} />
            <Text style={s.pitchText}>{request.message}</Text>
          </View>
        ) : null}

        {onJobPage && profileId ? (
          <TouchableOpacity
            style={[s.secondaryAction, s.viewProfileButton]}
            onPress={handleProfilePress}
            disabled={isNavigatingToProfile}
            accessibilityRole="button"
            accessibilityLabel={`View ${applicantName}'s profile and reviews`}
            accessibilityHint="See their reviews and past jobs. You can come straight back here."
            testID="applicant-view-profile"
          >
            {isNavigatingToProfile ? (
              <ActivityIndicator size="small" color={theme.text} />
            ) : (
              <MaterialIcons name="person-search" size={20} color={theme.text} />
            )}
            <Text style={[s.secondaryActionText, { color: theme.text }]}>View profile and reviews</Text>
          </TouchableOpacity>
        ) : null}

        {/* Condensed bounty context. This card also renders in the poster's
            cross-bounty "Requests" list, so which bounty an application is
            for still needs to be legible -- just not as its own prominent
            section repeating what the poster is usually already looking at. */}
        {onJobPage ? (
          !isForHonor && amount > 0 ? (
            <View style={s.bountyContextRow}>
              <Text style={s.bountyContextText}>Your price</Text>
              <Text style={s.bountyContextAmount}>{amountText}</Text>
            </View>
          ) : null
        ) : (
          <View style={s.bountyContextRow}>
            <Text style={s.bountyContextText} numberOfLines={1}>
              Applying to: {request.bounty?.title || 'Untitled Bounty'}
            </Text>
            {isForHonor ? (
              <View style={s.honorBadgeSmall}>
                <MaterialIcons name="favorite" size={10} color="#fff" />
                <Text style={s.honorTextSmall}>Honor</Text>
              </View>
            ) : amount > 0 ? (
              <Text style={s.bountyContextAmount}>{amountText}</Text>
            ) : null}
          </View>
        )}

        {/* Actions. Choosing a hunter is the decision this screen exists for,
            so it is a full-width primary; declining is a quieter secondary
            beneath it rather than a same-sized button competing with it. */}
        <View style={s.actions}>
          <TouchableOpacity
            style={[s.primaryAction, (isProcessing || request.status !== 'pending') && s.actionDisabled]}
            onPress={handleAccept}
            disabled={isProcessing || request.status !== 'pending'}
            accessibilityRole="button"
            accessibilityLabel={onJobPage ? `Choose ${applicantName}` : `Choose ${applicantName} for this bounty`}
            accessibilityHint={
              onJobPage
                ? "Shows what you'll pay before anything happens"
                : 'Starts the bounty with this hunter and declines the others'
            }
            accessibilityState={{ busy: isProcessing && actionType === 'accept' }}
          >
            {isProcessing && actionType === 'accept' ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                {onJobPage ? <Text style={s.primaryActionText}>Choosing {applicantName}…</Text> : null}
              </>
            ) : (
              <>
                <MaterialIcons name="check-circle" size={20} color="#fff" />
                <Text style={s.primaryActionText}>
                  {onJobPage ? `Choose ${applicantName}` : 'Choose this hunter'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={s.secondaryRow}>
            {onRequestMoreInfo && (
              <TouchableOpacity
                style={[s.secondaryAction, (isProcessing || isAskQuestionDisabled || request.status !== 'pending') && s.actionDisabled]}
                onPress={handleRequestInfo}
                disabled={isProcessing || isAskQuestionDisabled || request.status !== 'pending'}
                accessibilityRole="button"
                accessibilityLabel={`Ask ${applicantName} a question`}
                accessibilityState={{ busy: isAskingQuestion, disabled: isProcessing || isAskQuestionDisabled || request.status !== 'pending' }}
              >
                {isAskingQuestion ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <MaterialIcons name="chat" size={16} color={theme.textSecondary} />
                )}
                <Text style={s.secondaryActionText}>Ask a question</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[s.secondaryAction, (isProcessing || request.status !== 'pending') && s.actionDisabled]}
              onPress={handleReject}
              disabled={isProcessing || request.status !== 'pending'}
              accessibilityRole="button"
              accessibilityLabel={onJobPage ? `Not this time: remove ${applicantName}'s offer` : `Decline ${applicantName}'s application`}
              accessibilityHint={
                onJobPage ? 'Removes this offer. Your job stays open.' : 'Removes this application; your bounty stays open'
              }
            >
              {isProcessing && actionType === 'reject' ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : (
                <>
                  <MaterialIcons name="close" size={18} color={onJobPage ? theme.textSecondary : theme.error} />
                  <Text style={[s.secondaryActionText, !onJobPage && { color: theme.error }]}>
                    {onJobPage ? 'Not this time' : 'Decline'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Status badge for non-pending requests */}
        {request.status !== 'pending' && (
          <View style={s.statusBadge}>
            <Text style={[
              s.statusText,
              request.status === 'accepted' ? s.statusAccepted : s.statusRejected
            ]}>
              {request.status === 'accepted' ? '✓ Accepted' : '✕ Rejected'}
            </Text>
          </View>
        )}
      </View>
    </TextGuard>
  );
});

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: t.isDark ? withAlpha(t.primary, 0.2) : t.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    avatarContainer: {
      position: 'relative',
    },
    avatar: {
      width: 56,
      height: 56,
      borderWidth: 2,
      borderColor: t.primary,
      borderRadius: 28,
    },
    avatarLoading: {
      backgroundColor: t.isDark ? t.primary : withAlpha(t.primary, 0.12),
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarFallback: {
      backgroundColor: t.isDark ? t.primary : withAlpha(t.primary, 0.12),
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      color: t.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    applicantInfo: {
      marginLeft: 12,
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    applicantName: {
      color: t.text,
      fontSize: 18,
      fontWeight: '700',
    },
    trustSummary: {
      color: t.textSecondary,
      fontSize: 15,
    },
    distanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    distanceText: {
      color: t.textSecondary,
      fontSize: 15,
    },
    idStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    idStatusText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    viewProfileHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginLeft: 'auto',
    },
    viewProfileText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    skillsSection: {
      marginBottom: 12,
    },
    skillsLabel: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    skillsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    skillChip: {
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    skillChipText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '500',
    },
    qualificationNote: {
      color: t.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 5,
    },
    pitchSection: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginBottom: 12,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderLeftColor: t.primary,
    },
    pitchText: {
      flex: 1,
      color: t.text,
      fontSize: 17,
      lineHeight: 25,
      fontStyle: 'normal',
    },
    bountyContextRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.isDark ? withAlpha(t.primary, 0.15) : t.border,
    },
    bountyContextText: {
      flex: 1,
      color: t.textSecondary,
      fontSize: 15,
    },
    bountyContextAmount: {
      color: t.isDark ? t.primaryLight : t.primary,
      fontWeight: '600',
      fontSize: 18,
    },
    // Unique color — kept as designed
    honorBadgeSmall: {
      backgroundColor: t.error,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    honorTextSmall: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 12,
    },
    actions: {
      gap: 10,
    },
    primaryAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: t.primary,
      paddingVertical: 14,
      borderRadius: 12,
      minHeight: 56,
    },
    primaryActionText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: '700',
    },
    secondaryRow: {
      flexDirection: 'row',
      gap: 8,
    },
    secondaryAction: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      minHeight: 48,
    },
    secondaryActionText: {
      color: t.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    actionDisabled: {
      opacity: 0.5,
    },
    viewProfileButton: {
      flex: 0,
      marginBottom: 12,
    },
    button: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: 8,
      gap: 6,
    },
    // Unique colors — kept as designed
    rejectButton: {
      backgroundColor: t.error,
    },
    infoButton: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.primary,
    },
    acceptButton: {
      backgroundColor: t.primary,
    },
    buttonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 14,
    },
    infoButtonText: {
      color: t.primaryLight,
    },
    statusBadge: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.isDark ? withAlpha(t.primary, 0.2) : t.border,
    },
    statusText: {
      textAlign: 'center',
      fontWeight: '600',
      fontSize: 14,
    },
    statusAccepted: {
      color: t.primaryLight,
    },
    statusRejected: {
      color: t.errorText,
    },
  });
}
