import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { followService } from "lib/services/follow-service";
import { authProfileService, type AuthProfile } from "lib/services/auth-profile-service";
import type { UserProfile } from "lib/types";
import { useEffect, useState, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppThemeContext } from "../../lib/themes/AppThemeContext";
import type { AppTheme } from "../../lib/themes/types";
import { authProfileToUserProfile as toUserProfile } from "../../lib/utils/normalize-profile";

export default function FollowersScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [followers, setFollowers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    loadFollowers();
  }, [userId]);

  const loadFollowers = async () => {
    try {
      setLoading(true);
      setError(null);

      const followRelations = await followService.getFollowers(userId || "");

      // Fetch profiles for all followers
      const followerProfiles = await Promise.all(
        followRelations.map((f) => authProfileService.getProfileById(f.followerId))
      );

      if (!mountedRef.current) return;
      setFollowers(
        followerProfiles.filter((p): p is AuthProfile => p !== null).map(toUserProfile)
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load followers");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleProfilePress = (profileUserId: string) => {
    router.push(`/profile/${profileUserId}`);
  };

  const renderFollower = ({ item }: { item: UserProfile }) => (
    <TouchableOpacity
      style={styles.followerItem}
      onPress={() => handleProfilePress(item.id)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.name?.[0]?.toUpperCase() || item.username?.[0]?.toUpperCase() || "U"}
        </Text>
      </View>
      <View style={styles.followerInfo}>
        <Text style={styles.followerName}>{item.name || item.username}</Text>
        <Text style={styles.followerUsername}>{item.username}</Text>
        {item.title && <Text style={styles.followerTitle}>{item.title}</Text>}
      </View>
      <MaterialIcons name="chevron-right" size={24} color={theme.textSecondary} />
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="people-outline" size={64} color={theme.textSecondary} />
      <Text style={styles.emptyTitle}>No followers yet</Text>
      <Text style={styles.emptyText}>
        When people follow this user, they
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
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Followers</Text>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={loadFollowers}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={followers}
          renderItem={renderFollower}
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

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: theme.background,
    },
    backButton: {
      marginRight: 12,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "bold",
      color: theme.text,
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
    followerItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.primary,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 12,
    },
    avatarText: {
      fontSize: 18,
      fontWeight: "bold",
      color: "#ffffff",
    },
    followerInfo: {
      flex: 1,
    },
    followerName: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.text,
      marginBottom: 2,
    },
    followerUsername: {
      fontSize: 14,
      color: theme.textSecondary,
      marginBottom: 2,
    },
    followerTitle: {
      fontSize: 13,
      color: theme.primary,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 64,
      paddingHorizontal: 32,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "600",
      color: theme.text,
      marginTop: 16,
      marginBottom: 8,
    },
    emptyText: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: "center",
      lineHeight: 20,
    },
  });
}
