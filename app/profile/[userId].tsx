import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthContext } from "hooks/use-auth-context";
import { useFollow } from "hooks/useFollow";
import { useNormalizedProfile } from "hooks/useNormalizedProfile";
import { FOLLOW_FEATURE_ENABLED } from "lib/feature-flags";
import { ROUTES } from 'lib/routes';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { resendVerification } from "lib/services/auth-service";
import { supabase } from "lib/supabase";
import { getCurrentUserId } from "lib/utils/data-utils";
import { shareProfile } from "lib/utils/share-utils";
import { useEffect, useState, useMemo } from 'react';
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
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EnhancedProfileSection, PortfolioSection } from "../../components/enhanced-profile-section";
import { ProfileBountyHistorySection } from "../../components/profile-bounty-history-section";
import { ReportModal } from "../../components/ReportModal";
import { SkillsetChips } from "../../components/skillset-chips";
import { BrandingLogo } from "../../components/ui/branding-logo";
import { MilestoneBadgeChips } from "../../components/ui/milestone-badge-chips";
import { ProfileCompletionMeter } from "../../components/ui/profile-completion-meter";
import { ScreenHeader } from "../../components/ui/screen-header";
import { UserProfileScreenSkeleton } from "../../components/ui/skeleton-loaders";
import { VerificationBadgeChips } from "../../components/ui/verification-badge-chips";
import { useProfileActivityStats } from "../../hooks/useProfileActivityStats";
import { useRatings } from "../../hooks/useRatings";
import { authProfileService } from "../../lib/services/auth-profile-service";
import { blockingService } from "../../lib/services/blocking-service";
import { bountyRequestService } from "../../lib/services/bounty-request-service";
import { messageService } from "../../lib/services/message-service";
import { navigationIntent } from "../../lib/services/navigation-intent";
;

// Same open/close timing as the app-wide AppModal primitive (see
// components/ui/app-modal.tsx) — this "more options" menu is a lightweight
// anchored popover rather than a full-screen modal, so it doesn't go through
// AppModal itself, but it shouldn't feel like a different animation system.
const MENU_OPEN_DURATION = 220;
const MENU_CLOSE_DURATION = 180;
const MENU_EASE_OUT = Easing.out(Easing.cubic);

