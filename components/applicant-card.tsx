// components/applicant-card.tsx - Applicant card with explicit confirmation for accept/reject
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { getAvatarInitials, getValidAvatarUrl } from '../lib/utils/avatar-utils';
import { deriveCoarseVerificationStatus } from '../lib/utils/normalize-profile';
import { getRelevantSkills } from '../lib/utils/skill-match';
import { formatHunterTrustSummary } from '../lib/utils/trust-summary';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import TextGuard from './ui/TextGuard';
import { VerificationBadge, type VerificationLevel } from './ui/verification-badge';

interface ApplicantCardProps {
  request: BountyRequestWithDetails;
  onAccept: (requestId: string | number) => Promise<void>;
  onReject: (requestId: string | number) => Promise<void>;
  onRequestMoreInfo?: (requestId: string | number) => void;
  /** True while the "Ask a question" conversation is being opened. */
  isAskingQuestion?: boolean;
  /** True when another applicant's conversation is opening and this action is locked. */
  isAskQuestionDisabled?: boolean;
  referrerOverride?: string;
}

export function ApplicantCard({
  request,
  onAccept,
  onReject,
  onRequestMoreInfo,
  isAskingQuestion = false,
  isAskQuestionDisabled = false,
  referrerOverride,
}: ApplicantCardProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [actionType, setActionType] = useState<'accept' | 'reject' | null>(null);
  const [isNavigatingToProfile, setIsNavigatingToProfile] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const globalSearchParams = useGlobalSearchParams();
  const searchString = Object.keys(globalSearchParams || {}).length
    ? `?${new URLSearchParams(globalSearchParams as any).toString()}`
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

  const applicantName = request.profile?.username || 'this hunter';
  const isForHonor = !!request.bounty?.is_for_honor;
  const amount = typeof request.bounty?.amount === 'number' ? request.bounty.amount : 0;

  const handleAccept = () => {
    // Accepting is the moment money moves under pay-at-accept, so the
    // confirmation says so plainly instead of the old generic "are you sure":
    // a poster should never be surprised by a charge they just authorised.
    const moneyLine =
      isForHonor || amount <= 0
        ? 'This bounty is for honor, so no payment is taken.'
        : `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)} is held in escrow now and released to them only when you approve the finished work.`;

    Alert.alert(
      `Choose ${applicantName}?`,
      `They start work right away and the other applicants are declined. ${moneyLine}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose hunter', style: 'default', onPress: runAccept },
      ],
      { cancelable: true }
    );
  };

  const handleReject = () => {
    Alert.alert(
      'Decline this application?',
      `${applicantName} is told they weren't selected. Your bounty stays open for other hunters.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: runReject },
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
      router.push(`/profile/${id}?referrer=${encodeURIComponent(finalRef)}`);
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
      navigationTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setIsNavigatingToProfile(false);
        }
      }, NAVIGATION_LOADING_TIMEOUT_MS);
    }
  }, [request, router]);

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
          accessibilityLabel={`View ${request.profile?.username || 'applicant'}'s profile`}
          accessibilityHint="Opens the applicant's profile page"
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
            <Text style={s.trustSummary}>{trustSummary}</Text>
          </View>

          {profileId ? (
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

        {/* Application pitch — the strongest pre-hire capability signal
            available, so it gets prominent placement rather than being
            buried under bounty details the poster already knows. */}
        {request.message ? (
          <View style={s.pitchSection}>
            <MaterialIcons name="format-quote" size={16} color={theme.isDark ? '#6ee7b7' : theme.primary} />
            <Text style={s.pitchText}>{request.message}</Text>
          </View>
        ) : null}

        {/* Condensed bounty context. This card also renders in the poster's
            cross-bounty "Requests" list, so which bounty an application is
            for still needs to be legible -- just not as its own prominent
            section repeating what the poster is usually already looking at. */}
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
            <Text style={s.bountyContextAmount}>
              ${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}
            </Text>
          ) : null}
        </View>

        {/* Actions. Choosing a hunter is the decision this screen exists for,
            so it is a full-width primary; declining is a quieter secondary
            beneath it rather than a same-sized button competing with it. */}
        <View style={s.actions}>
          <TouchableOpacity
            style={[s.primaryAction, (isProcessing || request.status !== 'pending') && s.actionDisabled]}
            onPress={handleAccept}
            disabled={isProcessing || request.status !== 'pending'}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${applicantName} for this bounty`}
            accessibilityHint="Starts the bounty with this hunter and declines the others"
          >
            {isProcessing && actionType === 'accept' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={s.primaryActionText}>Choose this hunter</Text>
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
              accessibilityLabel={`Decline ${applicantName}'s application`}
              accessibilityHint="Removes this application; your bounty stays open"
            >
              {isProcessing && actionType === 'reject' ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : (
                <>
                  <MaterialIcons name="close" size={16} color={theme.error} />
                  <Text style={[s.secondaryActionText, { color: theme.error }]}>Decline</Text>
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
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
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
      width: 48,
      height: 48,
      borderWidth: 2,
      borderColor: t.isDark ? '#6ee7b7' : t.primary,
      borderRadius: 24,
    },
    avatarLoading: {
      backgroundColor: t.isDark ? '#064e3b' : 'rgba(5,150,105,0.12)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarFallback: {
      backgroundColor: t.isDark ? '#064e3b' : 'rgba(5,150,105,0.12)',
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
      fontSize: 16,
      fontWeight: '600',
    },
    trustSummary: {
      color: t.textSecondary,
      fontSize: 13,
    },
    viewProfileHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginLeft: 'auto',
    },
    viewProfileText: {
      color: t.textSecondary,
      fontSize: 11,
      fontWeight: '500',
    },
    skillsSection: {
      marginBottom: 12,
    },
    skillsLabel: {
      color: t.textSecondary,
      fontSize: 11,
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
      fontSize: 12,
      fontWeight: '500',
    },
    pitchSection: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginBottom: 12,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderLeftColor: t.isDark ? '#6ee7b7' : t.primary,
    },
    pitchText: {
      flex: 1,
      color: t.text,
      fontSize: 14,
      lineHeight: 20,
      fontStyle: 'italic',
    },
    bountyContextRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.isDark ? 'rgba(110,231,183,0.15)' : t.border,
    },
    bountyContextText: {
      flex: 1,
      color: t.textSecondary,
      fontSize: 12,
    },
    bountyContextAmount: {
      color: t.isDark ? '#6ee7b7' : t.primary,
      fontWeight: '600',
      fontSize: 13,
    },
    // Unique color — kept as designed
    honorBadgeSmall: {
      backgroundColor: '#ef4444',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
    },
    honorTextSmall: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 10,
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
      minHeight: 48,
    },
    primaryActionText: {
      color: '#ffffff',
      fontSize: 15,
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
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      minHeight: 44,
    },
    secondaryActionText: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    actionDisabled: {
      opacity: 0.5,
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
      backgroundColor: '#dc2626',
    },
    infoButton: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.primary,
    },
    acceptButton: {
      backgroundColor: '#059669',
    },
    buttonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 14,
    },
    infoButtonText: {
      color: t.primary,
    },
    statusBadge: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
    },
    statusText: {
      textAlign: 'center',
      fontWeight: '600',
      fontSize: 14,
    },
    statusAccepted: {
      color: '#059669',
    },
    statusRejected: {
      color: '#dc2626',
    },
  });
}
