import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFollow } from "hooks/useFollow";
import { useProfile } from "hooks/useProfile";
import { FOLLOW_FEATURE_ENABLED } from "lib/feature-flags";
import { getCurrentUserId } from "lib/utils/data-utils";
import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthContext } from "../../hooks/use-auth-context";

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();
  
  const { profile, loading, error } = useProfile(userId);
  const {
    isFollowing,
    followerCount,
    followingCount,
    toggleFollow,
    loading: followLoading,
    error: followError,
  } = useFollow(userId || "", currentUserId);

  const [dismissedError, setDismissedError] = useState(false);

  const isOwnProfile = userId === currentUserId;

  const handleMessage = () => {
    // Navigate to messenger/chat with this user
    // This would typically open a conversation or navigate to messenger
    router.push("/tabs/bounty-app");
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

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

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
        {/* Avatar and Name */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profile.name?.[0]?.toUpperCase() || profile.username[1]?.toUpperCase() || "U"}
              </Text>
            </View>
          </View>
          <Text style={styles.displayName}>{profile.name || profile.username}</Text>
          <Text style={styles.username}>{profile.username}</Text>
          {profile.title && <Text style={styles.title}>{profile.title}</Text>}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          {isOwnProfile ? (
            <TouchableOpacity style={styles.primaryButton} onPress={handleEditProfile}>
              <MaterialIcons name="edit" size={18} color="#fffef5" />
              <Text style={styles.primaryButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.primaryButton} onPress={handleMessage}>
                <MaterialIcons name="message" size={18} color="#fffef5" />
                <Text style={styles.primaryButtonText}>Message</Text>
              </TouchableOpacity>
              {FOLLOW_FEATURE_ENABLED && (
                <TouchableOpacity
                  style={[styles.secondaryButton, isFollowing && styles.followingButton]}
                  onPress={toggleFollow}
                  disabled={followLoading}
                >
                  {followLoading ? (
                    <ActivityIndicator size="small" color={isFollowing ? "#10b981" : "#fffef5"} />
                  ) : (
                    <>
                      <MaterialIcons
                        name={isFollowing ? "person-remove" : "person-add"}
                        size={18}
                        color={isFollowing ? "#10b981" : "#fffef5"}
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

        {/* Bio Section */}
        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        )}

        {/* Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Information</Text>
          
          {profile.languages && profile.languages.length > 0 && (
            <View style={styles.infoRow}>
              <MaterialIcons name="language" size={20} color="#10b981" />
              <Text style={styles.infoText}>
                {profile.languages.join(", ")}
              </Text>
            </View>
          )}

          {profile.joinDate && (
            <View style={styles.infoRow}>
              <MaterialIcons name="calendar-today" size={20} color="#10b981" />
              <Text style={styles.infoText}>
                Joined {new Date(profile.joinDate).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </Text>
            </View>
          )}
        </View>

        {/* Skills Section */}
        {profile.skills && profile.skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.skillsContainer}>
              {profile.skills.map((skill, index) => (
                <View key={index} style={styles.skillChip}>
                  <Text style={styles.skillText}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Empty state for no bio */}
        {!profile.bio && isOwnProfile && (
          <View style={styles.emptyState}>
            <MaterialIcons name="person-outline" size={48} color="#6b7280" />
            <Text style={styles.emptyStateTitle}>Complete your profile</Text>
            <Text style={styles.emptyStateText}>
              Add a bio and more information to help others know you better.
            </Text>
            <TouchableOpacity style={styles.emptyStateButton} onPress={handleEditProfile}>
              <Text style={styles.emptyStateButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a3d2e",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1a3d2e",
  },
  backButton: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fffef5",
    letterSpacing: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#d1d5db",
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
    color: "#fffef5",
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#d1d5db",
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#10b981",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fffef5",
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
  profileHeader: {
    alignItems: "center",
    paddingVertical: 24,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#fffef5",
  },
  displayName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fffef5",
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    color: "#9ca3af",
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    color: "#10b981",
    fontWeight: "500",
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10b981",
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  primaryButtonText: {
    color: "#fffef5",
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
    borderColor: "#10b981",
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  secondaryButtonText: {
    color: "#fffef5",
    fontSize: 16,
    fontWeight: "600",
  },
  followingButton: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
  followingButtonText: {
    color: "#10b981",
  },
  statsContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: "#374151",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fffef5",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: "#9ca3af",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fffef5",
    marginBottom: 12,
  },
  bioText: {
    fontSize: 15,
    color: "#d1d5db",
    lineHeight: 22,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  infoText: {
    fontSize: 15,
    color: "#d1d5db",
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  skillChip: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#10b981",
  },
  skillText: {
    fontSize: 14,
    color: "#10b981",
    fontWeight: "500",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fffef5",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 32,
  },
  emptyStateButton: {
    backgroundColor: "#10b981",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyStateButtonText: {
    color: "#fffef5",
    fontSize: 14,
    fontWeight: "600",
  },
});
