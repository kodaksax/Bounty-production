import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFollow } from "hooks/useFollow";
import { useNormalizedProfile } from "hooks/useNormalizedProfile";
import { FOLLOW_FEATURE_ENABLED } from "lib/feature-flags";
import { ROUTES } from 'lib/routes';
import { getCurrentUserId } from "lib/utils/data-utils";
import { shareProfile } from "lib/utils/share-utils";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AchievementsGrid } from "../../components/achievements-grid";
import { EnhancedProfileSection, PortfolioSection } from "../../components/enhanced-profile-section";
import { ReportModal } from "../../components/ReportModal";
import { SkillsetChips } from "../../components/skillset-chips";
import { BrandingLogo } from "../../components/ui/branding-logo";
import { UserProfileScreenSkeleton } from "../../components/ui/skeleton-loaders";
import { blockingService } from "../../lib/services/blocking-service";
import { bountyRequestService } from "../../lib/services/bounty-request-service";
import { bountyService } from "../../lib/services/bounty-service";
import { messageService } from "../../lib/services/message-service";
;

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = getCurrentUserId();

  const { profile, loading, error } = useNormalizedProfile(userId);
  const {
    isFollowing,
    followerCount,
    followingCount,
    toggleFollow,
    loading: followLoading,
    error: followError,
  } = useFollow(userId || "", currentUserId);

  const [dismissedError, setDismissedError] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [skills, setSkills] = useState<{ id: string; icon: string; text: string; credentialUrl?: string }[]>([]);
  const [stats, setStats] = useState({
    jobsAccepted: 0,
    bountiesPosted: 0,
    badgesEarned: 0,
    isLoading: true,
  });
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const isOwnProfile = userId === currentUserId;

  // Check if user is blocked
  useEffect(() => {
    const checkBlockStatus = async () => {
      if (!userId || isOwnProfile) return;
      try {
        const result = await blockingService.isUserBlocked(userId);
        if (result.isBlocked !== undefined) {
          setIsBlocked(result.isBlocked);
        }
      } catch (error) {
        console.error('[UserProfileScreen] Error checking block status:', error);
      }
    };
    checkBlockStatus();
  }, [userId, isOwnProfile]);

  // Fetch statistics for the user
  useEffect(() => {
    const fetchStats = async () => {
      if (!userId) return;
      try {
        const postedBounties = await bountyService.getByUserId(userId);
        const acceptedRequests = await bountyRequestService.getByUserId(userId);
        const acceptedJobs = acceptedRequests.filter((req) => req.status === 'accepted');
        const badgesCount = Math.min(postedBounties.length, 3);
        setStats({
          jobsAccepted: acceptedJobs.length,
          bountiesPosted: postedBounties.length,
          badgesEarned: badgesCount,
          isLoading: false,
        });
      } catch (error) {
        console.error('[UserProfileScreen] Error fetching profile statistics:', error);
        setStats(prev => ({ ...prev, isLoading: false }));
      }
    };
    fetchStats();
  }, [userId]);

  // Load skills for the user
  useEffect(() => {
    const loadSkills = async () => {
      if (!userId || !profile) return;
      try {
        const storedSkills = await AsyncStorage.getItem(`profileSkills:${userId}`);
        if (storedSkills) {
          const parsed = JSON.parse(storedSkills);
          if (Array.isArray(parsed)) {
            setSkills(parsed);
            return;
          }
        }

        // Generate skills from profile data
        const profileSkills: { id: string; icon: string; text: string; credentialUrl?: string }[] = [];

        // Add actual skills from profile first
        const raw = (profile as any)?._raw || null;
        const rawSkills = profile.skills || (raw && raw.skills) || [];
        if (Array.isArray(rawSkills) && rawSkills.length > 0) {
          rawSkills.slice(0, 4).forEach((skill, index: number) => {
            // Validate skill is a string
            if (typeof skill === 'string' && skill.trim()) {
              profileSkills.push({
                id: `skill-${index}`,
                icon: 'star',
                text: skill.trim()
              });
            }
          });
        }

        // Add location if available
        const location = profile.location || (raw && raw.location);
        if (location) {
          profileSkills.push({ id: 'location', icon: 'location-on', text: `Based in ${location}` });
        }

        // Add verified contact if phone is set
        if (raw && raw.phone) {
          profileSkills.push({ id: 'verified', icon: 'verified-user', text: 'Verified contact' });
        }

        // Add join date
        if (profile.joinDate) {
          const joinDate = new Date(profile.joinDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          profileSkills.push({ id: 'joined', icon: 'favorite', text: `Joined ${joinDate}` });
        } else {
          profileSkills.push({ id: 'joined', icon: 'favorite', text: 'Member since 2024' });
        }

        setSkills(profileSkills);
      } catch (error) {
        console.error('Error loading skills:', error);
      }
    };
    loadSkills();
  }, [userId, profile]);

  const handleMessage = async () => {
    if (!userId || !currentUserId) {
      Alert.alert('Error', 'Unable to start conversation.');
      return;
    }

    // Check if trying to message yourself
    if (userId === currentUserId) {
      Alert.alert('Cannot Message', 'You cannot message yourself.');
      return;
    }

    setIsCreatingChat(true);
    try {
      // Create or get existing conversation
      await messageService.getOrCreateConversation(
        [userId],
        profile?.username || 'User',
        undefined // no bounty context
      );


      // Navigate to messenger
      router.push(ROUTES.TABS.MESSENGER as any);
    } catch (error) {
      console.error('Error creating conversation:', error);
      Alert.alert('Error', 'Failed to start conversation. Please try again.');
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleEditProfile = () => {
    router.push("/profile/edit");
  };

  const handleFollowersPress = () => {
    if (FOLLOW_FEATURE_ENABLED) {
      router.push(`/profile/followers?userId=${userId}`);
    }
  };

  const handleFollowingPress = () => {
    if (FOLLOW_FEATURE_ENABLED) {
      router.push(`/profile/following?userId=${userId}`);
    }
  };

  const handleShare = async () => {
    await shareProfile({
      name: profile?.name || undefined,
      username: profile?.username || undefined,
      id: userId as string,
      // about: profile?.about // 'about' does not exist on NormalizedProfile
    });
  };

  const handleBlock = () => {
    const actionText = isBlocked ? 'Unblock' : 'Block';
    const actionVerb = isBlocked ? 'unblock' : 'block';
    const message = isBlocked
      ? `Are you sure you want to unblock ${profile?.username}? They will be able to contact you again.`
      : `Are you sure you want to block ${profile?.username}? You will not see their posts and they won't be able to contact you.`;

    Alert.alert(
      `${actionText} User`,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionText,
          style: 'destructive',
          onPress: async () => {
            try {
              const result = isBlocked
                ? await blockingService.unblockUser(userId!)
                : await blockingService.blockUser(userId!);

              if (result.success) {
                setIsBlocked(!isBlocked);
                Alert.alert(
                  isBlocked ? 'Unblocked' : 'Blocked',
                  isBlocked
                    ? `You have unblocked ${profile?.username}`
                    : `You have blocked ${profile?.username}`
                );
              } else {
                Alert.alert('Error', result.error || `Failed to ${actionVerb} user.`);
              }
            } catch (error) {
              console.error(`Error ${actionVerb}ing user:`, error);
              Alert.alert('Error', `An error occurred while ${actionVerb}ing this user.`);
            }
            setShowMoreMenu(false);
          },
        },
      ]
    );
  };

  const handleReport = () => {
    setShowReportModal(true);
    setShowMoreMenu(false);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top - 40, 6) }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        >
          <UserProfileScreenSkeleton />
        </ScrollView>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top - 8, 6) }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <BrandingLogo size="small" />
        </View>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Profile not found</Text>
          <Text style={styles.errorText}>
            {error || "This user profile could not be loaded."}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const displayError = !dismissedError && (error || followError);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top - 40, 6) }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <BrandingLogo size="small" />
        </View>
        {!isOwnProfile && (
          <TouchableOpacity
            onPress={() => setShowMoreMenu(!showMoreMenu)}
            style={styles.moreButton}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <MaterialIcons name="more-vert" size={24} color="#ffffff" />
          </TouchableOpacity>
        )}
        {isOwnProfile && <View style={{ width: 40 }} />}
      </View>

      {/* More Menu Dropdown with backdrop to dismiss when tapping outside */}
      {showMoreMenu && !isOwnProfile && (
        <Pressable style={styles.moreMenuWrapper} onPress={() => setShowMoreMenu(false)}>
          <View style={styles.moreMenuBackdrop} />
          <View style={[styles.moreMenuContainer, { top: 48 }]}>
            <TouchableOpacity style={styles.moreMenuItem} onPress={handleShare}>
              <MaterialIcons name="share" size={20} color="#a7f3d0" />
              <Text style={styles.moreMenuText}>Share Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreMenuItem} onPress={handleReport}>
              <MaterialIcons name="report" size={20} color="#fbbf24" />
              <Text style={styles.moreMenuText}>Report</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreMenuItem} onPress={handleBlock}>
              <MaterialIcons name="block" size={20} color="#ef4444" />
              <Text style={styles.moreMenuText}>Block</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      )}

      {/* Error Banner */}
      {displayError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error || followError}</Text>
          <TouchableOpacity onPress={() => setDismissedError(true)}>
            <MaterialIcons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* Enhanced Profile Section */}
        <EnhancedProfileSection
          userId={userId}
          isOwnProfile={isOwnProfile}
          showPortfolio={false}
          activityStats={{
            jobsAccepted: stats.jobsAccepted,
            bountiesPosted: stats.bountiesPosted,
            badgesEarned: stats.badgesEarned,
          }}
        />

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          {isOwnProfile ? (
            <TouchableOpacity style={styles.primaryButton} onPress={handleEditProfile}>
              <MaterialIcons name="edit" size={18} color="#065f46" />
              <Text style={styles.primaryButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, isCreatingChat && styles.primaryButtonDisabled]}
                onPress={handleMessage}
                disabled={isCreatingChat}
              >
                {isCreatingChat ? (
                  <ActivityIndicator size="small" color="#065f46" />
                ) : (
                  <>
                    <MaterialIcons name="message" size={18} color="#065f46" />
                    <Text style={styles.primaryButtonText}>Send Message</Text>
                  </>
                )}
              </TouchableOpacity>
              {FOLLOW_FEATURE_ENABLED && (
                <TouchableOpacity
                  style={[styles.secondaryButton, isFollowing && styles.followingButton]}
                  onPress={toggleFollow}
                  disabled={followLoading}
                >
                  {followLoading ? (
                    <ActivityIndicator size="small" color={isFollowing ? "#10b981" : "#ffffff"} />
                  ) : (
                    <>
                      <MaterialIcons
                        name={isFollowing ? "person-remove" : "person-add"}
                        size={18}
                        color={isFollowing ? "#10b981" : "#ffffff"}
                      />
                      <Text style={[styles.secondaryButtonText, isFollowing && styles.followingButtonText]}>
                        {isFollowing ? "Following" : "Follow"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Stats */}
        {FOLLOW_FEATURE_ENABLED && (
          <View style={styles.statsContainer}>
            <TouchableOpacity style={styles.statItem} onPress={handleFollowersPress}>
              <Text style={styles.statValue}>{followerCount}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity style={styles.statItem} onPress={handleFollowingPress}>
              <Text style={styles.statValue}>{followingCount}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Skillsets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skillsets</Text>
          <SkillsetChips skills={skills} />
        </View>

        {/* Portfolio */}
        <PortfolioSection userId={userId} isOwnProfile={isOwnProfile} />

        {/* Achievements */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Achievements</Text>
          <AchievementsGrid badgesEarned={stats.badgesEarned} />
        </View>
      </ScrollView>

      {/* Report Modal */}
      <ReportModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        contentType="profile"
        contentId={userId || ''}
        contentTitle={profile?.username}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#059669", // emerald-600
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#059669", // emerald-600
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backButton: {
    padding: 4,
  },
  moreButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#ffffff",
    letterSpacing: 1.6,
  },
  moreMenuContainer: {
    position: "absolute",
    top: 60,
    right: 16,
    backgroundColor: "#047857", // emerald-700
    borderRadius: 8,
    padding: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  moreMenuWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 90,
  },
  moreMenuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  moreMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  moreMenuText: {
    fontSize: 14,
    color: "#ffffff",
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#a7f3d0", // emerald-200
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#ffffff",
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#a7f3d0", // emerald-200
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#10b981", // emerald-500
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  errorBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#dc2626",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  errorBannerText: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#a7f3d0", // emerald-200
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#065f46", // emerald-800
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#a7f3d0", // emerald-200
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  followingButton: {
    backgroundColor: "rgba(167, 243, 208, 0.1)",
  },
  followingButtonText: {
    color: "#10b981",
  },
  statsContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(167, 243, 208, 0.1)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 16,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: "#047857", // emerald-700
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: "#a7f3d0", // emerald-200
  },
  section: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 12,
  },
});