function MoreMenuPopover({ visible, onDismiss, children, style }: {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  style: any;
}) {
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: MENU_OPEN_DURATION, easing: MENU_EASE_OUT });
    } else {
      progress.value = withTiming(0, { duration: MENU_CLOSE_DURATION, easing: MENU_EASE_OUT }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.96 + progress.value * 0.04 }],
  }));

  if (!mounted) return null;

  return (
    <Pressable style={popoverStyles.wrapper} onPress={onDismiss}>
      <View style={popoverStyles.backdrop} />
      <Animated.View style={[style, animStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

const popoverStyles = StyleSheet.create({
  wrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 90 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
});

export default function UserProfileScreen() {
  const { userId, referrer } = useLocalSearchParams<{ userId: string; referrer?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = getCurrentUserId();
  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

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
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [skills, setSkills] = useState<{ id: string; icon: string; text: string; credentialUrl?: string }[]>([]);
  const { stats: activityStats } = useProfileActivityStats(userId);
  const { stats: ratingStats } = useRatings(userId);
  const [jobsAccepted, setJobsAccepted] = useState(0);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const isOwnProfile = userId === currentUserId;
  const isEmailVerified = Boolean(
    session?.user?.email_confirmed_at && session?.user?.email
  );

  const handleResendVerification = async () => {
    const email = session?.user?.email;
    if (!email) {
      setResendMessage(
        "We don't have an email associated with your account. Please add an email address in your account settings to receive a verification link."
      );
      return;
    }
    setResendLoading(true);
    setResendMessage(null);
    try {
      const result = await resendVerification(email);
      setResendMessage(result.message);
    } catch {
      setResendMessage('Failed to send verification email. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

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

  // Hunter-side "jobs accepted" — distinct from activityStats (poster-side
  // posted/completed, via useProfileActivityStats).
  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    bountyRequestService
      .getByUserId(userId)
      .then((requests) => {
        if (!cancelled) {
          setJobsAccepted(requests.filter((req) => req.status === 'accepted').length);
        }
      })
      .catch((error) => {
        console.error('[UserProfileScreen] Error fetching accepted jobs:', error);
      });
    return () => {
      cancelled = true;
    };
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

        // Add verified contact only if the phone number is actually verified,
        // not merely present (raw.phone truthy previously conflated "entered
        // a phone number" with "verified it").
        if (raw && raw.phone_verified === true) {
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
      const conversation = await messageService.getOrCreateConversation(
        [userId],
        profile?.username || 'User',
        undefined // no bounty context
      );

      if (!conversation || !conversation.id) {
        throw new Error('Conversation created but no ID returned');
      }

      // Set intent to open this conversation (Messenger will pick this up)
      await navigationIntent.setPendingConversationId(conversation.id);

      // Navigate into the BountyApp container and request the messenger view so
      // the BottomNav (tab bar) is preserved. Navigating directly to the
      // messenger route renders the screen outside the tabs and hides the nav.
      type BountyAppScreen = "messages";
      const targetScreen: BountyAppScreen = "messages";
      const bountyAppRoute = `${ROUTES.TABS.BOUNTY_APP}?screen=${encodeURIComponent(
        targetScreen
      )}` as const;
      router.push(bountyAppRoute as any);
    } catch (error) {
      console.error('Error creating conversation:', error);
      // Ensure we don't navigate on error
      const errorMessage = error instanceof Error ? error.message : 'Failed to start conversation';
      Alert.alert('Error', `${errorMessage}. Please try again.`);
      // Make sure we clear any pending conversation ID on error
      try {
        await navigationIntent.setPendingConversationId(null);
      } catch {
        // Ignore clearing errors
      }
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
      id: userId as string,
      name: profile?.name || profile?.display_name || undefined,
      username: profile?.username || undefined,
      about: profile?.bio || undefined,
      completedCount: activityStats.bountiesCompleted,
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

  const handleBack = async () => {
    // If a referrer was provided when opening this profile, try to route
    // back to it. Use navigationIntent to hand the referrer to the BountyApp
    // root which will apply it even if the BountyApp is already mounted.
    if (referrer) {
      try {
        const decoded = decodeURIComponent(referrer as string);
        await navigationIntent.setPendingNavigation(decoded as string);
        // Replace to the BountyApp root so it can consume the pending nav.
        router.replace(ROUTES.TABS.BOUNTY_APP as any);
        return;
      } catch (err) {
        // fall through to default behavior
      }
    }

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Header */}
        <ScreenHeader
          showBack
          onBack={handleBack}
          centerNode={<BrandingLogo size="small" />}
        />
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
        <ScreenHeader
          showBack
          onBack={handleBack}
          centerNode={<BrandingLogo size="small" />}
        />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Profile not found</Text>
          <Text style={styles.errorText}>
            {error || "This user profile could not be loaded."}
          </Text>
          {session ? (
            <>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: '#2563eb' }]}
                onPress={async () => {
                  try {
                    // attempt to refresh the authenticated profile
                    await authProfileService.refreshProfile();
                  } catch (err) {
                    console.error('[UserProfileScreen] Retry refresh failed:', err);
                  }
                }}
              >
                <Text style={[styles.retryButtonText, { color: '#fff' }]}>Retry Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.retryButton, { marginTop: 12, backgroundColor: '#ef4444' }]}
                onPress={async () => {
                  try {
                    await supabase.auth.signOut();
                  } catch (err) {
                    console.error('[UserProfileScreen] Sign out failed:', err);
                    Alert.alert(
                      "Sign out failed",
                      "We couldn't sign you out. Please check your connection and try again."
                    );
                  }
                }}
              >
                <Text style={[styles.retryButtonText, { color: '#fff' }]}>Sign Out</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.retryButton} onPress={handleBack}>
              <Text style={styles.retryButtonText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const displayError = !dismissedError && (error || followError);

  return (
      <View style={styles.container}>
      {/* Header */}
      <ScreenHeader
        showBack
        onBack={handleBack}
        centerNode={<BrandingLogo size="small" />}
        rightNode={!isOwnProfile ? (
          <TouchableOpacity
            onPress={() => setShowMoreMenu(!showMoreMenu)}
            style={styles.moreButton}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <MaterialIcons name="more-vert" size={24} color={theme.text} />
          </TouchableOpacity>
        ) : null}
      />

      {/* (offline banner removed) */}

      {/* More Menu Dropdown with backdrop to dismiss when tapping outside */}
      {!isOwnProfile && (
        <MoreMenuPopover
          visible={showMoreMenu}
          onDismiss={() => setShowMoreMenu(false)}
          style={[styles.moreMenuContainer, { top: 48 }]}
        >
          <TouchableOpacity style={styles.moreMenuItem} onPress={handleShare}>
            <MaterialIcons name="share" size={20} color="#9CA3AF" />
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
        </MoreMenuPopover>
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
          hideActions={true}
          hideFollowButton={true}
          activityStats={{
            jobsAccepted,
            jobsCompleted: activityStats.bountiesCompleted,
            bountiesPosted: activityStats.bountiesPosted,
          }}
        />

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          {isOwnProfile ? (
            <TouchableOpacity style={styles.primaryButton} onPress={handleEditProfile}>
              <MaterialIcons name="edit" size={18} color="#111827" />
              <Text style={styles.primaryButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          ) : (
            FOLLOW_FEATURE_ENABLED ? (
              <TouchableOpacity
                style={[styles.secondaryButton, isFollowing && styles.followingButton]}
                onPress={toggleFollow}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color={isFollowing ? "#059669" : "#ffffff"} />
                ) : (
                  <>
                    <MaterialIcons
                      name={isFollowing ? "person-remove" : "person-add"}
                      size={18}
                      color={isFollowing ? "#059669" : "#ffffff"}
                    />
                    <Text style={[styles.secondaryButtonText, isFollowing && styles.followingButtonText]}>
                      {isFollowing ? "Following" : "Follow"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null
          )}
        </View>

        {/* Email Verification Badge + Resend Prompt (own profile only) */}
        {isOwnProfile && (
          <View style={styles.verificationSection}>
            {isEmailVerified ? (
              <View style={styles.emailBadge}>
                <Text style={styles.emailBadgeText}>✓ Email</Text>
              </View>
            ) : (
              <View style={styles.resendPrompt}>
                <MaterialIcons name="warning" size={16} color="#fbbf24" />
                <Text style={styles.resendPromptText}>Email not verified</Text>
                <TouchableOpacity
                  style={[styles.resendButton, resendLoading && styles.resendButtonDisabled]}
                  onPress={handleResendVerification}
                  disabled={resendLoading}
                >
                  {resendLoading ? (
                    <ActivityIndicator size="small" color="#111827" />
                  ) : (
                    <Text style={styles.resendButtonText}>Resend email</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
            {resendMessage ? (
              <Text style={styles.resendMessageText}>{resendMessage}</Text>
            ) : null}
          </View>
        )}

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

        {/* Profile completion meter — own profile only, encourages personalization */}
        {isOwnProfile && (
          <View style={styles.section}>
            <ProfileCompletionMeter
              input={{
                username: profile.username,
                display_name: profile.display_name,
                avatar_url: profile.avatar,
                bio: profile.bio,
                location: profile.location,
                banner_url: profile.banner_url,
              }}
            />
          </View>
        )}

        {/* Verification + Milestone Badges */}
        <View style={styles.section}>
          <VerificationBadgeChips
            input={{
              email_confirmed: profile.email_confirmed,
              phone_verified: profile.phone_verified,
              id_verification_status: profile.id_verification_status,
              selfie_submitted_at: profile.selfie_submitted_at,
              age_verified: profile.age_verified,
              stripe_identity_status: profile.stripe_identity_status as
                | 'unstarted'
                | 'requires_input'
                | 'processing'
                | 'verified'
                | 'canceled'
                | undefined,
              username: profile.username,
              display_name: profile.display_name,
              avatar_url: profile.avatar,
              bio: profile.bio,
            }}
          />
          <MilestoneBadgeChips
            input={{
              bounties_posted: activityStats.bountiesPosted,
              bounties_completed: activityStats.bountiesCompleted,
              average_rating: ratingStats.averageRating,
              rating_count: ratingStats.ratingCount,
            }}
          />
        </View>

        {/* Skillsets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skillsets</Text>
          <SkillsetChips skills={skills} />
        </View>

        {/* Portfolio */}
        <PortfolioSection userId={userId} isOwnProfile={isOwnProfile} />

        {/* Bounty history — respects moderation/removal via the RPC-backed stats hook's underlying query filter */}
        <ProfileBountyHistorySection userId={userId} isOwnProfile={isOwnProfile} />
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

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: theme.background,
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
      color: theme.text,
      letterSpacing: 1.6,
    },
    moreMenuContainer: {
      position: "absolute",
      top: 60,
      right: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      padding: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 8,
      zIndex: 100,
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
      color: theme.text,
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
      color: theme.textSecondary,
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
      color: theme.text,
      marginTop: 16,
      marginBottom: 8,
    },
    errorText: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: "center",
      marginBottom: 24,
    },
    retryButton: {
      backgroundColor: "#059669",
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
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: 'rgba(220,38,38,0.12)',
      padding: 10,
      marginHorizontal: 16,
      marginBottom: 12,
      borderRadius: 8,
    },
    offlineText: {
      color: '#fffef5',
      flex: 1,
      marginRight: 8,
    },
    offlineRetry: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: '#b91c1c',
      borderRadius: 8,
    },
    offlineRetryText: {
      color: '#fff',
      marginLeft: 8,
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
      backgroundColor: theme.surfaceSecondary,
      paddingVertical: 12,
      borderRadius: 12,
      gap: 6,
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      color: theme.text,
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
      borderColor: theme.border,
      paddingVertical: 12,
      borderRadius: 12,
      gap: 6,
    },
    secondaryButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "600",
    },
    followingButton: {
      backgroundColor: "rgba(167, 243, 208, 0.1)",
    },
    followingButtonText: {
      color: "#059669",
    },
    statsContainer: {
      flexDirection: "row",
      backgroundColor: theme.surfaceSecondary,
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
      backgroundColor: theme.border,
    },
    statValue: {
      fontSize: 24,
      fontWeight: "bold",
      color: theme.text,
      marginBottom: 4,
    },
    statLabel: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    section: {
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.text,
      marginBottom: 12,
    },
    verificationSection: {
      paddingHorizontal: 16,
      marginBottom: 12,
      gap: 6,
    },
    emailBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: theme.surfaceSecondary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      gap: 4,
    },
    emailBadgeText: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text,
    },
    resendPrompt: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexWrap: "wrap",
    },
    resendPromptText: {
      fontSize: 12,
      color: "#fbbf24",
      fontWeight: "500",
    },
    resendButton: {
      backgroundColor: theme.surfaceSecondary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      minWidth: 40,
      alignItems: "center",
    },
    resendButtonDisabled: {
      opacity: 0.6,
    },
    resendButtonText: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text,
    },
    resendMessageText: {
      fontSize: 12,
      color: theme.textSecondary,
      fontStyle: "italic",
    },
  });
}
