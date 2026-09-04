// components/applicant-card.tsx - Applicant card with explicit confirmation for accept/reject
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { getAvatarInitials, getValidAvatarUrl } from '../lib/utils/avatar-utils';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { ReputationScoreCompact } from './ui/reputation-score';
import TextGuard from './ui/TextGuard';
import { VerificationBadge, type VerificationLevel } from './ui/verification-badge';

interface ApplicantCardProps {
  request: BountyRequestWithDetails;
  onAccept: (requestId: string | number) => Promise<void>;
  onReject: (requestId: string | number) => Promise<void>;
  onRequestMoreInfo?: (requestId: string | number) => void;
  referrerOverride?: string;
}

export function ApplicantCard({
  request,
  onAccept,
  onReject,
  onRequestMoreInfo,
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
              <VerificationBadge
                status={
                  typeof (request.profile as any)?.verificationStatus === 'string'
                    ? ((request.profile as any).verificationStatus as VerificationLevel)
                    : 'unverified'
                }
                size="small"
                showLabel={false}
                showExplanation={true}
              />
            </View>
            <View style={s.ratingContainer}>
              <ReputationScoreCompact
                averageRating={request.profile?.averageRating || 0}
                ratingCount={request.profile?.ratingCount || 0}
              />
              {request.profile?.ratingCount ? (
                <Text style={s.ratingText}>
                  ({request.profile.ratingCount} review{request.profile.ratingCount !== 1 ? 's' : ''})
                </Text>
              ) : null}
            </View>
          </View>

          {profileId ? (
            <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} style={{ marginLeft: 'auto' }} />
          ) : null}
        </TouchableOpacity>

        {/* Bounty details */}
        <View style={s.bountySection}>
          <Text style={s.sectionLabel}>Applied for:</Text>
          <Text style={s.bountyTitle}>{request.bounty?.title || 'Untitled Bounty'}</Text>
          {request.bounty?.amount > 0 && !request.bounty?.is_for_honor && (
            <View style={s.amountBadge}>
              <Text style={s.amountText}>${request.bounty.amount}</Text>
            </View>
          )}
          {request.bounty?.is_for_honor && (
            <View style={s.honorBadge}>
              <MaterialIcons name="favorite" size={14} color="#fff" />
              <Text style={s.honorText}>For Honor</Text>
            </View>
          )}
        </View>

        {/* Hunter's application message */}
        {request.message ? (
          <View style={s.messageSection}>
            <Text style={s.messageSectionLabel}>Message from applicant</Text>
            <Text style={s.messageText}>{request.message}</Text>
          </View>
        ) : null}

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
                style={[s.secondaryAction, (isProcessing || request.status !== 'pending') && s.actionDisabled]}
                onPress={handleRequestInfo}
                disabled={isProcessing || request.status !== 'pending'}
                accessibilityRole="button"
                accessibilityLabel={`Ask ${applicantName} a question`}
              >
                <MaterialIcons name="chat" size={16} color={theme.textSecondary} />
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
    ratingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    ratingText: {
      color: t.textSecondary,
      fontSize: 12,
    },
    bountySection: {
      marginBottom: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.isDark ? 'rgba(110,231,183,0.2)' : t.border,
    },
    messageSection: {
      marginBottom: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.isDark ? 'rgba(110,231,183,0.15)' : t.border,
    },
    messageSectionLabel: {
      color: t.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    messageText: {
      color: t.text,
      fontSize: 14,
      lineHeight: 20,
    },
    sectionLabel: {
      color: t.textSecondary,
      fontSize: 12,
      marginBottom: 4,
    },
    bountyTitle: {
      color: t.text,
      fontSize: 15,
      fontWeight: '500',
      marginBottom: 8,
    },
    amountBadge: {
      backgroundColor: t.isDark ? '#064e3b' : 'rgba(5,150,105,0.12)',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      alignSelf: 'flex-start',
    },
    amountText: {
      color: t.isDark ? '#6ee7b7' : t.primary,
      fontWeight: '600',
      fontSize: 14,
    },
    // Unique color — kept as designed
    honorBadge: {
      backgroundColor: '#ef4444',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      alignSelf: 'flex-start',
    },
    honorText: {
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
