import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { followService } from "lib/services/follow-service";
import { userProfileService } from "lib/services/user-profile-service";
import type { UserProfile } from "lib/types";
import { useEffect, useState, useMemo } from 'react';
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

export default function FollowingScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

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
      <MaterialIcons name="chevron-right" size={24} color={theme.textSecondary} />
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="people-outline" size={64} color={theme.textSecondary} />
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
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
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
          <ActivityIndicator size="large" color={theme.primary} />
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
    followingItem: {
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
    followingInfo: {
      flex: 1,
    },
    followingName: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.text,
      marginBottom: 2,
    },
    followingUsername: {
      fontSize: 14,
      color: theme.textSecondary,
      marginBottom: 2,
    },
    followingTitle: {
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
