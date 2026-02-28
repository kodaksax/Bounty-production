import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { followService } from "lib/services/follow-service";
import { userProfileService } from "lib/services/user-profile-service";
import type { UserProfile } from "lib/types";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function FollowingScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFollowing();
  }, [userId]);

  const loadFollowing = async () => {
    try {
      setLoading(true);
      setError(null);

      const followRelations = await followService.getFollowing(userId || "");
      
      // Fetch profiles for all following
      const followingProfiles = await Promise.all(
        followRelations.map((f) => userProfileService.getProfile(f.followingId))
      );

      setFollowing(followingProfiles.filter((p) => p !== null) as UserProfile[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load following");
    } finally {
      setLoading(false);
    }
  };

  const handleProfilePress = (profileUserId: string) => {
    router.push(`/profile/${profileUserId}`);
  };

  const renderFollowing = ({ item }: { item: UserProfile }) => (
    <TouchableOpacity
      style={styles.followingItem}
      onPress={() => handleProfilePress(item.id)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.name?.[0]?.toUpperCase() || item.username[1]?.toUpperCase() || "U"}
        </Text>
      </View>
      <View style={styles.followingInfo}>
        <Text style={styles.followingName}>{item.name || item.username}</Text>
        <Text style={styles.followingUsername}>{item.username}</Text>
        {item.title && <Text style={styles.followingTitle}>{item.title}</Text>}
      </View>
      <MaterialIcons name="chevron-right" size={24} color="#9ca3af" />
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="people-outline" size={64} color="#6b7280" />
      <Text style={styles.emptyTitle}>Not following anyone yet</Text>
      <Text style={styles.emptyText}>
        When this user follows others, they
        {"'"}
        ll appear here.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Following</Text>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={loadFollowing}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10b981" />
        </View>
      ) : (
        <FlatList
          data={following}
          renderItem={renderFollowing}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 100 },
          ]}
          ListEmptyComponent={renderEmpty}
        />
      )}
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
  retryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: 16,
  },
  followingItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fffef5",
  },
  followingInfo: {
    flex: 1,
  },
  followingName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fffef5",
    marginBottom: 2,
  },
  followingUsername: {
    fontSize: 14,
    color: "#9ca3af",
    marginBottom: 2,
  },
  followingTitle: {
    fontSize: 13,
    color: "#10b981",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fffef5",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    lineHeight: 20,
  },
});
