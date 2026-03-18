import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { formatCategoryLabel } from '../../../lib/utils/data-utils';
import { LinearGradient } from 'expo-linear-gradient';

export default function PublicBountyDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    pushColor('#0f291e'); // Darker, richer background
    loadBounty(routeBountyId);
    return () => {
      popColor('#0f291e');
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
        return '#10b981'; // emerald-500
      case 'in_progress':
        return '#fbbf24'; // amber-400
      case 'completed':
        return '#6366f1'; // indigo-500
      case 'archived':
        return '#6b7280'; // gray-500
      default:
        return '#10b981';
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
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>Loading bounty...</Text>
      </SafeAreaView>
    );
  }

  if (error || !bounty) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={styles.errorText}>{error || 'Failed to load bounty'}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={20} color="#6ee7b7" />
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { width: '100%', alignSelf: 'stretch' }]}>
      {/* Decorative gradient background */}
      <LinearGradient
        colors={['rgba(16, 185, 129, 0.15)', 'transparent']}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
            <View style={styles.backIconBg}>
              <MaterialIcons name="arrow-back" size={24} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bounty Details</Text>
          <View style={{ width: 40 }} /> {/* Spacer for centering */}
        </View>

        <ScrollView
          style={[styles.scrollView, { width: '100%' }]}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Main Hero Card */}
          <View style={styles.heroCard}>
            <LinearGradient
              colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 24 }]}
            />
            
            <View style={styles.heroTopRow}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusBadgeColor(bounty.status) }]}>
                <Text style={styles.statusBadgeText}>{getStatusLabel(bounty.status)}</Text>
              </View>
              <Text style={styles.bountyAge}>{formatTimeAgo(bounty.created_at)}</Text>
            </View>

            <Text style={styles.bountyTitle}>{bounty.title}</Text>
            
            <View style={styles.priceRow}>
              {bounty.is_for_honor ? (
                <View style={styles.honorBadge}>
                  <MaterialIcons name="local-fire-department" size={24} color="#fcd34d" />
                  <Text style={styles.honorText}>For Honor</Text>
                </View>
              ) : (
                <Text style={styles.amount}>${bounty.amount}</Text>
              )}
              {((bounty as any)?.category) ? (
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryPillText}>{formatCategoryLabel((bounty as any).category)}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.divider} />
            
            <View style={styles.posterInfo}>
              <View style={styles.avatarPlaceholder}>
                <MaterialIcons name="person" size={24} color="#a7f3d0" />
              </View>
              <View style={styles.posterTextGroup}>
                <Text style={styles.posterLabel}>Posted by</Text>
                <Text style={styles.posterName}>{(bounty as any).username || 'Anonymous'}</Text>
              </View>
            </View>
          </View>

          {/* Details Section */}
          <View style={styles.detailsCard}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{bounty.description}</Text>
            
            <View style={styles.infoGrid}>
              {bounty.location ? (
                <View style={styles.infoBox}>
                  <View style={styles.infoIconBg}>
                    <MaterialIcons name="place" size={20} color="#10b981" />
                  </View>
                  <Text style={styles.infoBoxLabel}>Location</Text>
                  <Text style={styles.infoBoxValue}>{bounty.location}</Text>
                </View>
              ) : null}
              
              {bounty.work_type ? (
                <View style={styles.infoBox}>
                  <View style={styles.infoIconBg}>
                    <MaterialIcons name={bounty.work_type === 'online' ? 'computer' : 'directions-walk'} size={20} color="#10b981" />
                  </View>
                  <Text style={styles.infoBoxLabel}>Type</Text>
                  <Text style={styles.infoBoxValue}>{bounty.work_type === 'online' ? 'Remote' : 'In Person'}</Text>
                </View>
              ) : null}
            </View>

            {bounty.skills_required ? (
              <View style={styles.skillsSection}>
                <Text style={styles.infoBoxLabel}>Skills Requirements</Text>
                <View style={styles.skillsList}>
                  {bounty.skills_required.split(',').map((skill, index) => (
                    <View key={index} style={styles.skillTag}>
                      <Text style={styles.skillTagText}>{skill.trim()}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {bounty.timeline ? (
              <View style={styles.timelineBox}>
                <MaterialIcons name="schedule" size={20} color="#a7f3d0" />
                <View>
                  <Text style={styles.infoBoxLabel}>Timeline</Text>
                  <Text style={styles.timelineValue}>{bounty.timeline}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Action Area */}
          <View style={styles.actionContainer}>
            {currentUserId === bounty.user_id || currentUserId === bounty.poster_id ? (
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => router.push({ pathname: '/postings/[bountyId]', params: { bountyId: routeBountyId! } })}
              >
                <LinearGradient
                  colors={['#3b82f6', '#2563eb']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                <Text style={styles.actionButtonText}>Go to Poster Dashboard</Text>
              </TouchableOpacity>
            ) : hasApplied ? (
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={() => router.push(`/in-progress/${routeBountyId}/hunter`)}
              >
                <LinearGradient
                  colors={['#8b5cf6', '#6d28d9']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                <Text style={styles.actionButtonText}>View Your Application</Text>
              </TouchableOpacity>
            ) : bounty.status === 'open' ? (
              <TouchableOpacity 
                style={[styles.actionButton, isApplying && { opacity: 0.8 }]}
                onPress={handleApply}
                disabled={isApplying}
              >
                <LinearGradient
                  colors={['#10b981', '#059669']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                {isApplying ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.actionButtonText}>Apply for Bounty</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={[styles.actionButton, { opacity: 0.5 }]}
                disabled={true}
              >
                <LinearGradient
                  colors={['#6b7280', '#4b5563']}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
                />
                <Text style={styles.actionButtonText}>Bounty Closed</Text>
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f291e', // deeper dark green
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f291e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: '#a7f3d0',
    fontSize: 16,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#0f291e',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 99,
    gap: 8,
    marginTop: 16,
  },
  backButtonText: {
    color: '#a7f3d0',
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
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
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.15)',
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
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '500',
  },
  bountyTitle: {
    color: '#fff',
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
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
  },
  honorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  honorText: {
    color: '#fcd34d',
    fontSize: 16,
    fontWeight: '800',
  },
  categoryPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  categoryPillText: {
    color: '#a7f3d0',
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  posterTextGroup: {
    flex: 1,
  },
  posterLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  posterName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  detailsCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.1)',
    gap: 24,
  },
  sectionTitle: {
    color: '#a7f3d0',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  description: {
    color: '#e5e7eb',
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
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  infoIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBoxLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoBoxValue: {
    color: '#fff',
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
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  skillTagText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  timelineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 16,
    borderRadius: 16,
    gap: 16,
  },
  timelineValue: {
    color: '#fff',
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
    shadowColor: '#10b981',
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
