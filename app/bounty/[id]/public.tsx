import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { useBackgroundColor } from '../../../lib/context/BackgroundColorContext';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { bountyService } from '../../../lib/services/bounty-service';
import type { Bounty } from '../../../lib/services/database.types';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import { formatCategoryLabel } from '../../../lib/utils/data-utils';
import { LinearGradient } from 'expo-linear-gradient';

export default function PublicBountyDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { pushColor, popColor } = useBackgroundColor();
  const { session, isEmailVerified } = useAuthContext();
  const currentUserId = session?.user?.id ?? null;

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [hasApplied, setHasApplied] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const routeBountyId = React.useMemo(() => {
    const raw = Array.isArray(id) ? id[0] : id;
    return raw && String(raw).trim().length > 0 ? String(raw) : null;
  }, [id]);

  useEffect(() => {
    if (!routeBountyId) {
      setError('Invalid bounty id');
      setIsLoading(false);
      return;
    }
    pushColor(theme.background);
    loadBounty(routeBountyId);
    return () => {
      popColor(theme.background);
    };
  }, [routeBountyId]);

  const loadBounty = async (bountyId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await bountyService.getById(bountyId);
      
      if (!data) {
        throw new Error('Bounty not found');
      }

      setBounty(data);

      if (currentUserId && currentUserId !== data.user_id && currentUserId !== data.poster_id) {
        const requests = await bountyRequestService.getAll({
          bountyId,
          userId: currentUserId,
        });
        setHasApplied(requests.length > 0);
      }
    } catch (err) {
      console.error('Error loading bounty:', err);
      setError(err instanceof Error ? err.message : 'Failed to load bounty');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadgeColor = (status?: string) => {
    switch (status) {
      case 'open':
        return '#059669'; // emerald-500
      case 'in_progress':
        return '#fbbf24'; // amber-400
      case 'completed':
        return '#6366f1'; // indigo-500
      case 'archived':
        return '#6b7280'; // gray-500
      default:
        return '#059669';
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'open':
        return 'OPEN';
      case 'in_progress':
        return 'IN PROGRESS';
      case 'completed':
        return 'COMPLETED';
      case 'archived':
        return 'ARCHIVED';
      default:
        return 'OPEN';
    }
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const handleApply = async () => {
    if (!bounty) return;
    if (!isEmailVerified) {
      Alert.alert(
        'Email verification required',
        "Please verify your email to apply for bounties.",
        [{ text: 'OK' }]
      );
      return;
    }
    if (!currentUserId) {
      Alert.alert('Sign In Required', 'You must be signed in to apply for bounties.');
      return;
    }

    Alert.alert(
      'Apply for Bounty',
      'Are you sure you want to apply for this bounty? The poster will be notified of your request.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Apply', 
          onPress: async () => {
            setIsApplying(true);
            try {
              const result = await bountyRequestService.create({
                bounty_id: bounty.id,
                hunter_id: currentUserId,
                status: 'pending',
                poster_id: bounty.poster_id || bounty.user_id,
                message: null,
              } as any);

              if (result && (result as any).success) {
                setHasApplied(true);
                Alert.alert('Success', 'Your application has been submitted!', [
                  { text: 'View Status', onPress: () => router.push(`/in-progress/${bounty.id}/hunter`) },
                  { text: 'OK' }
                ]);
              } else {
                Alert.alert('Error', (result && (result as any).error) || 'Failed to apply.');
              }
            } catch (err) {
              console.error('Error applying:', err);
              Alert.alert('Error', 'An unexpected error occurred.');
            } finally {
              setIsApplying(false);
            }
          } 
        }
      ]
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={s.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={s.loadingText}>Loading bounty...</Text>
      </SafeAreaView>
    );
  }

  if (error || !bounty) {
    return (
      <SafeAreaView style={s.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={s.errorText}>{error || 'Failed to load bounty'}</Text>
        <TouchableOpacity style={s.backButton} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={20} color={theme.primaryLight} />
          <Text style={s.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={[s.container, { width: '100%', alignSelf: 'stretch' }]}>
      {/* Decorative gradient background */}
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'transparent']}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity style={s.backIcon} onPress={() => router.back()}>
            <View style={s.backIconBg}>
              <MaterialIcons name="arrow-back" size={24} color={theme.text} />
            </View>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Bounty Details</Text>
          <View style={{ width: 40 }} /> {/* Spacer for centering */}
        </View>

        <ScrollView
          style={[s.scrollView, { width: '100%' }]}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Main Hero Card */}
          <View style={s.heroCard}>
            <LinearGradient
              colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 24 }]}
            />
            
            <View style={s.heroTopRow}>
              <View style={[s.statusBadge, { backgroundColor: getStatusBadgeColor(bounty.status) }]}>
                <Text style={s.statusBadgeText}>{getStatusLabel(bounty.status)}</Text>
              </View>
              <Text style={s.bountyAge}>{formatTimeAgo(bounty.created_at)}</Text>
            </View>

            <Text style={s.bountyTitle}>{bounty.title}</Text>
            
            <View style={s.priceRow}>
              {bounty.is_for_honor ? (
                <View style={s.honorBadge}>
                  <MaterialIcons name="local-fire-department" size={24} color="#fcd34d" />
                  <Text style={s.honorText}>For Honor</Text>
                </View>
              ) : (
                <Text style={s.amount}>${bounty.amount}</Text>
              )}
              {((bounty as any)?.category) ? (
                <View style={s.categoryPill}>
                  <Text style={s.categoryPillText}>{formatCategoryLabel((bounty as any).category)}</Text>
                </View>
              ) : null}
            </View>

            <View style={s.divider} />
            
            <View style={s.posterInfo}>
              <View style={s.avatarPlaceholder}>
                <MaterialIcons name="person" size={24} color={theme.textSecondary} />
              </View>
              <View style={s.posterTextGroup}>
                <Text style={s.posterLabel}>Posted by</Text>
                <Text style={s.posterName}>{(bounty as any).username || 'Anonymous'}</Text>
              </View>
            </View>
          </View>

          {/* Details Section */}
          <View style={s.detailsCard}>
            <Text style={s.sectionTitle}>Description</Text>
            <Text style={s.description}>{bounty.description}</Text>
            
            <View style={s.infoGrid}>
              {bounty.location ? (
                <View style={s.infoBox}>
                  <View style={s.infoIconBg}>
                    <MaterialIcons name="place" size={20} color={theme.primary} />
                  </View>
                  <Text style={s.infoBoxLabel}>Location</Text>
                  <Text style={s.infoBoxValue}>{bounty.location}</Text>
                </View>
              ) : null}
              
              {bounty.work_type ? (
                <View style={s.infoBox}>
                  <View style={s.infoIconBg}>
                    <MaterialIcons name={bounty.work_type === 'online' ? 'computer' : 'directions-walk'} size={20} color={theme.primary} />
                  </View>
                  <Text style={s.infoBoxLabel}>Type</Text>
                  <Text style={s.infoBoxValue}>{bounty.work_type === 'online' ? 'Remote' : 'In Person'}</Text>
                </View>
              ) : null}
            </View>

            {bounty.skills_required ? (
              <View style={s.skillsSection}>
                <Text style={s.infoBoxLabel}>Skills Requirements</Text>
                <View style={s.skillsList}>
                  {bounty.skills_required.split(',').map((skill, index) => (
                    <View key={index} style={s.skillTag}>
                      <Text style={s.skillTagText}>{skill.trim()}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {bounty.timeline ? (
              <View style={s.timelineBox}>
                <MaterialIcons name="schedule" size={20} color={theme.textSecondary} />
                <View>
                  <Text style={s.infoBoxLabel}>Timeline</Text>
                  <Text style={s.timelineValue}>{bounty.timeline}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Action Area */}
          <View style={s.actionContainer}>
            {currentUserId === bounty.user_id || currentUserId === bounty.poster_id ? (
              <TouchableOpacity 
                style={s.actionButton}
                onPress={() => router.push({ pathname: '/postings/[bountyId]', params: { bountyId: routeBountyId! } })}
              >
                <LinearGradient
                  colors={['#3b82f6', '#2563eb']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                <Text style={s.actionButtonText}>Go to Poster Dashboard</Text>
              </TouchableOpacity>
            ) : hasApplied ? (
              <TouchableOpacity 
                style={s.actionButton}
                onPress={() => router.push(`/in-progress/${routeBountyId}/hunter`)}
              >
                <LinearGradient
                  colors={['#8b5cf6', '#6d28d9']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                <Text style={s.actionButtonText}>View Your Application</Text>
              </TouchableOpacity>
            ) : bounty.status === 'open' ? (
              <TouchableOpacity 
                style={[s.actionButton, isApplying && { opacity: 0.8 }]}
                onPress={handleApply}
                disabled={isApplying}
              >
                <LinearGradient
                  colors={['#059669', '#047857']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                {isApplying ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={s.actionButtonText}>Apply for Bounty</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={[s.actionButton, { opacity: 0.5 }]}
                disabled={true}
              >
                <LinearGradient
                  colors={['#6b7280', '#4b5563']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                <Text style={s.actionButtonText}>Bounty Closed</Text>
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    loadingContainer: {
      flex: 1,
      backgroundColor: t.background,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
    },
    loadingText: {
      color: t.textSecondary,
      fontSize: 16,
      fontWeight: '500',
    },
    errorContainer: {
      flex: 1,
      backgroundColor: t.background,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      padding: 24,
    },
    errorText: {
      color: '#ef4444',
      fontSize: 16,
      textAlign: 'center',
    },
    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: t.surface,
      borderRadius: 99,
      gap: 8,
      marginTop: 16,
    },
    backButtonText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    backIcon: {
      padding: 4,
    },
    backIconBg: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: {
      color: t.text,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 16,
      gap: 16,
    },
    heroCard: {
      backgroundColor: t.surface,
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    statusBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    statusBadgeText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    bountyAge: {
      color: t.primaryLight,
      fontSize: 13,
      fontWeight: '500',
    },
    bountyTitle: {
      color: t.text,
      fontSize: 28,
      fontWeight: '800',
      marginBottom: 16,
      lineHeight: 34,
    },
    priceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 20,
    },
    amount: {
      color: t.text,
      fontSize: 32,
      fontWeight: '900',
    },
    // Semantic amber — unchanged across themes
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(245,158,11,0.2)',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.4)',
    },
    honorText: {
      color: '#fcd34d',
      fontSize: 16,
      fontWeight: '800',
    },
    categoryPill: {
      backgroundColor: t.overlay,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    categoryPillText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    divider: {
      height: 1,
      backgroundColor: t.border,
      marginVertical: 20,
    },
    posterInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatarPlaceholder: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.border,
    },
    posterTextGroup: {
      flex: 1,
    },
    posterLabel: {
      color: t.primaryLight,
      fontSize: 12,
      fontWeight: '500',
      marginBottom: 2,
    },
    posterName: {
      color: t.text,
      fontSize: 16,
      fontWeight: '600',
    },
    detailsCard: {
      backgroundColor: t.surface,
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: t.border,
      gap: 24,
    },
    sectionTitle: {
      color: t.textSecondary,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    description: {
      color: t.text,
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '400',
    },
    infoGrid: {
      flexDirection: 'row',
      gap: 16,
    },
    infoBox: {
      flex: 1,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 16,
      padding: 16,
      gap: 8,
    },
    infoIconBg: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: t.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    infoBoxLabel: {
      color: t.primaryLight,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    infoBoxValue: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
    },
    skillsSection: {
      gap: 12,
    },
    skillsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    skillTag: {
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    skillTagText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '500',
    },
    timelineBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      padding: 16,
      borderRadius: 16,
      gap: 16,
    },
    timelineValue: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
      marginTop: 4,
    },
    actionContainer: {
      marginTop: 8,
    },
    actionButton: {
      height: 56,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: t.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    actionButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
  });
}
