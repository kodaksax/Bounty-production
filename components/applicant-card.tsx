// components/applicant-card.tsx - Single-screen applicant card with one-tap accept/reject
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { getValidAvatarUrl } from '../lib/utils/avatar-utils';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import TextGuard from './ui/TextGuard';

interface ApplicantCardProps {
  request: BountyRequestWithDetails;
  onAccept: (requestId: number) => Promise<void>;
  onReject: (requestId: number) => Promise<void>;
  onRequestMoreInfo?: (requestId: number) => void;
}

export function ApplicantCard({
  request,
  onAccept,
  onReject,
  onRequestMoreInfo,
}: ApplicantCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionType, setActionType] = useState<'accept' | 'reject' | null>(null);
  const [isNavigatingToProfile, setIsNavigatingToProfile] = useState(false);
  const router = useRouter();
  
  // Track component mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleAccept = async () => {
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

  const handleReject = async () => {
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

  const handleRequestInfo = () => {
    if (onRequestMoreInfo) {
      onRequestMoreInfo(request.id);
    }
  };

  const handleProfilePress = useCallback(() => {
    const id = (request as any).hunter_id || (request as any).user_id;
    if (id) {
      setIsNavigatingToProfile(true);
      router.push(`/profile/${id}`);
      // Reset state after navigation - check if component is still mounted
      setTimeout(() => {
        if (isMountedRef.current) {
          setIsNavigatingToProfile(false);
        }
      }, 500);
    }
  }, [request, router]);

  const profileId = (request as any).hunter_id || (request as any).user_id;
  
  // Get a valid avatar URL, filtering out placeholder URLs
  const validAvatarUrl = getValidAvatarUrl(request.profile?.avatar_url);

  return (
    <TextGuard>
      <View style={styles.card}>
      {/* Header with avatar and applicant info - Clickable to navigate to profile */}
      <TouchableOpacity 
        style={styles.header} 
        onPress={handleProfilePress} 
        disabled={!profileId || isNavigatingToProfile}
        accessibilityRole="button"
        accessibilityLabel={`View ${request.profile?.username || 'applicant'}'s profile`}
        accessibilityHint="Opens the applicant's profile page"
      >
        <View style={styles.avatarContainer}>
          {isNavigatingToProfile ? (
            <View style={[styles.avatar, styles.avatarLoading]}>
              <ActivityIndicator size="small" color="#a7f3d0" />
            </View>
          ) : (
            <Avatar style={styles.avatar}>
              <AvatarImage 
                src={validAvatarUrl} 
                alt={request.profile?.username || 'Applicant'} 
              />
              <AvatarFallback style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {(request.profile?.username || 'U').substring(0, 2).toUpperCase()}
                </Text>
              </AvatarFallback>
            </Avatar>
          )}
        </View>

        <View style={styles.applicantInfo}>{/* avoid whitespace text node */}
          <Text style={styles.applicantName}>
            {request.profile?.username || 'Unknown User'}
          </Text>
          <View style={styles.ratingContainer}>
            <MaterialIcons name="star" size={14} color="#fbbf24" />
            <Text style={styles.ratingText}>
              {request.profile?.averageRating?.toFixed(1) || '—'}
              {request.profile?.ratingCount ? ` (${request.profile.ratingCount})` : ''}
            </Text>
          </View>
        </View>{/* avoid whitespace text node */}

        {profileId ? (
          <MaterialIcons name="chevron-right" size={20} color="#a7f3d0" style={{ marginLeft: 'auto' }} />
        ) : null}
      </TouchableOpacity>

      {/* Bounty details */}
      <View style={styles.bountySection}>
        <Text style={styles.sectionLabel}>Applied for:</Text>
        <Text style={styles.bountyTitle}>{request.bounty?.title || 'Untitled Bounty'}</Text>
        {request.bounty?.amount > 0 && !request.bounty?.is_for_honor && (
          <View style={styles.amountBadge}>
            <Text style={styles.amountText}>${request.bounty.amount}</Text>
          </View>
        )}
        {request.bounty?.is_for_honor && (
          <View style={styles.honorBadge}>
            <MaterialIcons name="favorite" size={14} color="#fff" />
            <Text style={styles.honorText}>For Honor</Text>
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.rejectButton]}
          onPress={handleReject}
          disabled={isProcessing || request.status !== 'pending'}
        >
          {isProcessing && actionType === 'reject' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="close" size={18} color="#fff" />
              <Text style={styles.buttonText}>Reject</Text>
            </View>
          )}
        </TouchableOpacity>

        {onRequestMoreInfo && (
          <TouchableOpacity
            style={[styles.button, styles.infoButton]}
            onPress={handleRequestInfo}
            disabled={isProcessing || request.status !== 'pending'}
          >
            <MaterialIcons name="chat" size={18} color="#10b981" />
            <Text style={[styles.buttonText, styles.infoButtonText]}>Ask</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, styles.acceptButton]}
          onPress={handleAccept}
          disabled={isProcessing || request.status !== 'pending'}
        >
          {isProcessing && actionType === 'accept' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="check" size={18} color="#fff" />
              <Text style={styles.buttonText}>Accept</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Status badge for non-pending requests */}
      {request.status !== 'pending' && (
        <View style={styles.statusBadge}>
          <Text style={[
            styles.statusText,
            request.status === 'accepted' ? styles.statusAccepted : styles.statusRejected
          ]}>
            {request.status === 'accepted' ? '✓ Accepted' : '✕ Rejected'}
          </Text>
        </View>
      )}
      </View>
    </TextGuard>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#047857', // emerald-700
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
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
    borderColor: '#6ee7b7', // emerald-400
    borderRadius: 24,
  },
  avatarLoading: {
    backgroundColor: '#064e3b', // emerald-900
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallback: {
    backgroundColor: '#064e3b', // emerald-900
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#a7f3d0', // emerald-200
    fontSize: 16,
    fontWeight: '600',
  },
  applicantInfo: {
    marginLeft: 12,
    flex: 1,
  },
  applicantName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: '#a7f3d0', // emerald-200
    fontSize: 13,
  },
  bountySection: {
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(110, 231, 183, 0.2)',
  },
  sectionLabel: {
    color: '#a7f3d0', // emerald-200
    fontSize: 12,
    marginBottom: 4,
  },
  bountyTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  amountBadge: {
    backgroundColor: '#064e3b', // emerald-900
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  amountText: {
    color: '#6ee7b7', // emerald-400
    fontWeight: '600',
    fontSize: 14,
  },
  honorBadge: {
    backgroundColor: '#ef4444', // red-500
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
    flexDirection: 'row',
    gap: 8,
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
  rejectButton: {
    backgroundColor: '#dc2626', // red-600
  },
  infoButton: {
    backgroundColor: '#047857', // emerald-700
    borderWidth: 1,
    borderColor: '#10b981', // emerald-500
  },
  acceptButton: {
    backgroundColor: '#10b981', // emerald-500
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  infoButtonText: {
    color: '#10b981', // emerald-500
  },
  statusBadge: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(110, 231, 183, 0.2)',
  },
  statusText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 14,
  },
  statusAccepted: {
    color: '#10b981', // emerald-500
  },
  statusRejected: {
    color: '#dc2626', // red-600
  },
});
